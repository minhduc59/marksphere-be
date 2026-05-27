import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { AiServiceModule } from '../ai-service/ai-service.module';
import { StatusGateway } from './status.gateway';

@Module({
  imports: [ConfigModule, JwtModule.register({}), AiServiceModule],
  providers: [StatusGateway],
  exports: [StatusGateway],
})
export class StatusModule {}
