import {
  BadRequestException,
  Controller,
  Post,
  PayloadTooLargeException,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  ApiBearerAuth,
  ApiConsumes,
  ApiBody,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import {
  CurrentUser,
  CurrentUserPayload,
} from '../auth/decorators/current-user.decorator';
import { MediaService } from './media.service';

const VIDEO_MAX_BYTES = 500 * 1024 * 1024;   // 500 MB
const VIDEO_MIME_TYPES = ['video/mp4', 'video/quicktime', 'video/webm', 'video/x-msvideo'];

@ApiTags('Media')
@ApiBearerAuth('access-token')
@Controller('media')
export class MediaController {
  constructor(private readonly media: MediaService) {}

  @Post('upload')
  @UseInterceptors(FileInterceptor('file'))
  @ApiConsumes('multipart/form-data')
  @ApiOperation({
    summary: 'Upload a video file for the Video Clipper pipeline',
    description: 'Accepts MP4 / MOV / WebM up to 500 MB. Returns { url, publicId }.',
  })
  @ApiBody({
    schema: {
      type: 'object',
      properties: { file: { type: 'string', format: 'binary' } },
    },
  })
  async uploadVideo(
    @CurrentUser() user: CurrentUserPayload,
    @UploadedFile() file: Express.Multer.File,
  ) {
    if (!file) throw new BadRequestException('No file provided');
    if (file.size > VIDEO_MAX_BYTES) {
      throw new PayloadTooLargeException('Video must be ≤ 500 MB');
    }
    if (!VIDEO_MIME_TYPES.includes(file.mimetype)) {
      throw new BadRequestException(
        `Unsupported video format. Allowed: ${VIDEO_MIME_TYPES.join(', ')}`,
      );
    }

    const destKey = `${user.userId}/uploads/${Date.now()}_${file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_')}`;
    return this.media.uploadBuffer(file.buffer, destKey, file.mimetype);
  }
}
