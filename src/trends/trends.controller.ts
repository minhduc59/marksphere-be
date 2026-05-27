import { Controller, Get, NotFoundException, Param, Query } from '@nestjs/common';
import { Sentiment, TrendLifecycle } from '@prisma/client';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiParam,
  ApiQuery,
  ApiTags,
} from '@nestjs/swagger';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Trends are global (shared HackerNews data). No user filtering.
 * All reads go directly to Postgres via Prisma for low-latency list/detail
 * and do not touch ai-service.
 */
@ApiTags('Trends')
@ApiBearerAuth('access-token')
@Controller('trends')
export class TrendsController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  @ApiOperation({
    summary: 'List trend items',
    description:
      'Returns globally-shared trend items discovered by past scan runs. Reads from Postgres — does not touch ai-service. Ordered by relevance score descending.',
  })
  @ApiQuery({ name: 'category', required: false, description: 'Filter by AI-assigned category (e.g. `ai`, `devtools`).' })
  @ApiQuery({ name: 'sentiment', required: false, enum: ['positive', 'neutral', 'negative'] })
  @ApiQuery({ name: 'lifecycle', required: false, enum: ['emerging', 'growing', 'peak', 'declining'] })
  @ApiQuery({ name: 'minScore', required: false, type: Number, description: 'Minimum LinkedIn relevance score (0–1).' })
  @ApiQuery({ name: 'page', required: false, type: Number, example: 1 })
  @ApiQuery({ name: 'pageSize', required: false, type: Number, example: 20 })
  async list(
    @Query('category') category?: string,
    @Query('sentiment') sentiment?: string,
    @Query('lifecycle') lifecycle?: string,
    @Query('minScore') minScore?: string,
    @Query('page') pageStr = '1',
    @Query('pageSize') pageSizeStr = '20',
  ) {
    const page = Math.max(parseInt(pageStr, 10) || 1, 1);
    const pageSize = Math.min(Math.max(parseInt(pageSizeStr, 10) || 20, 1), 100);
    const where = {
      ...(category && { category }),
      ...(sentiment && { sentiment: sentiment as Sentiment }),
      ...(lifecycle && { lifecycle: lifecycle as TrendLifecycle }),
      ...(minScore && { relevanceScore: { gte: parseFloat(minScore) } }),
    };

    const [items, total] = await Promise.all([
      this.prisma.trendItem.findMany({
        where,
        orderBy: { relevanceScore: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.trendItem.count({ where }),
    ]);

    return { items, total, page, pageSize };
  }

  @Get('top')
  @ApiOperation({
    summary: 'Top trends in a time window',
    description: 'Returns up to 10 top-scoring trends discovered in the last 24 hours, 7 days, or 30 days.',
  })
  @ApiQuery({
    name: 'window',
    required: false,
    enum: ['24h', '7d', '30d'],
    example: '24h',
  })
  async top(@Query('window') window = '24h') {
    const hours = window === '7d' ? 168 : window === '30d' ? 720 : 24;
    const since = new Date(Date.now() - hours * 60 * 60 * 1000);
    return this.prisma.trendItem.findMany({
      where: { discoveredAt: { gte: since } },
      orderBy: { relevanceScore: 'desc' },
      take: 10,
    });
  }

  @Get(':id')
  @ApiOperation({
    summary: 'Get a trend item by ID',
    description: 'Returns full trend detail including AI analysis fields (category, sentiment, lifecycle, relevance_score).',
  })
  @ApiParam({ name: 'id', description: 'Trend item ID (UUID).' })
  async detail(@Param('id') id: string) {
    const row = await this.prisma.trendItem.findUnique({ where: { id } });
    if (!row) throw new NotFoundException('Trend not found');
    return row;
  }
}
