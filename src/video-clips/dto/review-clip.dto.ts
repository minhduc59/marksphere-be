import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString } from 'class-validator';

export class ReviewClipDto {
  @ApiProperty({
    enum: ['approve', 'reject'],
    description: 'Review action: approve the clip for publishing, or reject it.',
  })
  @IsIn(['approve', 'reject'])
  action!: 'approve' | 'reject';

  @ApiPropertyOptional({ description: 'Optional reviewer feedback / reason for rejection' })
  @IsOptional()
  @IsString()
  feedback?: string;
}
