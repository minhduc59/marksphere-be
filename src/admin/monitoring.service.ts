import { Injectable } from '@nestjs/common';
import { ContentStatus, PublishStatus, ScanStatus } from '@prisma/client';

import { PrismaService } from '../prisma/prisma.service';
import {
  ErrorLogEntryDto,
  ErrorLogPageDto,
  ErrorSeverity,
  PipelineHealthDto,
  PipelineStatus,
} from './dto/monitoring.dto';

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;
const WEEK_MS = 7 * DAY_MS;

/** Active VideoTask statuses (a clip job is mid-flight). */
const VIDEO_ACTIVE = [
  'queued',
  'downloading',
  'transcribing',
  'analyzing',
  'clipping',
  'captioning',
  'uploading',
];

/** running if work is queued, failed if recent failures, else idle. */
function deriveStatus(pending: number, failed24h: number): PipelineStatus {
  if (pending > 0) return 'running';
  if (failed24h > 0) return 'failed';
  return 'idle';
}

export interface ErrorLogParams {
  severity?: ErrorSeverity | 'all';
  page: number;
  pageSize: number;
}

/**
 * Admin monitoring read model. Derives live pipeline health and a unified
 * error log directly from the `ai.*` activity tables (Prisma SELECT) — no new
 * infrastructure, mirroring how AdminService builds the overview.
 */
@Injectable()
export class MonitoringService {
  constructor(private readonly prisma: PrismaService) {}

  async getPipelines(): Promise<PipelineHealthDto[]> {
    const now = Date.now();
    const hourAgo = new Date(now - HOUR_MS);
    const dayAgo = new Date(now - DAY_MS);

    const [scanner, generator, publisher, clipper] = await Promise.all([
      this.scannerHealth(hourAgo, dayAgo),
      this.generatorHealth(hourAgo, dayAgo),
      this.publisherHealth(hourAgo, dayAgo),
      this.clipperHealth(hourAgo, dayAgo),
    ]);
    return [scanner, generator, publisher, clipper];
  }

  private async scannerHealth(
    hourAgo: Date,
    dayAgo: Date,
  ): Promise<PipelineHealthDto> {
    const [pending, processedLastHour, failedLast24h, last] = await Promise.all([
      this.prisma.scanRun.count({
        where: { status: { in: [ScanStatus.pending, ScanStatus.running] } },
      }),
      this.prisma.scanRun.count({
        where: { status: ScanStatus.completed, completedAt: { gte: hourAgo } },
      }),
      this.prisma.scanRun.count({
        where: { status: ScanStatus.failed, startedAt: { gte: dayAgo } },
      }),
      this.prisma.scanRun.aggregate({ _max: { startedAt: true } }),
    ]);
    return {
      key: 'trend_scanner',
      title: 'Trend Scanner',
      status: deriveStatus(pending, failedLast24h),
      pending,
      processedLastHour,
      failedLast24h,
      lastActivityAt: last._max.startedAt?.toISOString() ?? null,
    };
  }

  private async generatorHealth(
    hourAgo: Date,
    dayAgo: Date,
  ): Promise<PipelineHealthDto> {
    const [pending, processedLastHour, failedLast24h, last] = await Promise.all([
      this.prisma.contentPost.count({
        where: {
          status: {
            in: [
              ContentStatus.draft,
              ContentStatus.needs_revision,
              ContentStatus.regenerating,
              ContentStatus.flagged_for_review,
            ],
          },
        },
      }),
      this.prisma.contentPost.count({
        where: { status: { not: ContentStatus.failed }, createdAt: { gte: hourAgo } },
      }),
      this.prisma.contentPost.count({
        where: { status: ContentStatus.failed, updatedAt: { gte: dayAgo } },
      }),
      this.prisma.contentPost.aggregate({ _max: { createdAt: true } }),
    ]);
    return {
      key: 'post_generator',
      title: 'Post Generator',
      status: deriveStatus(pending, failedLast24h),
      pending,
      processedLastHour,
      failedLast24h,
      lastActivityAt: last._max.createdAt?.toISOString() ?? null,
    };
  }

  private async publisherHealth(
    hourAgo: Date,
    dayAgo: Date,
  ): Promise<PipelineHealthDto> {
    const [pending, processedLastHour, failedLast24h, last] = await Promise.all([
      this.prisma.publishedPost.count({
        where: { status: { in: [PublishStatus.pending, PublishStatus.processing] } },
      }),
      this.prisma.publishedPost.count({
        where: { status: PublishStatus.published, publishedAt: { gte: hourAgo } },
      }),
      this.prisma.publishedPost.count({
        where: { status: PublishStatus.failed, updatedAt: { gte: dayAgo } },
      }),
      this.prisma.publishedPost.aggregate({ _max: { createdAt: true } }),
    ]);
    return {
      key: 'publisher',
      title: 'Publisher',
      status: deriveStatus(pending, failedLast24h),
      pending,
      processedLastHour,
      failedLast24h,
      lastActivityAt: last._max.createdAt?.toISOString() ?? null,
    };
  }

  private async clipperHealth(
    hourAgo: Date,
    dayAgo: Date,
  ): Promise<PipelineHealthDto> {
    const [pending, processedLastHour, failedLast24h, last] = await Promise.all([
      this.prisma.videoTask.count({ where: { status: { in: VIDEO_ACTIVE } } }),
      this.prisma.videoTask.count({
        where: { status: 'completed', completedAt: { gte: hourAgo } },
      }),
      this.prisma.videoTask.count({
        where: { status: 'error', createdAt: { gte: dayAgo } },
      }),
      this.prisma.videoTask.aggregate({ _max: { createdAt: true } }),
    ]);
    return {
      key: 'video_clipper',
      title: 'Video Clipper',
      status: deriveStatus(pending, failedLast24h),
      pending,
      processedLastHour,
      failedLast24h,
      lastActivityAt: last._max.createdAt?.toISOString() ?? null,
    };
  }

  async getErrors(params: ErrorLogParams): Promise<ErrorLogPageDto> {
    const { severity = 'all', page, pageSize } = params;
    const weekAgo = new Date(Date.now() - WEEK_MS);
    const TAKE = 200;

    const [posts, publishes, videos, scans] = await Promise.all([
      this.prisma.contentPost.findMany({
        where: { status: ContentStatus.failed, createdAt: { gte: weekAgo } },
        select: { failedStage: true, errorReason: true, updatedAt: true, createdAt: true },
        orderBy: { createdAt: 'desc' },
        take: TAKE,
      }),
      this.prisma.publishedPost.findMany({
        where: { status: PublishStatus.failed, createdAt: { gte: weekAgo } },
        select: { failedStage: true, errorMessage: true, updatedAt: true, createdAt: true },
        orderBy: { createdAt: 'desc' },
        take: TAKE,
      }),
      this.prisma.videoTask.findMany({
        where: { status: 'error', createdAt: { gte: weekAgo } },
        select: { errorMessage: true, progressMessage: true, updatedAt: true, createdAt: true },
        orderBy: { createdAt: 'desc' },
        take: TAKE,
      }),
      this.prisma.scanRun.findMany({
        where: {
          status: { in: [ScanStatus.failed, ScanStatus.partial] },
          startedAt: { gte: weekAgo },
        },
        select: { status: true, error: true, completedAt: true, startedAt: true },
        orderBy: { startedAt: 'desc' },
        take: TAKE,
      }),
    ]);

    const entries: ErrorLogEntryDto[] = [
      ...posts.map((p) => ({
        severity: 'CRITICAL' as ErrorSeverity,
        timestamp: (p.updatedAt ?? p.createdAt).toISOString(),
        node: p.failedStage ?? 'post-generator',
        message: p.errorReason ?? 'Content generation failed',
      })),
      ...publishes.map((p) => ({
        severity: 'CRITICAL' as ErrorSeverity,
        timestamp: (p.updatedAt ?? p.createdAt).toISOString(),
        node: p.failedStage ?? 'publisher',
        message: p.errorMessage ?? 'Publish failed',
      })),
      ...videos.map((v) => ({
        severity: 'CRITICAL' as ErrorSeverity,
        timestamp: (v.updatedAt ?? v.createdAt).toISOString(),
        node: 'video-clipper',
        message: v.errorMessage ?? v.progressMessage ?? 'Video task failed',
      })),
      ...scans.map((s) => ({
        severity: (s.status === ScanStatus.partial
          ? 'WARNING'
          : 'CRITICAL') as ErrorSeverity,
        timestamp: (s.completedAt ?? s.startedAt).toISOString(),
        node: 'trend-scanner',
        message:
          s.error ??
          (s.status === ScanStatus.partial
            ? 'Partial scan: some platforms failed'
            : 'Scan failed'),
      })),
    ];

    const filtered =
      severity === 'all'
        ? entries
        : entries.filter((e) => e.severity === severity);
    filtered.sort((a, b) => b.timestamp.localeCompare(a.timestamp));

    const total = filtered.length;
    const start = (page - 1) * pageSize;
    return {
      items: filtered.slice(start, start + pageSize),
      total,
      page,
      pageSize,
    };
  }
}
