import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ContentStatus, Prisma, PublishStatus, UserRole } from '@prisma/client';
import * as bcrypt from 'bcrypt';

import { PrismaService } from '../prisma/prisma.service';
import {
  AdminUserDto,
  AdminUsersPageDto,
  AdminUserStatsDto,
  CreateUserDto,
  UpdateUserDto,
} from './dto/users.dto';

const BCRYPT_ROUNDS = 12;
const DAY_MS = 24 * 60 * 60 * 1000;

const USER_SELECT = {
  id: true,
  email: true,
  displayName: true,
  avatarUrl: true,
  role: true,
  tiktokLinked: true,
  createdAt: true,
} satisfies Prisma.UserSelect;

type UsageStats = {
  postsGenerated: number;
  postsPublished: number;
  videoClips: number;
};

/** % change of `cur` vs `prev`. Null when prev is 0 (avoids Infinity/NaN). */
function pctDelta(cur: number, prev: number): number | null {
  return prev === 0 ? null : Math.round(((cur - prev) / prev) * 100);
}

export interface ListUsersParams {
  search?: string;
  role?: 'admin' | 'user';
  tiktok?: 'linked' | 'not_linked';
  page: number;
  pageSize: number;
}

@Injectable()
export class UsersService {
  constructor(private readonly prisma: PrismaService) {}

  async list(params: ListUsersParams): Promise<AdminUsersPageDto> {
    const { search, role, tiktok, page, pageSize } = params;
    const where: Prisma.UserWhereInput = {
      ...(search && {
        OR: [
          { email: { contains: search, mode: 'insensitive' } },
          { displayName: { contains: search, mode: 'insensitive' } },
        ],
      }),
      ...(role && { role: role as UserRole }),
      ...(tiktok === 'linked' && { tiktokLinked: true }),
      ...(tiktok === 'not_linked' && { tiktokLinked: false }),
    };

    const [rows, total] = await Promise.all([
      this.prisma.user.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
        select: USER_SELECT,
      }),
      this.prisma.user.count({ where }),
    ]);

    const usage = await this.usageStats(rows.map((r) => r.id));
    const items: AdminUserDto[] = rows.map((r) => ({
      ...r,
      ...(usage.get(r.id) ?? {
        postsGenerated: 0,
        postsPublished: 0,
        videoClips: 0,
      }),
    }));

    return { items, total, page, pageSize };
  }

  async stats(): Promise<AdminUserStatsDto> {
    const now = new Date();
    const weekAgo = new Date(now.getTime() - 7 * DAY_MS);
    const twoWeeksAgo = new Date(now.getTime() - 14 * DAY_MS);

    const [totalUsers, tiktokLinked, newThisWeek, newPrevWeek] =
      await Promise.all([
        this.prisma.user.count(),
        this.prisma.user.count({ where: { tiktokLinked: true } }),
        this.prisma.user.count({ where: { createdAt: { gte: weekAgo } } }),
        this.prisma.user.count({
          where: { createdAt: { gte: twoWeeksAgo, lt: weekAgo } },
        }),
      ]);

    return {
      totalUsers,
      tiktokLinked,
      tiktokNotLinked: totalUsers - tiktokLinked,
      newThisWeek,
      deltaPct: pctDelta(newThisWeek, newPrevWeek),
    };
  }

  async create(dto: CreateUserDto): Promise<AdminUserDto> {
    const existing = await this.prisma.user.findUnique({
      where: { email: dto.email },
    });
    if (existing) throw new ConflictException('Email already in use');

    const passwordHash = await bcrypt.hash(dto.password, BCRYPT_ROUNDS);
    const user = await this.prisma.user.create({
      data: {
        email: dto.email,
        passwordHash,
        displayName: dto.displayName ?? dto.email.split('@')[0],
        role: (dto.role ?? 'user') as UserRole,
        identities: {
          create: { provider: 'local', providerUserId: dto.email },
        },
      },
      select: USER_SELECT,
    });

    return { ...user, postsGenerated: 0, postsPublished: 0, videoClips: 0 };
  }

  async update(id: string, dto: UpdateUserDto): Promise<AdminUserDto> {
    await this.getOrThrow(id);
    const user = await this.prisma.user.update({
      where: { id },
      data: {
        ...(dto.role && { role: dto.role as UserRole }),
        ...(dto.displayName !== undefined && { displayName: dto.displayName }),
      },
      select: USER_SELECT,
    });
    const usage = await this.usageStats([id]);
    return {
      ...user,
      ...(usage.get(id) ?? {
        postsGenerated: 0,
        postsPublished: 0,
        videoClips: 0,
      }),
    };
  }

  async remove(id: string, currentUserId: string): Promise<void> {
    if (id === currentUserId) {
      throw new BadRequestException('You cannot delete your own account');
    }
    await this.getOrThrow(id);
    await this.prisma.user.delete({ where: { id } });
  }

  private async getOrThrow(id: string): Promise<void> {
    const user = await this.prisma.user.findUnique({ where: { id } });
    if (!user) throw new NotFoundException('User not found');
  }

  /**
   * Per-user lifetime usage counts: posts generated (content_posts.created_by),
   * posts published (published_posts.published_by), and rendered video clips
   * (video_clips joined to video_tasks.user_id). All live in the ai schema; we
   * only have the discrete user-id columns, so we aggregate by them.
   */
  private async usageStats(ids: string[]): Promise<Map<string, UsageStats>> {
    const map = new Map<string, UsageStats>();
    if (ids.length === 0) return map;
    for (const id of ids) {
      map.set(id, { postsGenerated: 0, postsPublished: 0, videoClips: 0 });
    }

    const [generated, published, clips] = await Promise.all([
      this.prisma.contentPost.groupBy({
        by: ['createdBy'],
        where: { createdBy: { in: ids }, status: { not: ContentStatus.failed } },
        _count: { _all: true },
      }),
      this.prisma.publishedPost.groupBy({
        by: ['publishedBy'],
        where: { publishedBy: { in: ids }, status: PublishStatus.published },
        _count: { _all: true },
      }),
      this.prisma.$queryRaw<{ user_id: string; count: bigint }[]>`
        SELECT vt.user_id, count(vc.id)::bigint AS count
        FROM ai.video_clips vc
        JOIN ai.video_tasks vt ON vc.task_id = vt.id
        WHERE vt.user_id::text IN (${Prisma.join(ids)})
          AND vc.status <> 'failed'
        GROUP BY vt.user_id
      `,
    ]);

    for (const g of generated) {
      if (g.createdBy) map.get(g.createdBy)!.postsGenerated = g._count._all;
    }
    for (const p of published) {
      if (p.publishedBy) map.get(p.publishedBy)!.postsPublished = p._count._all;
    }
    for (const c of clips) {
      const entry = map.get(c.user_id);
      if (entry) entry.videoClips = Number(c.count);
    }

    return map;
  }
}
