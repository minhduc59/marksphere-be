import {
  Body,
  Controller,
  Get,
  HttpCode,
  NotFoundException,
  Param,
  Post,
  Query,
} from '@nestjs/common';
import {
  ApiBody,
  ApiBearerAuth,
  ApiOperation,
  ApiParam,
  ApiQuery,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { PrismaService } from '../prisma/prisma.service';
import { AiServiceClient } from '../ai-service/ai-service.client';
import {
  CurrentUser,
  CurrentUserPayload,
} from '../auth/decorators/current-user.decorator';
import { TriggerScanDto } from './dto/trigger-scan.dto';

@ApiTags('Scans')
@ApiBearerAuth('access-token')
@Controller('scans')
export class ScansController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ai: AiServiceClient,
  ) {}

  @Get()
  @ApiOperation({
    summary: 'List scan runs triggered by the current user',
    description: 'Paginated list ordered by `startedAt` descending.',
  })
  @ApiQuery({ name: 'page', required: false, type: Number, example: 1 })
  @ApiQuery({ name: 'pageSize', required: false, type: Number, example: 20 })
  async list(
    @CurrentUser() user: CurrentUserPayload,
    @Query('page') pageStr = '1',
    @Query('pageSize') pageSizeStr = '20',
  ) {
    const page = Math.max(parseInt(pageStr, 10) || 1, 1);
    const pageSize = Math.min(
      Math.max(parseInt(pageSizeStr, 10) || 20, 1),
      100,
    );
    const where = { triggeredBy: user.userId };
    const [items, total] = await Promise.all([
      this.prisma.scanRun.findMany({
        where,
        orderBy: { startedAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.scanRun.count({ where }),
    ]);
    return { items, total, page, pageSize };
  }

  @Get(':id')
  @ApiOperation({
    summary: 'Get a scan run by ID',
    description: 'Returns the persisted scan run record (from Postgres).',
  })
  @ApiParam({ name: 'id', description: 'Scan run ID (UUID).' })
  async detail(
    @CurrentUser() user: CurrentUserPayload,
    @Param('id') id: string,
  ) {
    const row = await this.prisma.scanRun.findFirst({
      where: { id, triggeredBy: user.userId },
    });
    if (!row) throw new NotFoundException('Scan not found');
    return row;
  }

  @Post()
  @HttpCode(202)
  @ApiOperation({
    summary: 'Trigger a new scan run',
    description:
      'Starts an async HackerNews technology trend scan that crawls trending articles, ' +
      'analyzes them with GPT-4o, and optionally generates content posts.\n\n' +
      'Returns immediately with a `scan_id` and `pending` status. ' +
      'Poll `GET /scans/{id}/status` to track progress.\n\n' +
      '**Pipeline:**\n' +
      '1. **Crawl** — fetch top HackerNews stories, extract articles, filter by tech relevance\n' +
      '2. **Analyze** — GPT-4o categorization, sentiment, lifecycle, relevance scoring\n' +
      '3. **Save content** — persist articles as markdown files\n' +
      '4. **Report** — generate trend report + content angles\n' +
      '5. **Generate posts** *(when `generate_posts=true`)* — auto-generate posts from top trends\n\n' +
      'When `generate_posts` is enabled (default), the system automatically runs the post-generation ' +
      'pipeline after analysis: strategy alignment → content generation → image prompts → ' +
      'image generation → auto-review → output packaging. Generated posts appear in `GET /posts`.',
  })
  @ApiResponse({ status: 202, description: 'Scan accepted and queued.' })
  @ApiResponse({ status: 422, description: 'Invalid request body.' })
  @ApiBody({
    type: TriggerScanDto,
    examples: {
      default: {
        summary: 'Default scan with post generation',
        value: {
          platforms: ['hackernews'],
          options: {
            max_items_per_platform: 50,
            include_comments: true,
            quality_threshold: 5,
            generate_posts: true,
            post_gen_options: {
              num_posts: 3,
              formats: null,
            },
          },
        },
      },
      minimal: {
        summary: 'Minimal (all defaults)',
        value: {},
      },
      scan_only: {
        summary: 'Scan without post generation',
        value: {
          platforms: ['hackernews'],
          options: {
            generate_posts: false,
          },
        },
      },
    },
  })
  trigger(
    @CurrentUser() user: CurrentUserPayload,
    @Body() dto: TriggerScanDto,
  ) {
    return this.ai.triggerScan(user.userId, dto);
  }

  /**
   * Live status comes from ai-service (the source of truth while the
   * background task is running). Once a scan completes, Prisma would
   * work too — but proxying keeps the response identical for clients.
   */
  @Get(':id/status')
  @ApiOperation({
    summary: 'Poll scan run status',
    description:
      'Live status comes from ai-service (source of truth while the background task is running). Safe to poll every 2–5 seconds.',
  })
  @ApiParam({ name: 'id', description: 'Scan run ID (UUID).' })
  status(
    @CurrentUser() user: CurrentUserPayload,
    @Param('id') id: string,
  ) {
    return this.ai.getScanStatus(user.userId, id);
  }
}
