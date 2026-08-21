import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CreditEvent, CreditGrant, ScheduledTask } from '../database/entities';
import { UsageController } from './usage.controller';
import { UsageService } from './usage.service';
import { UsersModule } from '../users/users.module';

@Module({
  imports: [TypeOrmModule.forFeature([CreditEvent, CreditGrant, ScheduledTask]), UsersModule],
  controllers: [UsageController],
  providers: [UsageService],
  exports: [UsageService],
})
export class UsageModule {}
