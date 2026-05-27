import { Module } from '@nestjs/common';
import { ZernioModule } from './zernio/zernio.module';
import { ZernioService } from './zernio/zernio.service';
import { TIKTOK_PUBLISHER } from './tiktok-publisher.interface';

@Module({
  imports: [ZernioModule],
  providers: [
    {
      provide: TIKTOK_PUBLISHER,
      useExisting: ZernioService,
    },
  ],
  exports: [TIKTOK_PUBLISHER, ZernioModule],
})
export class PublisherModule {}
