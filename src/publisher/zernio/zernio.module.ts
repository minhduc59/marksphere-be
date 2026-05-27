import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { ConfigModule } from '@nestjs/config';
import { StatusModule } from '../../status/status.module';
import { ZernioService } from './zernio.service';
import { ZernioController } from './zernio.controller';

@Module({
  imports: [ConfigModule, HttpModule.register({ timeout: 30_000 }), StatusModule],
  providers: [ZernioService],
  controllers: [ZernioController],
  exports: [ZernioService],
})
export class ZernioModule {}
