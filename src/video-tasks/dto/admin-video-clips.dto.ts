import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/** Owner summary joined from `app.users` (no cross-schema relation exists). */
export class AdminVideoClipOwnerDto {
  @ApiProperty() id!: string;
  @ApiPropertyOptional({ nullable: true }) displayName!: string | null;
  @ApiProperty() email!: string;
  @ApiPropertyOptional({ nullable: true }) avatarUrl!: string | null;
}

/**
 * A single video-clipping job (a `VideoTask`) for the admin monitoring view.
 *
 * NOTE: the source-video duration is not stored on `VideoTask`, so it is not
 * returned here — the admin table renders "—" for the Duration column.
 */
export class AdminVideoClipJobDto {
  @ApiProperty() id!: string;
  @ApiProperty({ description: "'url' | 'upload'" }) sourceType!: string;
  @ApiProperty({ description: 'YouTube URL or Cloudinary public_id' })
  sourceRef!: string;
  @ApiProperty({ description: 'VideoTask pipeline status' }) status!: string;
  @ApiProperty() progress!: number;
  @ApiPropertyOptional({ nullable: true }) progressMessage!: string | null;
  @ApiPropertyOptional({ nullable: true }) errorMessage!: string | null;
  @ApiProperty({ description: 'Clips produced so far' }) clipsProduced!: number;
  @ApiProperty({ description: 'Target clip count (maxClips)' })
  clipsTotal!: number;
  @ApiPropertyOptional({ nullable: true }) thumbnailUrl!: string | null;
  @ApiPropertyOptional({ type: AdminVideoClipOwnerDto, nullable: true })
  owner!: AdminVideoClipOwnerDto | null;
  @ApiProperty({ type: String, format: 'date-time' }) createdAt!: Date;
  @ApiPropertyOptional({ type: String, format: 'date-time', nullable: true })
  startedAt!: Date | null;
  @ApiPropertyOptional({ type: String, format: 'date-time', nullable: true })
  completedAt!: Date | null;
}

/** A single produced clip, for the admin "View Clips" modal. */
export class AdminVideoClipDto {
  @ApiProperty() id!: string;
  @ApiProperty() clipIndex!: number;
  @ApiPropertyOptional({ nullable: true }) title!: string | null;
  @ApiProperty({ description: 'Playable Cloudinary video URL' })
  storageUrl!: string;
  @ApiPropertyOptional({ nullable: true }) thumbnailUrl!: string | null;
  @ApiProperty() durationSeconds!: number;
  @ApiProperty({ description: 'Clip review status' }) status!: string;
  @ApiPropertyOptional({ nullable: true }) llmScore!: number | null;
}

export class AdminVideoClipsPageDto {
  @ApiProperty({ type: [AdminVideoClipJobDto] }) items!: AdminVideoClipJobDto[];
  @ApiProperty() total!: number;
  @ApiProperty() page!: number;
  @ApiProperty() pageSize!: number;
}

export class AdminVideoClipsStatsDto {
  @ApiProperty({ description: 'Clips produced since UTC midnight' })
  producedToday!: number;
  @ApiProperty({
    nullable: true,
    description: '% change vs the prior day (null when prior day was 0)',
  })
  producedTodayDeltaPct!: number | null;
  @ApiProperty({ description: 'Tasks currently in an active pipeline stage' })
  inProgress!: number;
  @ApiProperty({ description: 'Tasks that errored in the last 24h' })
  failedTasks!: number;
  @ApiProperty({
    nullable: true,
    description: 'Avg completed-task processing time (seconds), last 7d',
  })
  avgProcessingSeconds!: number | null;
}
