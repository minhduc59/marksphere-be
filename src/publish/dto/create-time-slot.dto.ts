import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

const TIME_SLOT_PATTERN = /^([01]\d|2[0-3]):[0-5]\d-([01]\d|2[0-3]):[0-5]\d$/;

export class CreateTimeSlotDto {
  @ApiProperty({ example: 'tiktok', maxLength: 20 })
  @IsString()
  @MaxLength(20)
  platform!: string;

  @ApiProperty({ example: '19:00-19:30' })
  @IsString()
  @Matches(TIME_SLOT_PATTERN, {
    message: 'time_slot must look like "HH:MM-HH:MM"',
  })
  time_slot!: string;

  @ApiProperty({ example: 38, minimum: 0, maximum: 47 })
  @IsInt()
  @Min(0)
  @Max(47)
  slot_index!: number;

  @ApiPropertyOptional({ example: 3400 })
  @IsOptional()
  @IsNumber()
  @Min(0)
  avg_views?: number;

  @ApiPropertyOptional({ example: 120 })
  @IsOptional()
  @IsNumber()
  @Min(0)
  avg_likes?: number;

  @ApiPropertyOptional({ example: 12 })
  @IsOptional()
  @IsNumber()
  @Min(0)
  avg_comments?: number;

  @ApiPropertyOptional({ example: 5 })
  @IsOptional()
  @IsNumber()
  @Min(0)
  avg_shares?: number;

  @ApiPropertyOptional({ example: 0.92 })
  @IsOptional()
  @IsNumber()
  @Min(0)
  weighted_score?: number;

  @ApiPropertyOptional({ example: 24 })
  @IsOptional()
  @IsInt()
  @Min(0)
  sample_count?: number;
}
