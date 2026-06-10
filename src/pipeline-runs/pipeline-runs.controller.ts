import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Post,
  Query,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiParam,
  ApiQuery,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { AiServiceClient } from '../ai-service/ai-service.client';
import {
  CurrentUser,
  CurrentUserPayload,
} from '../auth/decorators/current-user.decorator';
import { TriggerScanDto } from '../scans/dto/trigger-scan.dto';

/**
 * End-to-end pipeline runs (Trending Scanner → Post Generation → Publishing).
 * Proxies to ai-service, which owns the orchestration and unified status.
 * Routed under `pipeline/runs` so it does not collide with `pipeline/config`.
 */
@ApiTags('Pipeline Runs')
@ApiBearerAuth('access-token')
@Controller('pipeline/runs')
export class PipelineRunsController {
  constructor(private readonly ai: AiServiceClient) {}

  @Post()
  @HttpCode(202)
  @ApiOperation({
    summary: 'Trigger an end-to-end pipeline run',
    description:
      'Starts the full pipeline (scan → post generation → publishing). ' +
      'Returns immediately with a `pipeline_id`; poll `GET /pipeline/runs/{id}/status`.',
  })
  @ApiResponse({ status: 202, description: 'Pipeline accepted and queued.' })
  trigger(
    @CurrentUser() user: CurrentUserPayload,
    @Body() dto: TriggerScanDto,
  ) {
    return this.ai.triggerPipelineRun(user.userId, dto);
  }

  @Get()
  @ApiOperation({ summary: 'List pipeline runs for the current user' })
  @ApiQuery({ name: 'page', required: false, type: Number, example: 1 })
  @ApiQuery({ name: 'pageSize', required: false, type: Number, example: 20 })
  list(
    @CurrentUser() user: CurrentUserPayload,
    @Query('page') page = '1',
    @Query('pageSize') pageSize = '20',
  ) {
    return this.ai.listPipelineRuns(user.userId, {
      page: parseInt(page, 10) || 1,
      page_size: parseInt(pageSize, 10) || 20,
    });
  }

  @Get(':id/status')
  @ApiOperation({
    summary: 'Poll unified pipeline status (3 stages)',
    description:
      'Live status across Trending Scanner, Post Generation and Publishing Post. ' +
      'Safe to poll every 2–5 seconds.',
  })
  @ApiParam({ name: 'id', description: 'Pipeline run ID (UUID).' })
  status(@CurrentUser() user: CurrentUserPayload, @Param('id') id: string) {
    return this.ai.getPipelineRunStatus(user.userId, id);
  }
}
