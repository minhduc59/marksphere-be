import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsInt,
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
}
