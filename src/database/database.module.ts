import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AppConfig } from '../config/configuration';
import { entities } from './entities';
import { subscribers } from './subscribers';

/**
 * Configures the runtime PostgreSQL connection via TypeORM.
 *
 * - Loads entities explicitly (no glob magic at runtime).
 * - Migrations are the source of truth for schema (`synchronize: false`).
 * - Connection retry is enabled so the app survives a slow-to-boot database
 *   (e.g. when started alongside Docker Compose).
 */
@Module({
  imports: [
    TypeOrmModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (configService: ConfigService<AppConfig, true>) => {
        const db = configService.get('database', { infer: true });
        return {
          type: 'postgres',
          url: db.url,
          host: db.host,
          port: db.port,
          username: db.user,
          password: db.password,
          database: db.name,
          entities,
          subscribers,
          migrations: [__dirname + '/migrations/*{.ts,.js}'],
          autoLoadEntities: true,
          synchronize: false,
          migrationsRun: false,
          retryAttempts: 10,
          retryDelay: 3000,
          logging: configService.get('app.nodeEnv', { infer: true }) === 'development',
        };
      },
    }),
  ],
})
export class DatabaseModule {}
