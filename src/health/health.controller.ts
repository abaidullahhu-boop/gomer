import { Controller, Get, Inject } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import Redis from 'ioredis';
import { DataSource } from 'typeorm';
import { REDIS_CLIENT } from '../common/constants';
import { Public } from '../common/decorators';
import { ApiTags } from '@nestjs/swagger';

type CheckStatus = 'up' | 'down';

interface HealthResponse {
  status: 'ok' | 'degraded';
  uptime: number;
  timestamp: string;
  services: {
    database: CheckStatus;
    redis: CheckStatus;
  };
}

@ApiTags('health')
@Controller('health')
export class HealthController {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
  ) {}

  @Public()
  @Get()
  async check(): Promise<HealthResponse> {
    const [database, redis] = await Promise.all([this.checkDatabase(), this.checkRedis()]);

    const allUp = database === 'up' && redis === 'up';

    return {
      status: allUp ? 'ok' : 'degraded',
      uptime: Math.floor(process.uptime()),
      timestamp: new Date().toISOString(),
      services: { database, redis },
    };
  }

  private async checkDatabase(): Promise<CheckStatus> {
    try {
      await this.dataSource.query('SELECT 1');
      return 'up';
    } catch {
      return 'down';
    }
  }

  private async checkRedis(): Promise<CheckStatus> {
    try {
      const pong = await this.redis.ping();
      return pong === 'PONG' ? 'up' : 'down';
    } catch {
      return 'down';
    }
  }
}
