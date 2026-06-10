import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsUrl,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';

export class FromArticleOptionsDto {
  @ApiPropertyOptional({
    description: 'Number of posts to generate (1–10).',
    example: 3,
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(10)
  num_posts?: number;

  @ApiPropertyOptional({
    description: 'Restrict to specific post formats (matches PostFormat enum).',
    type: [String],
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(10)
  @IsString({ each: true })
  formats?: string[];
}

export class PublishSettingsDto {
  @ApiPropertyOptional({ description: 'Require manual review before publishing.' })
  @IsOptional()
  @IsBoolean()
  require_review?: boolean;

  @ApiPropertyOptional({
    description: 'Minimum review score (0–10) to auto-approve.',
    example: 7,
  })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(10)
  auto_approve_threshold?: number;

  @ApiPropertyOptional({ description: 'Auto-publish approved posts.' })
  @IsOptional()
  @IsBoolean()
  auto_publish?: boolean;

  @ApiPropertyOptional({
    description: 'Publishing strategy.',
    enum: ['auto', 'manual', 'schedule'],
  })
  @IsOptional()
  @IsIn(['auto', 'manual', 'schedule'])
  publish_mode?: 'auto' | 'manual' | 'schedule';

  @ApiPropertyOptional({
    description: 'HH:MM time, used only when publish_mode="schedule".',
    example: '19:00',
  })
  @IsOptional()
  @IsString()
  scheduled_publish_time?: string;

  @ApiPropertyOptional({ description: 'TikTok privacy level for published posts.' })
  @IsOptional()
  @IsString()
  privacy_level?: string;
}

export class CreateFromArticleDto {
  @ApiProperty({
    description: 'Public URL of the article to crawl and turn into posts.',
    example: 'https://example.com/blog/great-article',
  })
  @IsUrl({ protocols: ['http', 'https'], require_protocol: true })
  url!: string;

  @ApiPropertyOptional({ type: FromArticleOptionsDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => FromArticleOptionsDto)
  options?: FromArticleOptionsDto;

  @ApiPropertyOptional({ type: PublishSettingsDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => PublishSettingsDto)
  publish_settings?: PublishSettingsDto;
}
