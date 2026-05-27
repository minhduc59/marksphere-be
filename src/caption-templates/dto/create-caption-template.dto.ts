import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  Min,
  Matches,
} from 'class-validator';

const HEX_COLOR_PATTERN = /^#[0-9A-Fa-f]{6}$/;
const VERTICAL_POSITIONS = ['top', 'center', 'bottom'] as const;

export class CreateCaptionTemplateDto {
  @ApiProperty({ example: 'Bold White' })
  @IsString()
  name!: string;

  @ApiPropertyOptional({ minimum: 20, maximum: 120, default: 40 })
  @IsOptional()
  @IsInt()
  @Min(20)
  @Max(120)
  fontSize?: number;

  @ApiPropertyOptional({ example: '#FFFFFF', description: '#RRGGBB hex color' })
  @IsOptional()
  @Matches(HEX_COLOR_PATTERN)
  color?: string;

  @ApiPropertyOptional({ example: '#000000' })
  @IsOptional()
  @Matches(HEX_COLOR_PATTERN)
  outlineColor?: string;

  @ApiPropertyOptional({ minimum: 0, maximum: 10, default: 2 })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(10)
  outlineWidth?: number;

  @ApiPropertyOptional({ enum: VERTICAL_POSITIONS, default: 'bottom' })
  @IsOptional()
  @IsIn(VERTICAL_POSITIONS as unknown as string[])
  verticalPosition?: (typeof VERTICAL_POSITIONS)[number];

  @ApiPropertyOptional({ description: 'Set as default template for this user' })
  @IsOptional()
  @IsBoolean()
  isDefault?: boolean;
}
