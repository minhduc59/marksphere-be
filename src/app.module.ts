import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler';
import { APP_GUARD } from '@nestjs/core';
import { PrismaModule } from './prisma/prisma.module';
import { AuthModule } from './auth/auth.module';
import { UsersModule } from './users/users.module';
import { AiServiceModule } from './ai-service/ai-service.module';
import { TrendsModule } from './trends/trends.module';
import { ScansModule } from './scans/scans.module';
import { PostsModule } from './posts/posts.module';
import { PublishModule } from './publish/publish.module';
import { ReportsModule } from './reports/reports.module';
import { TiktokAuthModule } from './tiktok-auth/tiktok-auth.module';
import { StatusModule } from './status/status.module';
import { PublisherModule } from './publisher/publisher.module';
import { VideoTasksModule } from './video-tasks/video-tasks.module';
import { VideoClipsModule } from './video-clips/video-clips.module';
import { FontsModule } from './fonts/fonts.module';
import { CaptionTemplatesModule } from './caption-templates/caption-templates.module';
import { MediaModule } from './media/media.module';
import { JwtAuthGuard } from './auth/guards/jwt-auth.guard';
import { HealthController } from './common/health.controller';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    ThrottlerModule.forRoot([{ ttl: 60_000, limit: 100 }]),
    PrismaModule,
    AiServiceModule,
    AuthModule,
    UsersModule,
    TrendsModule,
    ScansModule,
    PostsModule,
    PublishModule,
    ReportsModule,
    TiktokAuthModule,
    StatusModule,
    PublisherModule,
    VideoTasksModule,
    VideoClipsModule,
    FontsModule,
    CaptionTemplatesModule,
    MediaModule,
  ],
  controllers: [HealthController],
  providers: [
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useClass: JwtAuthGuard },
  ],
})
export class AppModule {}
