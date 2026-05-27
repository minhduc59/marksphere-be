import { Module } from '@nestjs/common';
import { PublisherModule } from '../publisher/publisher.module';
import { PublishController } from './publish.controller';
import { TimeSlotsController } from './time-slots.controller';

@Module({
  imports: [PublisherModule],
  controllers: [PublishController, TimeSlotsController],
})
export class PublishModule {}
