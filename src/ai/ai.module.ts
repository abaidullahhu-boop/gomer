import { Module } from '@nestjs/common';
import { IntegrationsModule } from '../integrations/integrations.module';
import { MemoryModule } from '../memory/memory.module';
import { RulesModule } from '../rules/rules.module';
import { SpacesModule } from '../spaces/spaces.module';
import { UsageModule } from '../usage/usage.module';
import { UsersModule } from '../users/users.module';
import { AiController } from './ai.controller';
import { AiService } from './ai.service';

@Module({
  imports: [IntegrationsModule, MemoryModule, RulesModule, SpacesModule, UsageModule, UsersModule],
  controllers: [AiController],
  providers: [AiService],
  exports: [AiService],
})
export class AiModule {}
