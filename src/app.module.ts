import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { AiModule } from './ai/ai.module';
import { AuthModule } from './auth/auth.module';
import { AllExceptionsFilter } from './common/filters';
import { JwtAuthGuard, RolesGuard } from './common/guards';
import { LoggingInterceptor } from './common/interceptors';
import { configuration } from './config/configuration';
import { validateEnv } from './config/env.validation';
import { DatabaseModule } from './database/database.module';
import { HealthModule } from './health/health.module';
import { IntegrationsModule } from './integrations/integrations.module';
import { RedisModule } from './redis/redis.module';
import { SkillsModule } from './skills/skills.module';
import { SlackModule } from './slack/slack.module';
import { SpacesModule } from './spaces/spaces.module';
import { TasksModule } from './tasks/tasks.module';
import { UsageModule } from './usage/usage.module';
import { UsersModule } from './users/users.module';
import { WorkspacesModule } from './workspaces/workspaces.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      cache: true,
      load: [configuration],
      validate: validateEnv,
    }),
    DatabaseModule,
    RedisModule,
    AuthModule,
    UsersModule,
    WorkspacesModule,
    IntegrationsModule,
    SkillsModule,
    SpacesModule,
    TasksModule,
    AiModule,
    SlackModule,
    UsageModule,
    HealthModule,
  ],
  providers: [
    // Global authentication: every route requires a valid JWT unless @Public().
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    // Global authorization: enforces @Roles() where present.
    { provide: APP_GUARD, useClass: RolesGuard },
    // Consistent error shape across the app.
    { provide: APP_FILTER, useClass: AllExceptionsFilter },
    // Per-request logging.
    { provide: APP_INTERCEPTOR, useClass: LoggingInterceptor },
  ],
})
export class AppModule {}
