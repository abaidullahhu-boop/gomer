import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { UsageModule } from '../usage/usage.module';
import { BillingController } from './billing.controller';
import { BillingService } from './billing.service';

@Module({
  imports: [ConfigModule, UsageModule],
  controllers: [BillingController],
  providers: [BillingService],
  exports: [BillingService],
})
export class BillingModule {}
