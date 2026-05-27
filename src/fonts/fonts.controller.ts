import {
  Controller,
  Get,
  Post,
  Body,
  UploadedFile,
  UseInterceptors,
  BadRequestException,
  PayloadTooLargeException,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  ApiBearerAuth,
  ApiBody,
  ApiConsumes,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import {
  CurrentUser,
  CurrentUserPayload,
} from '../auth/decorators/current-user.decorator';
import { PrismaService } from '../prisma/prisma.service';
import { MediaService } from '../media/media.service';
import { CreateFontDto } from './dto/create-font.dto';

const FONT_MAX_BYTES = 5 * 1024 * 1024; // 5 MB
const FONT_EXTENSIONS = ['.ttf', '.otf', '.woff2'];

@ApiTags('Fonts')
@ApiBearerAuth('access-token')
@Controller('fonts')
export class FontsController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly media: MediaService,
  ) {}

  @Get()
  @ApiOperation({ summary: 'List brand fonts for the current user' })
  async list(@CurrentUser() user: CurrentUserPayload) {
    return this.prisma.brandFont.findMany({
      where: { OR: [{ userId: user.userId }, { userId: null }] },
      orderBy: { createdAt: 'desc' },
    });
  }

  @Post()
  @UseInterceptors(FileInterceptor('file'))
  @ApiConsumes('multipart/form-data')
  @ApiOperation({ summary: 'Upload a font file and create a BrandFont record' })
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        file: { type: 'string', format: 'binary' },
        name: { type: 'string' },
        isDefault: { type: 'boolean' },
      },
    },
  })
  async upload(
    @CurrentUser() user: CurrentUserPayload,
    @UploadedFile() file: Express.Multer.File,
    @Body() dto: CreateFontDto,
  ) {
    if (!file) throw new BadRequestException('No font file provided');
    if (file.size > FONT_MAX_BYTES) {
      throw new PayloadTooLargeException('Font file must be ≤ 5 MB');
    }
    const ext = '.' + file.originalname.split('.').pop()?.toLowerCase();
    if (!FONT_EXTENSIONS.includes(ext)) {
      throw new BadRequestException(
        `Unsupported font format. Allowed: ${FONT_EXTENSIONS.join(', ')}`,
      );
    }

    const destKey = `${user.userId}/fonts/${Date.now()}${ext}`;
    const { url, publicId } = await this.media.uploadBuffer(
      file.buffer,
      destKey,
      file.mimetype || 'font/ttf',
    );

    return this.prisma.brandFont.create({
      data: {
        userId: user.userId,
        name: dto.name ?? file.originalname.replace(/\.[^.]+$/, ''),
        storageUrl: url,
        storagePublicId: publicId,
        isDefault: dto.isDefault ?? false,
      },
    });
  }
}
