import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';

export class PostGenOptionsDto {
  @ApiPropertyOptional({
    description: 'Number of posts to generate (1–10).',
    default: 3,
    minimum: 1,
    maximum: 10,
    example: 3,
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(10)
  num_posts?: number = 3;

  @ApiPropertyOptional({
    description:
      'Allowed post formats (e.g. `quick_tips`, `hot_take`, `trending_breakdown`). Null = all formats.',
    type: [String],
    example: ['quick_tips', 'hot_take'],
  })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  formats?: string[] | null = null;
}

export class ScanOptionsDto {
  @ApiPropertyOptional({
    description: 'Max items to fetch per platform (1–200).',
    default: 50,
    minimum: 1,
    maximum: 200,
    example: 30,
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(200)
  max_items_per_platform?: number = 50;

  @ApiPropertyOptional({
    description: 'Whether to fetch top comments for each item.',
    default: true,
  })
  @IsOptional()
  @IsBoolean()
  include_comments?: boolean = true;

  @ApiPropertyOptional({
    description: 'Minimum quality score (1–10) to keep articles.',
    default: 5,
    minimum: 1,
    maximum: 10,
    example: 5,
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(10)
  quality_threshold?: number = 5;

  @ApiPropertyOptional({
    description: 'Target tech keywords for trend filtering.',
    type: [String],
    example: ['Artificial Intelligence & Machine Learning', 'Software Engineering & Developer Tools'],
  })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  keywords?: string[];

  @ApiPropertyOptional({
    description: 'Whether to auto-generate posts after scan completes.',
    default: true,
  })
  @IsOptional()
  @IsBoolean()
  generate_posts?: boolean = true;

  @ApiPropertyOptional({
    description: 'Options for post generation (only used when `generate_posts=true`).',
    type: PostGenOptionsDto,
  })
  @IsOptional()
  @ValidateNested()
  @Type(() => PostGenOptionsDto)
  post_gen_options?: PostGenOptionsDto;
}

export class TriggerScanDto {
  @ApiPropertyOptional({
    description: 'Platforms to scan (currently only `hackernews`).',
    type: [String],
    default: ['hackernews'],
    example: ['hackernews'],
  })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  platforms?: string[] = ['hackernews'];

  @ApiProperty({
    description: 'Scan configuration options.',
    type: ScanOptionsDto,
    default: {},
  })
  @IsOptional()
  @ValidateNested()
  @Type(() => ScanOptionsDto)
  options?: ScanOptionsDto;
}
