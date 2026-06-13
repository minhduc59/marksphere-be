import { Module } from '@nestjs/common';

import { UsersController } from './users.controller';
import { UsersService } from './users.service';

// PrismaModule is @Global, so it does not need to be imported here.
@Module({
  controllers: [UsersController],
  providers: [UsersService],
})
export class UsersModule {}
