import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Integration } from '../database/entities';
import { IntegrationsController } from './integrations.controller';
import { IntegrationsService } from './integrations.service';
import { MetaAdsService } from './meta-ads.service';
import { MetaMcpService } from './meta-mcp.service';
import { PipedreamService } from './pipedream.service';

@Module({
  imports: [TypeOrmModule.forFeature([Integration])],
  controllers: [IntegrationsController],
  providers: [IntegrationsService, PipedreamService, MetaMcpService, MetaAdsService],
  exports: [IntegrationsService, PipedreamService, MetaMcpService, MetaAdsService],
})
export class IntegrationsModule {}
