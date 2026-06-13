import {
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiQuery,
  ApiTags,
} from '@nestjs/swagger';

import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { AdminVideoClipsService } from './admin-video-clips.service';
import {
  AdminVideoClipDto,
  AdminVideoClipsPageDto,
  AdminVideoClipsStatsDto,
} from './dto/admin-video-clips.dto';

/**
 * Admin Video Clipping Pipeline. JwtAuthGuard is applied globally and populates
 * request.user; RolesGuard (applied here) enforces the admin role. Reads every
 * user's video-clipping jobs for the monitoring dashboard.
 */
@ApiTags('Admin Video Clips')
@ApiBearerAuth('access-token')
@Controller('admin/video-clips')
@UseGuards(RolesGuard)
@Roles('admin')
export class AdminVideoClipsController {
  constructor(private readonly clips: AdminVideoClipsService) {}

  @Get()
  @ApiOperation({ summary: 'List video-clipping jobs across all users' })
  @ApiQuery({ name: 'status', required: false, description: 'VideoTask status' })
  @ApiQuery({ name: 'search', required: false, description: 'Match source ref.' })
  @ApiQuery({ name: 'page', required: false, type: Number, example: 1 })
  @ApiQuery({ name: 'pageSize', required: false, type: Number, example: 8 })
  @ApiOkResponse({ type: AdminVideoClipsPageDto })
  list(
    @Query('status') status?: string,
    @Query('search') search?: string,
    @Query('page') pageStr = '1',
    @Query('pageSize') pageSizeStr = '8',
  ): Promise<AdminVideoClipsPageDto> {
    const page = Math.max(parseInt(pageStr, 10) || 1, 1);
    const pageSize = Math.min(Math.max(parseInt(pageSizeStr, 10) || 8, 1), 100);
    return this.clips.list({
      status: status?.trim() || undefined,
      search: search?.trim() || undefined,
      page,
      pageSize,
    });
  }

  @Get('stats')
  @ApiOperation({
    summary: 'Pipeline KPIs: produced today, in-progress, failed, avg time',
  })
  @ApiOkResponse({ type: AdminVideoClipsStatsDto })
  stats(): Promise<AdminVideoClipsStatsDto> {
    return this.clips.stats();
  }

  @Get(':taskId/clips')
  @ApiOperation({ summary: 'List the produced clips for a task' })
  @ApiParam({ name: 'taskId', description: 'VideoTask UUID' })
  @ApiOkResponse({ type: [AdminVideoClipDto] })
  listClips(
    @Param('taskId', ParseUUIDPipe) taskId: string,
  ): Promise<AdminVideoClipDto[]> {
    return this.clips.getTaskClips(taskId);
  }

  @Post(':taskId/retry')
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({ summary: 'Re-trigger the pipeline for a task' })
  @ApiParam({ name: 'taskId', description: 'VideoTask UUID' })
  retry(
    @Param('taskId', ParseUUIDPipe) taskId: string,
  ): Promise<unknown> {
    return this.clips.retry(taskId);
  }
}
