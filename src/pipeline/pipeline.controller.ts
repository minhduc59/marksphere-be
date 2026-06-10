import { Body, Controller, Get, HttpCode, Patch, Post } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { AiServiceClient } from '../ai-service/ai-service.client';
import {
  CurrentUser,
  CurrentUserPayload,
} from '../auth/decorators/current-user.decorator';
import { PipelineConfigDto } from './dto/pipeline-config.dto';

@ApiTags('Pipeline')
@ApiBearerAuth('access-token')
@Controller('pipeline')
export class PipelineController {
  constructor(private readonly ai: AiServiceClient) {}

  @Get('config')
  @ApiOperation({
    summary: 'Get pipeline configuration',
    description:
      'Returns the saved pipeline configuration. Creates one with defaults on first call.',
  })
  @ApiResponse({ status: 200, description: 'Pipeline configuration' })
  getConfig(@CurrentUser() user: CurrentUserPayload) {
    return this.ai.getPipelineConfig(user.userId);
  }

  @Post('config')
  @HttpCode(200)
  @ApiOperation({ summary: 'Create or replace pipeline configuration' })
  @ApiResponse({ status: 200, description: 'Updated pipeline configuration' })
  createConfig(
    @CurrentUser() user: CurrentUserPayload,
    @Body() body: PipelineConfigDto,
  ) {
    return this.ai.createPipelineConfig(user.userId, body);
  }

  @Patch('config')
  @ApiOperation({ summary: 'Partially update pipeline configuration' })
  @ApiResponse({ status: 200, description: 'Updated pipeline configuration' })
  patchConfig(
    @CurrentUser() user: CurrentUserPayload,
    @Body() body: PipelineConfigDto,
  ) {
    return this.ai.patchPipelineConfig(user.userId, body);
  }
}
