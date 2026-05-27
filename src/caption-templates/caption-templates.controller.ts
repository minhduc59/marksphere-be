import { Body, Controller, Get, Post } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiBody,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import {
  CurrentUser,
  CurrentUserPayload,
} from '../auth/decorators/current-user.decorator';
import { PrismaService } from '../prisma/prisma.service';
import { CreateCaptionTemplateDto } from './dto/create-caption-template.dto';

@ApiTags('Caption Templates')
@ApiBearerAuth('access-token')
@Controller('caption-templates')
export class CaptionTemplatesController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  @ApiOperation({ summary: 'List caption templates for the current user' })
  async list(@CurrentUser() user: CurrentUserPayload) {
    return this.prisma.captionTemplate.findMany({
      where: { OR: [{ userId: user.userId }, { userId: null }] },
      orderBy: { createdAt: 'desc' },
    });
  }

  @Post()
  @ApiOperation({ summary: 'Create a new caption template' })
  @ApiBody({ type: CreateCaptionTemplateDto })
  async create(
    @CurrentUser() user: CurrentUserPayload,
    @Body() dto: CreateCaptionTemplateDto,
  ) {
    return this.prisma.captionTemplate.create({
      data: {
        userId: user.userId,
        name: dto.name,
        fontSize: dto.fontSize ?? 40,
        color: dto.color ?? '#FFFFFF',
        outlineColor: dto.outlineColor ?? '#000000',
        outlineWidth: dto.outlineWidth ?? 2,
        verticalPosition: dto.verticalPosition ?? 'bottom',
        isDefault: dto.isDefault ?? false,
      },
    });
  }
}
