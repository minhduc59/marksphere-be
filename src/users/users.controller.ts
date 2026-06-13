import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiNoContentResponse,
  ApiOkResponse,
  ApiOperation,
  ApiQuery,
  ApiTags,
} from '@nestjs/swagger';

import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import {
  CurrentUser,
  CurrentUserPayload,
} from '../auth/decorators/current-user.decorator';
import { UsersService } from './users.service';
import {
  AdminUserDto,
  AdminUsersPageDto,
  AdminUserStatsDto,
  CreateUserDto,
  UpdateUserDto,
} from './dto/users.dto';

/**
 * Admin User Management. JwtAuthGuard is applied globally and populates
 * request.user; RolesGuard (applied here) enforces the admin role.
 */
@ApiTags('Admin Users')
@ApiBearerAuth('access-token')
@Controller('admin/users')
@UseGuards(RolesGuard)
@Roles('admin')
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @Get()
  @ApiOperation({ summary: 'List users with usage stats (search, filter, paginate)' })
  @ApiQuery({ name: 'search', required: false, description: 'Match email or display name.' })
  @ApiQuery({ name: 'role', required: false, enum: ['admin', 'user'] })
  @ApiQuery({ name: 'tiktok', required: false, enum: ['linked', 'not_linked'] })
  @ApiQuery({ name: 'page', required: false, type: Number, example: 1 })
  @ApiQuery({ name: 'pageSize', required: false, type: Number, example: 8 })
  @ApiOkResponse({ type: AdminUsersPageDto })
  list(
    @Query('search') search?: string,
    @Query('role') role?: string,
    @Query('tiktok') tiktok?: string,
    @Query('page') pageStr = '1',
    @Query('pageSize') pageSizeStr = '8',
  ): Promise<AdminUsersPageDto> {
    const page = Math.max(parseInt(pageStr, 10) || 1, 1);
    const pageSize = Math.min(Math.max(parseInt(pageSizeStr, 10) || 8, 1), 100);
    return this.users.list({
      search: search?.trim() || undefined,
      role: role === 'admin' || role === 'user' ? role : undefined,
      tiktok:
        tiktok === 'linked' || tiktok === 'not_linked' ? tiktok : undefined,
      page,
      pageSize,
    });
  }

  @Get('stats')
  @ApiOperation({ summary: 'User KPIs: total, TikTok-linked split, new this week' })
  @ApiOkResponse({ type: AdminUserStatsDto })
  stats(): Promise<AdminUserStatsDto> {
    return this.users.stats();
  }

  @Post()
  @ApiOperation({ summary: 'Create a user (local email + password credential)' })
  @ApiCreatedResponse({ type: AdminUserDto })
  @ApiConflictResponse({ description: 'Email already in use.' })
  create(@Body() dto: CreateUserDto): Promise<AdminUserDto> {
    return this.users.create(dto);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update a user role / display name' })
  @ApiOkResponse({ type: AdminUserDto })
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateUserDto,
  ): Promise<AdminUserDto> {
    return this.users.update(id, dto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete a user' })
  @ApiNoContentResponse({ description: 'User deleted.' })
  remove(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: CurrentUserPayload,
  ): Promise<void> {
    return this.users.remove(id, user.userId);
  }
}
