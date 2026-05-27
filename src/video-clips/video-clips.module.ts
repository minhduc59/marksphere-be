import { Module } from '@nestjs/common';
import { VideoClipsController } from './video-clips.controller';
import { PrismaService } from '../prisma/prisma.service';
import { AiServiceModule } from '../ai-service/ai-service.module';

@Module({
  imports: [AiServiceModule],
  controllers: [VideoClipsController],
  providers: [PrismaService],
})
export class VideoClipsModule {}
