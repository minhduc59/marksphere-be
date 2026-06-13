import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Logger,
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
  ApiProperty,
  ApiQuery,
  ApiTags,
} from '@nestjs/swagger';
import { IsIn, IsString } from 'class-validator';
import { ContentStatus, PostFormat } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AiServiceClient } from '../ai-service/ai-service.client';
import {
  CurrentUser,
  CurrentUserPayload,
} from '../auth/decorators/current-user.decorator';
import { CreateFromArticleDto } from './dto/create-from-article.dto';
import { ReviewPostDto } from './dto/review-post.dto';

const CONTENT_STATUSES = [
  'draft',
  'approved',
  'needs_revision',
  'flagged_for_review',
  'published',
  'failed',
] as const;

class UpdateStatusDto {
  @ApiProperty({
    enum: CONTENT_STATUSES,
    description: 'New workflow status for the content post.',
    example: 'approved',
  })
  @IsString()
  @IsIn(CONTENT_STATUSES as unknown as string[])
  status!: (typeof CONTENT_STATUSES)[number];
}

@ApiTags('Posts')
@ApiBearerAuth('access-token')
@Controller('posts')
export class PostsController {
  private readonly logger = new Logger(PostsController.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly ai: AiServiceClient,
  ) {}

  @Get()
  @ApiOperation({
    summary: 'List content posts for the current user',
    description:
      'Returns a paginated list of AI-generated posts owned by the caller. Filter by scan run, target format, or workflow status.',
  })
  @ApiQuery({ name: 'scanRunId', required: false, description: 'Filter to posts generated from a specific scan run.' })
  @ApiQuery({ name: 'format', required: false, description: 'Target format (e.g. `linkedin`, `tiktok`).' })
  @ApiQuery({ name: 'status', required: false, enum: CONTENT_STATUSES })
  @ApiQuery({ name: 'page', required: false, type: Number, example: 1 })
  @ApiQuery({ name: 'pageSize', required: false, type: Number, example: 20, description: 'Page size (1–100).' })
  async list(
    @CurrentUser() user: CurrentUserPayload,
    @Query('scanRunId') scanRunId?: string,
    @Query('format') format?: string,
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
      OR: [{ createdBy: user.userId }, { createdBy: null }],
      ...(scanRunId && { scanRunId }),
      ...(format && { format: format as PostFormat }),
      ...(status && { status: status as ContentStatus }),
    };
    const [items, total] = await Promise.all([
      this.prisma.contentPost.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.contentPost.count({ where }),
    ]);
    return { items, total, page, pageSize };
  }

  @Get(':id')
  @ApiOperation({
    summary: 'Get a content post by ID',
    description: 'Returns a single post if it belongs to the current user.',
  })
  @ApiParam({ name: 'id', description: 'Content post ID (UUID).' })
  async detail(
    @CurrentUser() user: CurrentUserPayload,
    @Param('id') id: string,
  ) {
    const row = await this.prisma.contentPost.findFirst({
      where: { id, createdBy: user.userId },
    });
    if (!row) throw new NotFoundException('Post not found');
    return row;
  }

  @Post('generate')
  @ApiOperation({
    summary: 'Generate content posts from a trend or scan run',
    description:
      'Proxies to the FastAPI ai-service which runs the LangGraph post-generator pipeline. The request body is forwarded as-is; see ai-service `/api/v1/posts/generate` for the full contract.',
  })
  @ApiBody({
    description: 'Post-generator input (passthrough to ai-service).',
    schema: {
      type: 'object',
      additionalProperties: true,
      example: {
        scanRunId: '01J...',
        trendItemId: '01J...',
        format: 'linkedin',
        tone: 'professional',
        languages: ['vi', 'en'],
      },
    },
  })
  generate(
    @CurrentUser() user: CurrentUserPayload,
    @Body() body: Record<string, unknown>,
  ) {
    return this.ai.generatePosts(user.userId, body);
  }

  @Post('from-article')
  @HttpCode(202)
  @ApiOperation({
    summary: 'Generate posts from a single article URL (express pipeline)',
    description:
      'Crawls the article, builds a Stage-3-equivalent report, and runs the standard post-generation pipeline. Returns 202 with a `pipeline_id` the client can subscribe to via WebSocket (`pipeline:<id>`) for unified scan → generate → publish progress.',
  })
  fromArticle(
    @CurrentUser() user: CurrentUserPayload,
    @Body() dto: CreateFromArticleDto,
  ) {
    return this.ai.createPostFromArticle(user.userId, dto);
  }

  /**
   * Narrow write path into `ai.content_posts`. This is one of the
   * documented mutation surfaces the backend DB role has grant on.
   * We don't proxy to FastAPI because this is a plain UI action.
   */
  @Patch(':id/status')
  @ApiOperation({
    summary: 'Update a post\'s workflow status',
    description:
      'Transitions a post between workflow states (draft → approved → published, etc). Writes an audit log entry.',
  })
  @ApiParam({ name: 'id', description: 'Content post ID (UUID).' })
  async updateStatus(
    @CurrentUser() user: CurrentUserPayload,
    @Param('id') id: string,
    @Body() dto: UpdateStatusDto,
  ) {
    const existing = await this.prisma.contentPost.findFirst({
      where: { id, createdBy: user.userId },
      select: { id: true },
    });
    if (!existing) throw new NotFoundException('Post not found');

    const [updated] = await this.prisma.$transaction([
      this.prisma.contentPost.update({
        where: { id },
        data: { status: dto.status as ContentStatus, updatedAt: new Date() },
      }),
      this.prisma.auditLog.create({
        data: {
          userId: user.userId,
          action: 'post.status.update',
          resource: 'content_post',
          resourceId: id,
          metadata: { newStatus: dto.status },
        },
      }),
    ]);
    return updated;
  }

  @Post(':id/review')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Approve or reject a post, writing to post_review_events',
  })
  @ApiParam({ name: 'id', description: 'Content post ID (UUID).' })
  async review(
    @CurrentUser() user: CurrentUserPayload,
    @Param('id') id: string,
    @Body() dto: ReviewPostDto,
  ) {
    const existing = await this.prisma.contentPost.findFirst({
      where: { id, createdBy: user.userId },
      select: { id: true },
    });
    if (!existing) throw new NotFoundException('Post not found');

    const newStatus =
      dto.action === 'approve'
        ? ContentStatus.approved
        : ContentStatus.needs_revision;

    await this.prisma.$transaction([
      this.prisma.contentPost.update({
        where: { id },
        data: {
          status: newStatus,
          ...(dto.feedback && { reviewNotes: dto.feedback }),
          updatedAt: new Date(),
        },
      }),
      this.prisma.postReviewEvent.create({
        data: {
          contentPostId: id,
          userId: user.userId,
          action: dto.action,
          feedback: dto.feedback,
        },
      }),
      this.prisma.auditLog.create({
        data: {
          userId: user.userId,
          action: `post.review.${dto.action}`,
          resource: 'content_post',
          resourceId: id,
          metadata: { action: dto.action, feedback: dto.feedback },
        },
      }),
    ]);

    // On reject with feedback, kick off regeneration in the AI service.
    // Fire-and-forget: the AI service flips the row to `regenerating` then
    // back to `draft` (or `flagged_for_review` on failure); the frontend
    // polls GET /posts/:id to observe the transition.
    if (dto.action === 'reject' && dto.feedback) {
      this.ai
        .regeneratePost(user.userId, id, { feedback: dto.feedback })
        .catch(async (err: unknown) => {
          this.logger.error(
            `regeneratePost failed for ${id}: ${(err as Error).message ?? err}`,
          );
          // Mark the row so the frontend can surface a useful error instead
          // of polling forever on a `needs_revision` post.
          await this.prisma.contentPost
            .update({
              where: { id },
              data: {
                status: ContentStatus.flagged_for_review,
                reviewNotes: `Regeneration request failed: ${
                  (err as Error).message ?? 'unknown error'
                }`,
                updatedAt: new Date(),
              },
            })
            .catch(() => undefined);
        });
    }

    return { id, status: newStatus, action: dto.action };
  }

  @Post(':id/retry')
  @HttpCode(202)
  @ApiOperation({
    summary: 'Retry a post that failed mid-pipeline',
    description:
      'For posts in the `failed` state (a pipeline stage errored). Re-runs ' +
      'generation from scratch via the AI service. No feedback needed — unlike ' +
      '/review, this is an error recovery, not a quality rejection. Poll ' +
      'GET /posts/:id to observe the regenerating → draft transition.',
  })
  @ApiParam({ name: 'id', description: 'Content post ID (UUID).' })
  async retry(
    @CurrentUser() user: CurrentUserPayload,
    @Param('id') id: string,
  ) {
    const existing = await this.prisma.contentPost.findFirst({
      where: { id, createdBy: user.userId },
      select: { id: true, status: true },
    });
    if (!existing) throw new NotFoundException('Post not found');
    if (existing.status !== ContentStatus.failed) {
      throw new NotFoundException(
        `Post is not in a failed state (current: ${existing.status})`,
      );
    }

    await this.ai.regeneratePost(user.userId, id, { feedback: '' });
    return { id, status: 'regenerating' };
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Delete a post',
    description:
      'Hard-deletes a content post (and its publish records via cascade). ' +
      'Published posts cannot be deleted (returns 409 from the AI service).',
  })
  @ApiParam({ name: 'id', description: 'Content post ID (UUID).' })
  async remove(@CurrentUser() user: CurrentUserPayload, @Param('id') id: string) {
    return this.ai.deletePost(user.userId, id);
  }
}
