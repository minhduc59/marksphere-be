import { Module } from '@nestjs/common';
import { VideoTasksController } from './video-tasks.controller';
import { AdminVideoClipsController } from './admin-video-clips.controller';
import { AdminVideoClipsService } from './admin-video-clips.service';
import { PrismaService } from '../prisma/prisma.service';
import { AiServiceModule } from '../ai-service/ai-service.module';

@Module({
  imports: [AiServiceModule],
  controllers: [VideoTasksController, AdminVideoClipsController],
  providers: [PrismaService, AdminVideoClipsService],
})
export class VideoTasksModule {}
