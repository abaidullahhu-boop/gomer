import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Integration } from '../database/entities';
import { IntegrationsController } from './integrations.controller';
import { IntegrationsService } from './integrations.service';
import { PipedreamService } from './pipedream.service';

@Module({
  imports: [TypeOrmModule.forFeature([Integration])],
  controllers: [IntegrationsController],
  providers: [IntegrationsService, PipedreamService],
  exports: [IntegrationsService],
})
export class IntegrationsModule {}
