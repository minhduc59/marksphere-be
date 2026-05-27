import { IsEnum, IsOptional, IsString, IsUUID } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export const INTERNAL_STATUS_VALUES = [
  'pending',
  'processing',
  'published',
  'failed',
  'cancelled',
] as const;

export type InternalStatusValue = (typeof INTERNAL_STATUS_VALUES)[number];

export class InternalStatusNotifyDto {
  @ApiProperty({ description: 'UUID of the PublishedPost record (ai schema)' })
  @IsUUID()
  publishedPostId!: string;

  @ApiProperty({
    description: 'New publish status to broadcast.',
    enum: INTERNAL_STATUS_VALUES,
  })
  @IsEnum(INTERNAL_STATUS_VALUES)
  status!: InternalStatusValue;

  @ApiPropertyOptional({
    description:
      'Raw error text (kept for ops/log only — the frontend renders a sanitized message).',
  })
  @IsOptional()
  @IsString()
  errorMessage?: string;

  @ApiPropertyOptional({
    description: 'Pipeline stage where the failure occurred (resolve | schedule | publish | pipeline).',
  })
  @IsOptional()
  @IsString()
  stage?: string;
}
