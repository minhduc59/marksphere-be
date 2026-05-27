import { IsString, IsOptional, IsArray, IsUrl, ValidateIf } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class InternalPublishDto {
  @ApiProperty({ description: 'UUID of the PublishedPost record (ai schema)' })
  @IsString()
  publishedPostId!: string;

  @ApiProperty({ description: 'UUID of the user triggering the publish' })
  @IsString()
  userId!: string;

  @ApiProperty({ description: 'Assembled caption text' })
  @IsString()
  caption!: string;

  @ApiPropertyOptional({
    description: 'Photo title (TikTok photo posts only, max 90 chars).',
  })
  @IsOptional()
  @IsString()
  title?: string;

  @ApiPropertyOptional({ type: [String], description: 'Hashtag strings without leading #' })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  tags?: string[];

  @ApiPropertyOptional({
    description: 'Publicly accessible HTTPS URL of the video (for video posts).',
  })
  @ValidateIf((o) => !o.imageUrl)
  @IsUrl({ require_tld: false, protocols: ['https'] })
  videoUrl?: string;

  @ApiPropertyOptional({
    description: 'Optional HTTPS URL of a video cover/thumbnail image.',
  })
  @IsOptional()
  @IsUrl({ require_tld: false, protocols: ['https'] })
  thumbnailUrl?: string;

  @ApiPropertyOptional({
    description: 'Publicly accessible HTTPS URL of a single image (for photo posts).',
  })
  @ValidateIf((o) => !o.videoUrl)
  @IsUrl({ require_tld: false, protocols: ['https'] })
  imageUrl?: string;

  @ApiPropertyOptional({
    description: 'ISO 8601 UTC datetime for scheduled publish (e.g. 2026-07-08T12:30:00Z). Omit for immediate publish.',
  })
  @IsOptional()
  @IsString()
  scheduledAt?: string;
}
