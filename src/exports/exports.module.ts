import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ScheduledExport } from '../database/entities';
import { IntegrationsModule } from '../integrations/integrations.module';
import { RulesModule } from '../rules/rules.module';
import { ExportsService } from './exports.service';

/**
 * The Google Sheets export core: {@link ExportsService} (one-off exports, CRUD
 * for recurring ones, and their execution). Deliberately free of any Slack
 * dependency — the scheduler in {@link ExportsSchedulerModule} owns notification
 * delivery — so AiModule can import this for the export chat tools without a
 * circular dependency. Mirrors RulesModule.
 */
@Module({
  imports: [TypeOrmModule.forFeature([ScheduledExport]), IntegrationsModule, RulesModule],
  providers: [ExportsService],
  exports: [ExportsService],
})
export class ExportsModule {}
