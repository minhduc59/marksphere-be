import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
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
import { PublishStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AiServiceClient } from '../ai-service/ai-service.client';
import {
  CurrentUser,
  CurrentUserPayload,
} from '../auth/decorators/current-user.decorator';

@ApiTags('Publish')
@ApiBearerAuth('access-token')
@Controller('publish')
export class PublishController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ai: AiServiceClient,
  ) {}

  @Get('history')
  @ApiOperation({
    summary: 'List publish history',
    description: 'Paginated history of publish attempts for the current user, ordered by `createdAt` descending.',
  })
  @ApiQuery({ name: 'status', required: false, description: 'Filter by publish status (e.g. `scheduled`, `published`, `failed`).' })
  @ApiQuery({ name: 'page', required: false, type: Number, example: 1 })
  @ApiQuery({ name: 'pageSize', required: false, type: Number, example: 20 })
  async history(
    @CurrentUser() user: CurrentUserPayload,
    @Query('status') status?: string,
    @Query('page') pageStr = '1',
    @Query('pageSize') pageSizeStr = '20',
  ) {
    const page = Math.max(parseInt(pageStr, 10) || 1, 1);
    const pageSize = Math.min(
      Math.max(parseInt(pageSizeStr, 10) || 20, 1),
      100,
    );
    const where = {
      publishedBy: user.userId,
      ...(status && { status: status as PublishStatus }),
    };
    const [items, total] = await Promise.all([
      this.prisma.publishedPost.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.publishedPost.count({ where }),
    ]);
    return { items, total, page, pageSize };
  }

  @Get('golden-hours')
  @ApiOperation({
    summary: 'Get engagement golden hours',
    description:
      'Returns recommended posting time slots computed from the user\'s past engagement metrics. Proxied from ai-service.',
  })
  goldenHours(@CurrentUser() user: CurrentUserPayload) {
    return this.ai.getGoldenHours(user.userId);
  }

  @Post(':postId')
  @ApiOperation({
    summary: 'Publish a post immediately',
    description:
      'Kicks off the publish_post LangGraph agent in ai-service which uploads the post to TikTok using the user\'s stored OAuth token.',
  })
  @ApiParam({ name: 'postId', description: 'Content post ID (UUID) to publish.' })
  @ApiBody({
    description: 'Optional publish options (passthrough to ai-service).',
    schema: {
      type: 'object',
      additionalProperties: true,
      example: { caption: 'Override caption', hashtags: ['#ai', '#dev'] },
    },
  })
  async publishNow(
    @CurrentUser() user: CurrentUserPayload,
    @Param('postId') postId: string,
    @Body() body: Record<string, unknown>,
  ) {
    await this.assertTiktokLinked(user.userId);
    return this.ai.publishNow(user.userId, postId, body);
  }

  @Post(':postId/schedule')
  @ApiOperation({
    summary: 'Schedule a post for future publishing',
    description: 'Schedules a post at an explicit `scheduledAt` timestamp (UTC).',
  })
  @ApiParam({ name: 'postId', description: 'Content post ID (UUID).' })
  @ApiBody({
    schema: {
      type: 'object',
      additionalProperties: true,
      example: { scheduledAt: '2026-04-12T14:00:00Z' },
    },
  })
  async schedule(
    @CurrentUser() user: CurrentUserPayload,
    @Param('postId') postId: string,
    @Body() body: Record<string, unknown>,
  ) {
    await this.assertTiktokLinked(user.userId);
    return this.ai.schedulePublish(user.userId, postId, body);
  }

  @Post(':postId/auto')
  @ApiOperation({
    summary: 'Auto-schedule a post at the next golden hour',
    description:
      'Lets ai-service pick the next best engagement slot for this user and schedules the publish job automatically.',
  })
  @ApiParam({ name: 'postId', description: 'Content post ID (UUID).' })
  @ApiBody({
    schema: { type: 'object', additionalProperties: true, example: {} },
  })
  async auto(
    @CurrentUser() user: CurrentUserPayload,
    @Param('postId') postId: string,
    @Body() body: Record<string, unknown>,
  ) {
    await this.assertTiktokLinked(user.userId);
    return this.ai.autoPublish(user.userId, postId, body);
  }

  @Delete(':postId/schedule')
  @ApiOperation({
    summary: 'Cancel a scheduled publish',
    description: 'Cancels a pending scheduled publish for the given post.',
  })
  @ApiParam({ name: 'postId', description: 'Content post ID (UUID).' })
  cancel(
    @CurrentUser() user: CurrentUserPayload,
    @Param('postId') postId: string,
  ) {
    return this.ai.cancelScheduled(user.userId, postId);
  }

  @Get(':publishedPostId/status')
  @ApiOperation({
    summary: 'Poll publish job status',
    description:
      'Returns the live status of a publish attempt (pending, uploading, published, failed, cancelled). Source of truth is ai-service.',
  })
  @ApiParam({ name: 'publishedPostId', description: 'Published post row ID (UUID).' })
  status(
    @CurrentUser() user: CurrentUserPayload,
    @Param('publishedPostId') id: string,
  ) {
    return this.ai.getPublishStatus(user.userId, id);
  }

  private async assertTiktokLinked(userId: string): Promise<void> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { tiktokLinked: true, zernioTiktokAccountId: true },
    });
    if (!user?.tiktokLinked || !user.zernioTiktokAccountId) {
      throw new BadRequestException(
        'TikTok account not connected. Please connect your TikTok account in Settings → Accounts first.',
      );
    }
  }
}
