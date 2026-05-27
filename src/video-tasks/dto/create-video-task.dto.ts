import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsBoolean,
  IsHexColor,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  Min,
} from 'class-validator';

export class CreateVideoTaskDto {
  @ApiProperty({ enum: ['url', 'upload'], example: 'url' })
  @IsIn(['url', 'upload'])
  sourceType!: 'url' | 'upload';

  @ApiProperty({
    description: 'YouTube URL (sourceType=url) or Cloudinary public_id (sourceType=upload)',
    example: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
  })
  @IsString()
  sourceRef!: string;

  @ApiPropertyOptional({ description: 'BrandFont UUID to use for captions' })
  @IsOptional()
  @IsUUID()
  fontId?: string;

  @ApiPropertyOptional({ description: 'CaptionTemplate UUID' })
  @IsOptional()
  @IsUUID()
  captionTemplateId?: string;

  @ApiPropertyOptional({ minimum: 1, maximum: 10, default: 5 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(10)
  maxClips?: number;

  @ApiPropertyOptional({ description: 'Link to an existing ScanRun for analytics' })
  @IsOptional()
  @IsUUID()
  scanRunId?: string;

  // ── Customization (one-time per task; not stored as preset in v1) ──
  @ApiPropertyOptional({ enum: ['default', 'bold', 'minimal'] })
  @IsOptional()
  @IsIn(['default', 'bold', 'minimal'])
  captionStyle?: 'default' | 'bold' | 'minimal';

  @ApiPropertyOptional({ enum: ['9:16', '16:9', '4:3'], default: '9:16' })
  @IsOptional()
  @IsIn(['9:16', '16:9', '4:3'])
  aspectRatio?: '9:16' | '16:9' | '4:3';

  @ApiPropertyOptional({ minimum: 0, maximum: 1, default: 0.5, description: 'Horizontal crop-window centre (0=left, 1=right)' })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(1)
  cropX?: number;

  @ApiPropertyOptional({ minimum: 0, maximum: 1, default: 0.5, description: 'Vertical crop-window centre (0=top, 1=bottom)' })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(1)
  cropY?: number;

  @ApiPropertyOptional({ enum: ['static', 'smart'], default: 'static', description: 'Reframe strategy: "static" = fixed crop_x/crop_y; "smart" = subject-tracking (Autocrop, 9:16 only)' })
  @IsOptional()
  @IsIn(['static', 'smart'])
  reframeMode?: 'static' | 'smart';

  @ApiPropertyOptional({ description: 'Burn subtitles onto the clip' })
  @IsOptional()
  @IsBoolean()
  addSubtitles?: boolean;

  @ApiPropertyOptional({ description: 'Bundled font family key (e.g. "Inter")' })
  @IsOptional()
  @IsString()
  fontFamily?: string;

  @ApiPropertyOptional({ minimum: 12, maximum: 96, default: 40 })
  @IsOptional()
  @IsInt()
  @Min(12)
  @Max(96)
  fontSize?: number;

  @ApiPropertyOptional({ example: '#FFFFFF' })
  @IsOptional()
  @IsHexColor()
  fontColor?: string;

  @ApiPropertyOptional({ enum: ['top', 'center', 'bottom'] })
  @IsOptional()
  @IsIn(['top', 'center', 'bottom'])
  captionPosition?: 'top' | 'center' | 'bottom';

  @ApiPropertyOptional({ minimum: 0, description: 'Start offset in seconds (0 = beginning)' })
  @IsOptional()
  @IsNumber()
  @Min(0)
  startTimeSeconds?: number;

  @ApiPropertyOptional({ minimum: 0, description: 'End offset in seconds (0 = no limit)' })
  @IsOptional()
  @IsNumber()
  @Min(0)
  endTimeSeconds?: number;
}
