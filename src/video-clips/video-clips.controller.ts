import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiBody,
  ApiOperation,
  ApiParam,
  ApiQuery,
  ApiTags,
} from '@nestjs/swagger';
import {
  CurrentUser,
  CurrentUserPayload,
} from '../auth/decorators/current-user.decorator';
import { PrismaService } from '../prisma/prisma.service';
import { AiServiceClient } from '../ai-service/ai-service.client';
import { ReviewClipDto } from './dto/review-clip.dto';

const TERMINAL_STATUSES = ['approved', 'rejected', 'published', 'failed'] as const;

@ApiTags('Video Clips')
@ApiBearerAuth('access-token')
@Controller('video-clips')
export class VideoClipsController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ai: AiServiceClient,
  ) {}

  @Get()
  @ApiOperation({ summary: 'List the current user’s video clips across tasks' })
  @ApiQuery({ name: 'status', required: false, enum: ['draft', 'approved', 'rejected', 'published', 'failed'] })
  @ApiQuery({ name: 'task_id', required: false })
  @ApiQuery({ name: 'sort', required: false, enum: ['created_at', 'duration', 'status'] })
  @ApiQuery({ name: 'order', required: false, enum: ['asc', 'desc'] })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  @ApiQuery({ name: 'offset', required: false, type: Number })
  async list(
    @CurrentUser() user: CurrentUserPayload,
    @Query('status') status?: string,
    @Query('task_id') taskId?: string,
    @Query('sort') sort?: string,
    @Query('order') order?: string,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ) {
    return this.ai.listVideoClips(user.userId, {
      status,
      task_id: taskId,
      sort,
      order,
      limit,
      offset,
    });
  }

  @Delete(':clipId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete a clip (and its Cloudinary assets)' })
  @ApiParam({ name: 'clipId', description: 'VideoClip UUID' })
  async remove(
    @CurrentUser() user: CurrentUserPayload,
    @Param('clipId') clipId: string,
  ) {
    return this.ai.deleteVideoClip(user.userId, clipId);
  }

  @Post(':clipId/duplicate')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Duplicate a clip (clones the DB row; reuses the Cloudinary asset)' })
  @ApiParam({ name: 'clipId', description: 'VideoClip UUID' })
  async duplicate(
    @CurrentUser() user: CurrentUserPayload,
    @Param('clipId') clipId: string,
  ) {
    return this.ai.duplicateVideoClip(user.userId, clipId);
  }

  @Patch(':clipId/review')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Review a video clip (approve or reject)',
    description:
      'Approve or reject a draft clip. When all clips in the task reach a terminal state, ' +
      'approved clips are linked to new ContentPosts and forwarded to the publish pipeline.',
  })
  @ApiParam({ name: 'clipId', description: 'VideoClip UUID' })
  @ApiBody({ type: ReviewClipDto })
  async reviewClip(
    @CurrentUser() user: CurrentUserPayload,
    @Param('clipId') clipId: string,
    @Body() dto: ReviewClipDto,
  ) {
    // Load clip and verify ownership via the VideoTask
    const clip = await this.prisma.videoClip.findFirst({
      where: { id: clipId, task: { userId: user.userId } },
      include: { task: { include: { clips: true } } },
    });
    if (!clip) throw new NotFoundException(`VideoClip ${clipId} not found`);

    const newStatus = dto.action === 'approve' ? 'approved' : 'rejected';

    // Update the clip
    const updated = await this.prisma.videoClip.update({
      where: { id: clipId },
      data: {
        status: newStatus,
        feedback: dto.feedback ?? null,
        updatedAt: new Date(),
      },
    });

    // Check if all clips in the task are now terminal
    const allClips = clip.task.clips.map((c) =>
      c.id === clipId ? { ...c, status: newStatus } : c,
    );
    const allTerminal = allClips.every((c) =>
      TERMINAL_STATUSES.includes(c.status as (typeof TERMINAL_STATUSES)[number]),
    );

    if (allTerminal) {
      const approvedClips = allClips.filter((c) => c.status === 'approved');
      await this._triggerPublishForApproved(user.userId, clip.task.id, approvedClips);
    }

    return { clipId, status: updated.status, allTerminal };
  }

  /** For each approved clip: create a ContentPost (content_type=video), then trigger publish. */
  private async _triggerPublishForApproved(
    userId: string,
    taskId: string,
    approvedClips: Array<{ id: string; storageUrl: string; llmScore: number | null }>,
  ) {
    const task = await this.prisma.videoTask.findUnique({
      where: { id: taskId },
      select: { scanRunId: true },
    });

    // Publishing requires a scan run linkage so the existing publish pipeline
    // can resolve context. Skip auto-publish for standalone video tasks (no scan run).
    if (!task?.scanRunId) return;

    for (const clip of approvedClips) {
      const post = await this.prisma.contentPost.create({
        data: {
          scanRunId: task.scanRunId,
          contentType: 'video',
          format: 'trending_breakdown',
          caption: '',
          trendTitle: `Video clip from task ${taskId}`,
          status: 'approved',
        },
      });

      await this.prisma.videoClip.update({
        where: { id: clip.id },
        data: { contentPostId: post.id },
      });

      await this.ai.publishNow(userId, post.id, { mode: 'auto' });
    }
  }
}
