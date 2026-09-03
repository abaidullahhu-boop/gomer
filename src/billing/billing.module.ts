import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CreditGrant, Subscription } from '../database/entities';
import { UsageModule } from '../usage/usage.module';
import { UsersModule } from '../users/users.module';
import { BillingController } from './billing.controller';
import { BillingService } from './billing.service';
import { SubscriptionsService } from './subscriptions.service';

@Module({
  imports: [
    ConfigModule,
    TypeOrmModule.forFeature([Subscription, CreditGrant]),
    UsageModule,
    UsersModule,
  ],
  controllers: [BillingController],
  providers: [BillingService, SubscriptionsService],
  exports: [BillingService, SubscriptionsService],
})
export class BillingModule {}
