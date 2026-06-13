import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';

import { AdminController } from './admin.controller';
import { AdminService } from './admin.service';
import { MonitoringService } from './monitoring.service';

// PrismaModule is @Global; HttpModule is imported here for the FastAPI
// health probe (the @Global AiServiceModule does not re-export HttpService).
@Module({
  imports: [HttpModule],
  controllers: [AdminController],
  providers: [AdminService, MonitoringService],
})
export class AdminModule {}
