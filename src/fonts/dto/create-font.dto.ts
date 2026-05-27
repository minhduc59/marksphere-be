import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsOptional, IsString } from 'class-validator';

export class CreateFontDto {
  @ApiPropertyOptional({ description: 'Human-readable font name' })
  @IsOptional()
  @IsString()
  name?: string;

  @ApiPropertyOptional({ description: 'Set as the default font for this user' })
  @IsOptional()
  @IsBoolean()
  isDefault?: boolean;
}
