import { Global, Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { AiServiceClient } from './ai-service.client';

@Global()
@Module({
  imports: [
    HttpModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        baseURL: config.get<string>('AI_SERVICE_URL', 'http://localhost:8000'),
        timeout: 30_000,
      }),
    }),
  ],
  providers: [AiServiceClient],
  exports: [AiServiceClient],
})
export class AiServiceModule {}
