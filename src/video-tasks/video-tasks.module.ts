import { Module } from '@nestjs/common';
import { VideoTasksController } from './video-tasks.controller';
import { PrismaService } from '../prisma/prisma.service';
import { AiServiceModule } from '../ai-service/ai-service.module';

@Module({
  imports: [AiServiceModule],
  controllers: [VideoTasksController],
  providers: [PrismaService],
})
export class VideoTasksModule {}
