import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiParam,
  ApiQuery,
  ApiTags,
} from '@nestjs/swagger';
import { AiServiceClient } from '../ai-service/ai-service.client';
import {
  CurrentUser,
  CurrentUserPayload,
} from '../auth/decorators/current-user.decorator';
import { CreateTimeSlotDto } from './dto/create-time-slot.dto';
import { UpdateTimeSlotDto } from './dto/update-time-slot.dto';

@ApiTags('Time Slots')
@ApiBearerAuth('access-token')
@Controller('publish/time-slots')
export class TimeSlotsController {
  constructor(private readonly ai: AiServiceClient) {}

  @Get()
  @ApiOperation({
    summary: 'List engagement time slots',
    description:
      'Returns all configured time slots used by the auto-publish (golden hour) scheduler.',
  })
  @ApiQuery({ name: 'platform', required: false, example: 'tiktok' })
  list(
    @CurrentUser() user: CurrentUserPayload,
    @Query('platform') platform?: string,
  ) {
    return this.ai.listTimeSlots(user.userId, platform);
  }

  @Post()
  @ApiOperation({
    summary: 'Create an engagement time slot',
  })
  create(
    @CurrentUser() user: CurrentUserPayload,
    @Body() body: CreateTimeSlotDto,
  ) {
    return this.ai.createTimeSlot(user.userId, body);
  }

  @Patch(':slotId')
  @ApiOperation({ summary: 'Update an engagement time slot' })
  @ApiParam({ name: 'slotId', description: 'EngagementTimeSlot UUID' })
  update(
    @CurrentUser() user: CurrentUserPayload,
    @Param('slotId') slotId: string,
    @Body() body: UpdateTimeSlotDto,
  ) {
    return this.ai.updateTimeSlot(user.userId, slotId, body);
  }

  @Delete(':slotId')
  @HttpCode(204)
  @ApiOperation({ summary: 'Delete an engagement time slot' })
  @ApiParam({ name: 'slotId', description: 'EngagementTimeSlot UUID' })
  remove(
    @CurrentUser() user: CurrentUserPayload,
    @Param('slotId') slotId: string,
  ) {
    return this.ai.deleteTimeSlot(user.userId, slotId);
  }
}
