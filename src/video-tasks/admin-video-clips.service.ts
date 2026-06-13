import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { PrismaService } from '../prisma/prisma.service';
import { AiServiceClient } from '../ai-service/ai-service.client';
import {
  AdminVideoClipDto,
  AdminVideoClipJobDto,
  AdminVideoClipsPageDto,
  AdminVideoClipsStatsDto,
} from './dto/admin-video-clips.dto';

const DAY_MS = 24 * 60 * 60 * 1000;

/** Task statuses that count as "in progress" (work is actively happening). */
const ACTIVE_STATUSES = [
  'queued',
  'downloading',
  'transcribing',
  'analyzing',
  'clipping',
  'captioning',
  'uploading',
];

/** All known VideoTask statuses — used to validate the `status` filter. */
const KNOWN_STATUSES = new Set([
  ...ACTIVE_STATUSES,
  'completed',
  'error',
  'cancelled',
]);

/** % change of `cur` vs `prev`. Null when prev is 0 (avoids Infinity/NaN). */
function pctDelta(cur: number, prev: number): number | null {
  return prev === 0 ? null : Math.round(((cur - prev) / prev) * 100);
}

export interface ListJobsParams {
  status?: string;
  search?: string;
  page: number;
  pageSize: number;
}

/**
 * Admin-only read model for the Video Clipping Pipeline page. Queries the
 * Alembic-owned `ai.*` tables directly via Prisma (backend_svc has SELECT),
 * mirroring how UsersService reads cross-user data. Owner info is joined from
 * `app.users` separately since no cross-schema relation exists.
 */
@Injectable()
export class AdminVideoClipsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ai: AiServiceClient,
  ) {}

  async list(params: ListJobsParams): Promise<AdminVideoClipsPageDto> {
    const { status, search, page, pageSize } = params;
    const where: Prisma.VideoTaskWhereInput = {
      ...(status && KNOWN_STATUSES.has(status) && { status }),
      ...(search && {
        sourceRef: { contains: search, mode: 'insensitive' },
      }),
    };

    const [rows, total] = await Promise.all([
      this.prisma.videoTask.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
        select: {
          id: true,
          userId: true,
          sourceType: true,
          sourceRef: true,
          status: true,
          progress: true,
          progressMessage: true,
          errorMessage: true,
          maxClips: true,
          createdAt: true,
          startedAt: true,
          completedAt: true,
          _count: { select: { clips: true } },
          clips: {
            take: 1,
            orderBy: { clipIndex: 'asc' },
            select: { thumbnailUrl: true },
          },
        },
      }),
      this.prisma.videoTask.count({ where }),
    ]);

    const owners = await this.ownerMap(rows.map((r) => r.userId));
    const items: AdminVideoClipJobDto[] = rows.map((r) => ({
      id: r.id,
      sourceType: r.sourceType,
      sourceRef: r.sourceRef,
      status: r.status,
      progress: r.progress,
      progressMessage: r.progressMessage,
      errorMessage: r.errorMessage,
      clipsProduced: r._count.clips,
      clipsTotal: r.maxClips,
      thumbnailUrl: r.clips[0]?.thumbnailUrl ?? null,
      owner: owners.get(r.userId) ?? null,
      createdAt: r.createdAt,
      startedAt: r.startedAt,
      completedAt: r.completedAt,
    }));

    return { items, total, page, pageSize };
  }

  async stats(): Promise<AdminVideoClipsStatsDto> {
    const now = new Date();
    const startOfToday = new Date(now);
    startOfToday.setUTCHours(0, 0, 0, 0);
    const startOfYesterday = new Date(startOfToday.getTime() - DAY_MS);
    const last24hStart = new Date(now.getTime() - DAY_MS);

    const [producedToday, producedYesterday, inProgress, failedTasks, avgRows] =
      await Promise.all([
        this.prisma.videoClip.count({
          where: { createdAt: { gte: startOfToday } },
        }),
        this.prisma.videoClip.count({
          where: { createdAt: { gte: startOfYesterday, lt: startOfToday } },
        }),
        this.prisma.videoTask.count({
          where: { status: { in: ACTIVE_STATUSES } },
        }),
        this.prisma.videoTask.count({
          where: { status: 'error', createdAt: { gte: last24hStart } },
        }),
        this.prisma.$queryRaw<{ avg_seconds: number | null }[]>`
          SELECT EXTRACT(EPOCH FROM avg(completed_at - started_at)) AS avg_seconds
          FROM ai.video_tasks
          WHERE status = 'completed'
            AND started_at IS NOT NULL
            AND completed_at IS NOT NULL
            AND completed_at >= ${new Date(now.getTime() - 7 * DAY_MS)}
        `,
      ]);

    const avg = avgRows[0]?.avg_seconds;
    return {
      producedToday,
      producedTodayDeltaPct: pctDelta(producedToday, producedYesterday),
      inProgress,
      failedTasks,
      avgProcessingSeconds: avg == null ? null : Math.round(Number(avg)),
    };
  }

  /** Produced clips for a task (admin "View Clips" modal). */
  async getTaskClips(taskId: string): Promise<AdminVideoClipDto[]> {
    const task = await this.prisma.videoTask.findUnique({
      where: { id: taskId },
      select: { id: true },
    });
    if (!task) throw new NotFoundException(`VideoTask ${taskId} not found`);

    const clips = await this.prisma.videoClip.findMany({
      where: { taskId },
      orderBy: { clipIndex: 'asc' },
      select: {
        id: true,
        clipIndex: true,
        title: true,
        storageUrl: true,
        thumbnailUrl: true,
        durationSeconds: true,
        status: true,
        llmScore: true,
      },
    });
    return clips;
  }

  /** Re-trigger the pipeline for a task on the owner's behalf. */
  async retry(taskId: string): Promise<unknown> {
    const task = await this.prisma.videoTask.findUnique({
      where: { id: taskId },
      select: { id: true, userId: true },
    });
    if (!task) throw new NotFoundException(`VideoTask ${taskId} not found`);
    return this.ai.triggerVideoPipeline(task.userId, taskId);
  }

  private async ownerMap(
    ids: string[],
  ): Promise<Map<string, AdminVideoClipJobDto['owner']>> {
    const map = new Map<string, AdminVideoClipJobDto['owner']>();
    const unique = [...new Set(ids)];
    if (unique.length === 0) return map;

    const users = await this.prisma.user.findMany({
      where: { id: { in: unique } },
      select: { id: true, displayName: true, email: true, avatarUrl: true },
    });
    for (const u of users) {
      map.set(u.id, {
        id: u.id,
        displayName: u.displayName,
        email: u.email,
        avatarUrl: u.avatarUrl,
      });
    }
    return map;
  }
}
