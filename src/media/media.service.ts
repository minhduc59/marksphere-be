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

    // Cloudinary's single-request upload endpoint rejects payloads > 100 MB with
    // HTTP 413. Videos can exceed that, so send them through the chunked endpoint,
    // which streams the file in parts and has no per-request size cap. Images and
    // raw assets (e.g. fonts) stay on the simpler single-request upload.
    const options = {
      public_id: destKey,
      resource_type: resourceType,
      overwrite: true,
      invalidate: true,
    } as const;

    const result = await new Promise<UploadApiResponse>((resolve, reject) => {
      const handle = (err: unknown, result?: UploadApiResponse) => {
        if (err || !result) reject(err ?? new Error('Upload failed'));
        else resolve(result);
      };
      const uploadStream =
        resourceType === 'video'
          ? cloudinary.uploader.upload_chunked_stream(options, handle)
          : cloudinary.uploader.upload_stream(options, handle);
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
