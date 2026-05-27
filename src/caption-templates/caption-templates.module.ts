import { Module } from '@nestjs/common';
import { CaptionTemplatesController } from './caption-templates.controller';
import { PrismaService } from '../prisma/prisma.service';

@Module({
  controllers: [CaptionTemplatesController],
  providers: [PrismaService],
})
export class CaptionTemplatesModule {}
