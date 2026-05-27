import { Module } from '@nestjs/common';
import { MulterModule } from '@nestjs/platform-express';
import { FontsController } from './fonts.controller';
import { PrismaService } from '../prisma/prisma.service';
import { MediaModule } from '../media/media.module';

@Module({
  imports: [
    MulterModule.register({ limits: { fileSize: 5 * 1024 * 1024 } }),
    MediaModule,
  ],
  controllers: [FontsController],
  providers: [PrismaService],
})
export class FontsModule {}
