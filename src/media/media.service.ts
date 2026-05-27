/**
 * MediaService — the ONLY place in the NestJS backend that imports the Cloudinary SDK.
 * All new media upload code must go through this service.
 */
import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { v2 as cloudinary, UploadApiResponse } from 'cloudinary';
import { Readable } from 'stream';

@Injectable()
export class MediaService implements OnModuleInit {
  private readonly logger = new Logger(MediaService.name);

  constructor(private readonly config: ConfigService) {}

  onModuleInit() {
    cloudinary.config({
      cloud_name: this.config.getOrThrow<string>('CLOUDINARY_CLOUD_NAME'),
      api_key: this.config.getOrThrow<string>('CLOUDINARY_API_KEY'),
      api_secret: this.config.getOrThrow<string>('CLOUDINARY_API_SECRET'),
      secure: true,
    });
    this.logger.log('Cloudinary configured');
  }

  /** Upload a Buffer to Cloudinary. Returns { url, publicId }. */
  async uploadBuffer(
    buffer: Buffer,
    destKey: string,
    contentType: string,
  ): Promise<{ url: string; publicId: string }> {
    const resourceType: 'image' | 'video' | 'raw' = contentType.startsWith('video/')
      ? 'video'
      : contentType.startsWith('image/')
        ? 'image'
        : 'raw';

    const result = await new Promise<UploadApiResponse>((resolve, reject) => {
      const uploadStream = cloudinary.uploader.upload_stream(
        { public_id: destKey, resource_type: resourceType, overwrite: true, invalidate: true },
        (err, result) => {
          if (err || !result) reject(err ?? new Error('Upload failed'));
          else resolve(result);
        },
      );
      Readable.from(buffer).pipe(uploadStream);
    });

    this.logger.debug(`MediaService: uploaded ${destKey} → ${result.secure_url.slice(0, 80)}`);
    return { url: result.secure_url, publicId: result.public_id };
  }

  /** Upload a video by public URL (for video tasks where the source is already online). */
  async uploadFromUrl(
    sourceUrl: string,
    destKey: string,
  ): Promise<{ url: string; publicId: string }> {
    const result = await cloudinary.uploader.upload(sourceUrl, {
      public_id: destKey,
      resource_type: 'video',
      overwrite: true,
      invalidate: true,
    });
    return { url: result.secure_url, publicId: result.public_id };
  }
}
