import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOkResponse,
  ApiOperation,
  ApiQuery,
  ApiTags,
} from '@nestjs/swagger';

import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { AdminService } from './admin.service';
import { MonitoringService } from './monitoring.service';
import { OverviewResponseDto } from './dto/overview-response.dto';
import {
  ErrorLogPageDto,
  ErrorSeverity,
  PipelineHealthDto,
} from './dto/monitoring.dto';

@ApiTags('Admin')
@ApiBearerAuth('access-token')
@Controller('admin')
// JwtAuthGuard is applied globally and populates request.user; RolesGuard
// (applied here) then enforces the admin role.
@UseGuards(RolesGuard)
@Roles('admin')
export class AdminController {
  constructor(
    private readonly admin: AdminService,
    private readonly monitoring: MonitoringService,
  ) {}

  @Get('overview')
  @ApiOperation({
    summary: 'Admin Overview dashboard data (KPIs, charts, system health)',
    description:
      'Single aggregated payload for the Admin Overview page. Requires the admin role.',
  })
  overview(): Promise<OverviewResponseDto> {
    return this.admin.getOverview();
  }

  @Get('monitoring/pipelines')
  @ApiOperation({ summary: 'Live health of the four processing pipelines' })
  @ApiOkResponse({ type: [PipelineHealthDto] })
  pipelines(): Promise<PipelineHealthDto[]> {
    return this.monitoring.getPipelines();
  }

  @Get('monitoring/errors')
  @ApiOperation({ summary: 'Unified system error log (filter + paginate)' })
  @ApiQuery({
    name: 'severity',
    required: false,
    enum: ['CRITICAL', 'WARNING', 'INFO'],
  })
  @ApiQuery({ name: 'page', required: false, type: Number, example: 1 })
  @ApiQuery({ name: 'pageSize', required: false, type: Number, example: 25 })
  @ApiOkResponse({ type: ErrorLogPageDto })
  errors(
    @Query('severity') severity?: string,
    @Query('page') pageStr = '1',
    @Query('pageSize') pageSizeStr = '25',
  ): Promise<ErrorLogPageDto> {
    const page = Math.max(parseInt(pageStr, 10) || 1, 1);
    const pageSize = Math.min(Math.max(parseInt(pageSizeStr, 10) || 25, 1), 100);
    const sev =
      severity === 'CRITICAL' || severity === 'WARNING' || severity === 'INFO'
        ? (severity as ErrorSeverity)
        : 'all';
    return this.monitoring.getErrors({ severity: sev, page, pageSize });
  }
}
