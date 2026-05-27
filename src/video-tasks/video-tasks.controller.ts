import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Param,
  Post,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiBody,
  ApiOperation,
  ApiParam,
  ApiTags,
} from '@nestjs/swagger';
import {
  CurrentUser,
  CurrentUserPayload,
} from '../auth/decorators/current-user.decorator';
import { PrismaService } from '../prisma/prisma.service';
import { AiServiceClient } from '../ai-service/ai-service.client';
import { CreateVideoTaskDto } from './dto/create-video-task.dto';

@ApiTags('Video Tasks')
@ApiBearerAuth('access-token')
@Controller('video-tasks')
export class VideoTasksController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ai: AiServiceClient,
  ) {}

  @Post()
  @ApiOperation({ summary: 'Create a new video processing task' })
  @ApiBody({ type: CreateVideoTaskDto })
  async create(
    @CurrentUser() user: CurrentUserPayload,
    @Body() dto: CreateVideoTaskDto,
  ) {
    const task = await this.prisma.videoTask.create({
      data: {
        userId: user.userId,
        sourceType: dto.sourceType,
        sourceRef: dto.sourceRef,
        fontId: dto.fontId ?? null,
        captionTemplateId: dto.captionTemplateId ?? null,
        maxClips: dto.maxClips ?? 5,
        scanRunId: dto.scanRunId ?? null,
        status: 'queued',
        progress: 0,
        // Customization — backend defaults match the AI service defaults
        captionStyle: dto.captionStyle ?? 'default',
        aspectRatio: dto.aspectRatio ?? '9:16',
        cropX: dto.cropX ?? 0.5,
        cropY: dto.cropY ?? 0.5,
        reframeMode: dto.reframeMode ?? 'static',
        addSubtitles: dto.addSubtitles ?? true,
        fontFamily: dto.fontFamily ?? 'Inter',
        fontSize: dto.fontSize ?? 40,
        fontColor: dto.fontColor ?? '#FFFFFF',
        captionPosition: dto.captionPosition ?? 'bottom',
        startTimeSeconds: dto.startTimeSeconds ?? 0,
        endTimeSeconds: dto.endTimeSeconds ?? 0,
      },
    });
    return { id: task.id, status: task.status };
  }

  @Get(':taskId')
  @ApiOperation({ summary: 'Get a video task with its clips' })
  @ApiParam({ name: 'taskId', description: 'VideoTask UUID' })
  async getOne(
    @CurrentUser() user: CurrentUserPayload,
    @Param('taskId') taskId: string,
  ) {
    const task = await this.prisma.videoTask.findFirst({
      where: { id: taskId, userId: user.userId },
      include: { clips: { orderBy: { clipIndex: 'asc' } } },
    });
    if (!task) throw new NotFoundException(`VideoTask ${taskId} not found`);
    return task;
  }

  @Post(':taskId/trigger-pipeline')
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({ summary: 'Trigger video processing pipeline for the task' })
  @ApiParam({ name: 'taskId', description: 'VideoTask UUID' })
  async triggerPipeline(
    @CurrentUser() user: CurrentUserPayload,
    @Param('taskId') taskId: string,
  ) {
    const task = await this.prisma.videoTask.findFirst({
      where: { id: taskId, userId: user.userId },
    });
    if (!task) throw new NotFoundException(`VideoTask ${taskId} not found`);

    const result = await this.ai.triggerVideoPipeline(user.userId, taskId);
    return result;
  }
}
