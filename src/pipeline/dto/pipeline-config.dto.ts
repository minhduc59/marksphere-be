import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsArray,
  IsBoolean,
  IsIn,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  Min,
} from 'class-validator';

export class PipelineConfigDto {
  @ApiPropertyOptional({ minimum: 1, maximum: 200 })
  @IsOptional()
  @IsNumber()
  @Min(1)
  @Max(200)
  max_items_per_platform?: number;

  @ApiPropertyOptional({ minimum: 1, maximum: 10 })
  @IsOptional()
  @IsNumber()
  @Min(1)
  @Max(10)
  quality_threshold?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  include_comments?: boolean;

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  keywords?: string[];

  @ApiPropertyOptional({ minimum: 1, maximum: 10 })
  @IsOptional()
  @IsNumber()
  @Min(1)
  @Max(10)
  num_posts?: number;

  @ApiPropertyOptional({ type: [String], nullable: true })
  @IsOptional()
  @IsArray()
  allowed_formats?: string[] | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  require_review?: boolean;

  @ApiPropertyOptional({ minimum: 0, maximum: 10 })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(10)
  auto_approve_threshold?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  auto_publish?: boolean;

  @ApiPropertyOptional({ enum: ['auto', 'manual', 'schedule'] })
  @IsOptional()
  @IsIn(['auto', 'manual', 'schedule'])
  publish_mode?: string;

  @ApiPropertyOptional({ description: 'HH:MM format', nullable: true })
  @IsOptional()
  @IsString()
  scheduled_publish_time?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  default_privacy_level?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  scan_schedule_enabled?: boolean;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsString()
  scan_cron_expression?: string | null;

  @ApiPropertyOptional({ minimum: 1, maximum: 1000, description: 'HackerNews crawler rate limit (requests/min)' })
  @IsOptional()
  @IsNumber()
  @Min(1)
  @Max(1000)
  hn_rate_limit_per_min?: number;

  @ApiPropertyOptional({ enum: ['exponential', 'linear', 'immediate'] })
  @IsOptional()
  @IsIn(['exponential', 'linear', 'immediate'])
  hn_retry_strategy?: string;
}
