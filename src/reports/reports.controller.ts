import { Controller, Get, NotFoundException, Param, Query } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiParam,
  ApiQuery,
  ApiTags,
} from '@nestjs/swagger';
import { PrismaService } from '../prisma/prisma.service';
import {
  CurrentUser,
  CurrentUserPayload,
} from '../auth/decorators/current-user.decorator';

/**
 * Reports are scan-run-scoped, so we filter by triggeredBy to keep
 * the list per-user. Report content itself (markdown files on disk)
 * is served via the ai-service static mount.
 */
@ApiTags('Reports')
@ApiBearerAuth('access-token')
@Controller('reports')
export class ReportsController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  @ApiOperation({
    summary: 'List generated reports',
    description:
      'Paginated list of scan runs that produced a markdown report. The report body itself is served by the ai-service static mount.',
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
    const where = {
      triggeredBy: user.userId,
      reportFilePath: { not: null },
    };
    const [items, total] = await Promise.all([
      this.prisma.scanRun.findMany({
        where,
        orderBy: { completedAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
        select: {
          id: true,
          status: true,
          totalItemsFound: true,
          startedAt: true,
          completedAt: true,
          reportFilePath: true,
        },
      }),
      this.prisma.scanRun.count({ where }),
    ]);
    return { items, total, page, pageSize };
  }

  @Get(':scanRunId')
  @ApiOperation({
    summary: 'Get report metadata for a scan run',
    description: 'Returns the scan-run row including `reportFilePath` pointing at the generated markdown file.',
  })
  @ApiParam({ name: 'scanRunId', description: 'Scan run ID (UUID).' })
  async detail(
    @CurrentUser() user: CurrentUserPayload,
    @Param('scanRunId') scanRunId: string,
  ) {
    const run = await this.prisma.scanRun.findFirst({
      where: { id: scanRunId, triggeredBy: user.userId },
      select: {
        id: true,
        status: true,
        totalItemsFound: true,
        startedAt: true,
        completedAt: true,
        reportFilePath: true,
      },
    });
    if (!run) throw new NotFoundException('Report not found');
    return run;
  }
}
