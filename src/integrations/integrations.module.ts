import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Integration, RoasSnapshot } from '../database/entities';
import { IntegrationsController } from './integrations.controller';
import { IntegrationsService } from './integrations.service';
import { MetaAdsService } from './meta-ads.service';
import { MetaMcpService } from './meta-mcp.service';
import { PipedreamService } from './pipedream.service';
import { RoasService } from './roas.service';
import { SheetsService } from './sheets.service';
import { StripeService } from './stripe.service';

@Module({
  imports: [TypeOrmModule.forFeature([Integration, RoasSnapshot])],
  controllers: [IntegrationsController],
  providers: [
    IntegrationsService,
    PipedreamService,
    MetaMcpService,
    MetaAdsService,
    StripeService,
    SheetsService,
    RoasService,
  ],
  exports: [
    IntegrationsService,
    PipedreamService,
    MetaMcpService,
    MetaAdsService,
    StripeService,
    SheetsService,
    RoasService,
  ],
})
export class IntegrationsModule {}
