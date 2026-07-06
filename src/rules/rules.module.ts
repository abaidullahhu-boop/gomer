import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AdRule, AdRuleAction } from '../database/entities';
import { IntegrationsModule } from '../integrations/integrations.module';
import { RulesService } from './rules.service';

/**
 * The rule-engine core: {@link RulesService} (CRUD + evaluation). Deliberately
 * free of any Slack dependency — the scheduler in {@link RulesSchedulerModule}
 * owns notification delivery — so AiModule can import this for the rule chat
 * tools without a circular dependency.
 */
@Module({
  imports: [TypeOrmModule.forFeature([AdRule, AdRuleAction]), IntegrationsModule],
  providers: [RulesService],
  exports: [RulesService],
})
export class RulesModule {}
