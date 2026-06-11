import { Global, Module, OnApplicationShutdown } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { ModuleRef } from '@nestjs/core';
import Redis from 'ioredis';
import { REDIS_CLIENT } from '../common/constants';
import { AppConfig } from '../config/configuration';

/**
 * Provides a single shared ioredis client, injectable via @Inject(REDIS_CLIENT).
 * Marked @Global so feature modules can use Redis without re-importing.
 */
@Global()
@Module({
  imports: [ConfigModule],
  providers: [
    {
      provide: REDIS_CLIENT,
      inject: [ConfigService],
      useFactory: (configService: ConfigService<AppConfig, true>): Redis => {
        const redis = configService.get('redis', { infer: true });
        return new Redis({
          host: redis.host,
          port: redis.port,
          lazyConnect: false,
          maxRetriesPerRequest: null,
        });
      },
    },
  ],
  exports: [REDIS_CLIENT],
})
export class RedisModule implements OnApplicationShutdown {
  constructor(private readonly moduleRef: ModuleRef) {}

  async onApplicationShutdown(): Promise<void> {
    const client = this.moduleRef.get<Redis>(REDIS_CLIENT, { strict: false });
    if (client) {
      await client.quit();
    }
  }
}
