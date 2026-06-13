import { Injectable, Logger } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { firstValueFrom } from 'rxjs';
import { ContentStatus, PublishStatus } from '@prisma/client';

import { PrismaService } from '../prisma/prisma.service';
import {
  EfficiencyPoint,
  HealthStatus,
  Kpi,
  OverviewResponseDto,
  SeriesPoint,
  ServiceHealth,
} from './dto/overview-response.dto';

const DAY_MS = 24 * 60 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;

/** % change of `cur` vs `prev`. Null when prev is 0 (avoids Infinity/NaN). */
function pctDelta(cur: number, prev: number): number | null {
  return prev === 0 ? null : Math.round(((cur - prev) / prev) * 100);
}

@Injectable()
export class AdminService {
  private readonly logger = new Logger(AdminService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly http: HttpService,
    private readonly config: ConfigService,
  ) {}

  async getOverview(): Promise<OverviewResponseDto> {
    const now = new Date();
    const last7Start = new Date(now.getTime() - 7 * DAY_MS);
    const prev7Start = new Date(now.getTime() - 14 * DAY_MS);
    const prev7End = last7Start;
    const last24hStart = new Date(now.getTime() - DAY_MS);
    const last14Start = new Date(now.getTime() - 14 * DAY_MS);

    const [kpis, trendScanVolume, contentPipeline, outputEfficiency, systemHealth] =
      await Promise.all([
        this.buildKpis(now, last7Start, prev7Start, prev7End),
        this.buildTrendScanVolume(now, last24hStart, last7Start),
        this.buildFunnel(),
        this.buildOutputEfficiency(now, last14Start),
        this.buildSystemHealth(last24hStart),
      ]);

    return { kpis, trendScanVolume, contentPipeline, outputEfficiency, systemHealth };
  }

  // ── KPIs ────────────────────────────────────────────────────────────────
  private async buildKpis(
    now: Date,
    last7Start: Date,
    prev7Start: Date,
    prev7End: Date,
  ): Promise<Kpi[]> {
    const inLast7 = { gte: last7Start, lt: now };
    const inPrev7 = { gte: prev7Start, lt: prev7End };

    const [
      totalUsers,
      totalScans,
      postsGenerated,
      postsPublished,
      videoClips,
      usersCur,
      usersPrev,
      scansCur,
      scansPrev,
      genCur,
      genPrev,
      pubCur,
      pubPrev,
      clipCur,
      clipPrev,
    ] = await Promise.all([
      this.prisma.user.count(),
      this.prisma.scanRun.count(),
      this.prisma.contentPost.count({ where: { status: { not: ContentStatus.failed } } }),
      this.prisma.publishedPost.count({ where: { status: PublishStatus.published } }),
      // VideoClip.status is a plain string defaulting to "draft"; a row = a rendered clip.
      this.prisma.videoClip.count({ where: { status: { not: 'failed' } } }),
      this.prisma.user.count({ where: { createdAt: inLast7 } }),
      this.prisma.user.count({ where: { createdAt: inPrev7 } }),
      this.prisma.scanRun.count({ where: { startedAt: inLast7 } }),
      this.prisma.scanRun.count({ where: { startedAt: inPrev7 } }),
      this.prisma.contentPost.count({
        where: { status: { not: ContentStatus.failed }, createdAt: inLast7 },
      }),
      this.prisma.contentPost.count({
        where: { status: { not: ContentStatus.failed }, createdAt: inPrev7 },
      }),
      this.prisma.publishedPost.count({
        where: { status: PublishStatus.published, publishedAt: inLast7 },
      }),
      this.prisma.publishedPost.count({
        where: { status: PublishStatus.published, publishedAt: inPrev7 },
      }),
      this.prisma.videoClip.count({ where: { status: { not: 'failed' }, createdAt: inLast7 } }),
      this.prisma.videoClip.count({ where: { status: { not: 'failed' }, createdAt: inPrev7 } }),
    ]);

    return [
      { label: 'Total Users', value: totalUsers, deltaPct: pctDelta(usersCur, usersPrev) },
      { label: 'Trend Scans Run', value: totalScans, deltaPct: pctDelta(scansCur, scansPrev) },
      { label: 'Posts Generated', value: postsGenerated, deltaPct: pctDelta(genCur, genPrev) },
      { label: 'Posts Published', value: postsPublished, deltaPct: pctDelta(pubCur, pubPrev) },
      {
        label: 'Video Clips Produced',
        value: videoClips,
        deltaPct: pctDelta(clipCur, clipPrev),
      },
    ];
  }

  // ── Trend-scan volume (line chart) ───────────────────────────────────────
  private async buildTrendScanVolume(
    now: Date,
    last24hStart: Date,
    last7Start: Date,
  ): Promise<{ '24h': SeriesPoint[]; '7d': SeriesPoint[] }> {
    const [hourly, daily] = await Promise.all([
      this.prisma.$queryRaw<{ label: string; value: bigint }[]>`
        SELECT to_char(date_trunc('hour', started_at AT TIME ZONE 'UTC'), 'HH24:00') AS label,
               count(*)::bigint AS value
        FROM ai.scan_runs
        WHERE started_at >= ${last24hStart} AND started_at < ${now}
        GROUP BY 1
      `,
      this.prisma.$queryRaw<{ label: string; value: bigint }[]>`
        SELECT to_char(date_trunc('day', started_at AT TIME ZONE 'UTC'), 'MM-DD') AS label,
               count(*)::bigint AS value
        FROM ai.scan_runs
        WHERE started_at >= ${last7Start} AND started_at < ${now}
        GROUP BY 1
      `,
    ]);

    return {
      '24h': zeroFill(this.hourlyLabels(now, 24), hourly),
      '7d': zeroFill(this.dailyLabels(now, 7), daily),
    };
  }

  // ── Output efficiency: generated vs published (area chart) ────────────────
  private async buildOutputEfficiency(
    now: Date,
    last14Start: Date,
  ): Promise<EfficiencyPoint[]> {
    const rows = await this.prisma.$queryRaw<
      { label: string; generated: bigint; published: bigint }[]
    >`
      WITH gen AS (
        SELECT to_char(date_trunc('day', created_at AT TIME ZONE 'UTC'), 'MM-DD') AS label,
               count(*)::bigint AS c
        FROM ai.content_posts
        WHERE status <> 'failed' AND created_at >= ${last14Start} AND created_at < ${now}
        GROUP BY 1
      ),
      pub AS (
        SELECT to_char(date_trunc('day', published_at AT TIME ZONE 'UTC'), 'MM-DD') AS label,
               count(*)::bigint AS c
        FROM ai.published_posts
        WHERE status = 'published' AND published_at >= ${last14Start} AND published_at < ${now}
        GROUP BY 1
      )
      SELECT COALESCE(gen.label, pub.label) AS label,
             COALESCE(gen.c, 0)::bigint AS generated,
             COALESCE(pub.c, 0)::bigint AS published
      FROM gen FULL OUTER JOIN pub ON gen.label = pub.label
    `;

    const genMap = new Map(rows.map((r) => [r.label, Number(r.generated)]));
    const pubMap = new Map(rows.map((r) => [r.label, Number(r.published)]));
    return this.dailyLabels(now, 14).map((label) => ({
      label,
      generated: genMap.get(label) ?? 0,
      published: pubMap.get(label) ?? 0,
    }));
  }

  // ── Content pipeline funnel ──────────────────────────────────────────────
  private async buildFunnel(): Promise<OverviewResponseDto['contentPipeline']> {
    const [groups, published] = await Promise.all([
      this.prisma.contentPost.groupBy({ by: ['status'], _count: { _all: true } }),
      this.prisma.publishedPost.count({ where: { status: PublishStatus.published } }),
    ]);

    const byStatus = (s: ContentStatus) =>
      groups.find((g) => g.status === s)?._count._all ?? 0;
    const generated = groups
      .filter((g) => g.status !== ContentStatus.failed)
      .reduce((n, g) => n + g._count._all, 0);

    return {
      generated,
      // Heuristic: the schema doesn't distinguish auto- vs human-approval; `approved` is the closest signal.
      autoApproved: byStatus(ContentStatus.approved),
      flagged: byStatus(ContentStatus.flagged_for_review),
      published,
    };
  }

  // ── System health ────────────────────────────────────────────────────────
  // Real probes: NestJS (self), Postgres (SELECT 1), FastAPI (GET /health).
  // Heuristic/unknown: Redis (no backend client → "unknown"); external services
  // derived best-effort from recent content_posts failures (no live ping exists).
  private async buildSystemHealth(
    last24hStart: Date,
  ): Promise<OverviewResponseDto['systemHealth']> {
    const [postgres, fastapi, recentFails] = await Promise.all([
      this.checkPostgres(),
      this.checkFastApi(),
      this.prisma.contentPost.findMany({
        where: { status: ContentStatus.failed, updatedAt: { gte: last24hStart } },
        select: { failedStage: true, errorReason: true },
        take: 200,
      }),
    ]);

    const hit = (kw: RegExp): boolean =>
      recentFails.some((f) =>
        kw.test(`${f.failedStage ?? ''} ${f.errorReason ?? ''}`.toLowerCase()),
      );
    const heuristic = (kw: RegExp): HealthStatus => (hit(kw) ? 'error' : 'ok');

    const internal: ServiceHealth[] = [
      { label: 'NestJS', status: 'ok' },
      { label: 'FastAPI', status: fastapi },
      { label: 'Postgres', status: postgres },
      { label: 'Redis', status: 'unknown' },
    ];
    const external: ServiceHealth[] = [
      { label: 'OpenAI', status: heuristic(/openai|gpt|llm|completion/) },
      { label: 'FLUX (Modal)', status: heuristic(/flux|modal|image/) },
      { label: 'AssemblyAI', status: heuristic(/assembly|transcri/) },
      { label: 'TikTok API', status: heuristic(/tiktok|publish/) },
      { label: 'HN Crawler', status: heuristic(/hackernews|\bhn\b|crawl|scan/) },
    ];
    return { internal, external };
  }

  private async checkPostgres(): Promise<HealthStatus> {
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      return 'ok';
    } catch (err) {
      this.logger.warn(`Postgres health check failed: ${String(err)}`);
      return 'error';
    }
  }

  private async checkFastApi(): Promise<HealthStatus> {
    const url = this.config.get<string>('AI_SERVICE_URL', 'http://localhost:8000');
    try {
      const res = await firstValueFrom(
        this.http.get(`${url}/health`, { timeout: 3000 }),
      );
      return res.status === 200 ? 'ok' : 'error';
    } catch (err) {
      this.logger.warn(`FastAPI health check failed: ${String(err)}`);
      return 'error';
    }
  }

  // ── Bucket-label helpers (UTC) ───────────────────────────────────────────
  private hourlyLabels(now: Date, count: number): string[] {
    const base = Date.UTC(
      now.getUTCFullYear(),
      now.getUTCMonth(),
      now.getUTCDate(),
      now.getUTCHours(),
    );
    const out: string[] = [];
    for (let i = count - 1; i >= 0; i--) {
      const t = new Date(base - i * HOUR_MS);
      out.push(`${String(t.getUTCHours()).padStart(2, '0')}:00`);
    }
    return out;
  }

  private dailyLabels(now: Date, count: number): string[] {
    const base = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
    const out: string[] = [];
    for (let i = count - 1; i >= 0; i--) {
      const t = new Date(base - i * DAY_MS);
      out.push(
        `${String(t.getUTCMonth() + 1).padStart(2, '0')}-${String(
          t.getUTCDate(),
        ).padStart(2, '0')}`,
      );
    }
    return out;
  }
}

/** Map sparse `{label,value}` rows onto an ordered label list, zero-filling gaps. */
function zeroFill(
  labels: string[],
  rows: { label: string; value: bigint }[],
): SeriesPoint[] {
  const map = new Map(rows.map((r) => [r.label, Number(r.value)]));
  return labels.map((label) => ({ label, value: map.get(label) ?? 0 }));
}
