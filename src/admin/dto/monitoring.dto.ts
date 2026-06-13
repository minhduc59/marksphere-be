import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export type PipelineStatus = 'running' | 'idle' | 'failed';
export type ErrorSeverity = 'CRITICAL' | 'WARNING' | 'INFO';

/** Live health of one processing pipeline, derived from recent DB activity. */
export class PipelineHealthDto {
  @ApiProperty({
    enum: ['trend_scanner', 'post_generator', 'publisher', 'video_clipper'],
  })
  key!: string;
  @ApiProperty() title!: string;
  @ApiProperty({ enum: ['running', 'idle', 'failed'] })
  status!: PipelineStatus;
  @ApiProperty({ description: 'Items waiting in this stage' }) pending!: number;
  @ApiProperty({ description: 'Items completed in the last hour' })
  processedLastHour!: number;
  @ApiProperty({ description: 'Failures in the last 24h' })
  failedLast24h!: number;
  @ApiPropertyOptional({ type: String, format: 'date-time', nullable: true })
  lastActivityAt!: string | null;
}

/** A single row in the system error log. */
export class ErrorLogEntryDto {
  @ApiProperty({ enum: ['CRITICAL', 'WARNING', 'INFO'] })
  severity!: ErrorSeverity;
  @ApiProperty({ type: String, format: 'date-time' }) timestamp!: string;
  @ApiProperty({ description: 'Originating pipeline / service' }) node!: string;
  @ApiProperty() message!: string;
}

export class ErrorLogPageDto {
  @ApiProperty({ type: [ErrorLogEntryDto] }) items!: ErrorLogEntryDto[];
  @ApiProperty() total!: number;
  @ApiProperty() page!: number;
  @ApiProperty() pageSize!: number;
}
