import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AnomalyAlert } from '../database/entities';
import { IntegrationsModule } from '../integrations/integrations.module';
import { MemoryModule } from '../memory/memory.module';
import { MonitoringService } from './monitoring.service';

/**
 * Core anomaly detection. Slack delivery lives in MonitoringSchedulerModule
 * (a leaf, imported only by AppModule) for the same reason as the rules
 * engine: SlackModule must not feed back into modules AiModule depends on.
 */
@Module({
  imports: [TypeOrmModule.forFeature([AnomalyAlert]), IntegrationsModule, MemoryModule],
  providers: [MonitoringService],
  exports: [MonitoringService],
})
export class MonitoringModule {}
