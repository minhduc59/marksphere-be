import { Module } from '@nestjs/common';
import { TiktokAuthController } from './tiktok-auth.controller';

@Module({ controllers: [TiktokAuthController] })
export class TiktokAuthModule {}
