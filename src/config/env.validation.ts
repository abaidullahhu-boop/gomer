import { plainToInstance } from 'class-transformer';
import {
  IsEnum,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  ValidateIf,
  validateSync,
} from 'class-validator';

enum Environment {
  Development = 'development',
  Production = 'production',
  Test = 'test',
}

/** True when no DATABASE_URL is supplied, so the discrete fields must stand in for it. */
const withoutDatabaseUrl = (env: EnvironmentVariables): boolean => !env.DATABASE_URL;

/**
 * Schema used to validate environment variables at application bootstrap.
 * Missing required values cause the process to fail fast with a clear message.
 *
 * The database may be configured either by a single DATABASE_URL (as managed
 * providers like DigitalOcean inject it) or by the discrete host/port/name/
 * user/password fields used for local development. TypeORM prefers `url` when
 * it is set, so the discrete fields are only required in its absence.
 */
class EnvironmentVariables {
  @IsEnum(Environment)
  @IsOptional()
  NODE_ENV?: Environment;

  @IsNumber()
  @IsOptional()
  PORT?: number;

  @IsString()
  @IsNotEmpty()
  @IsOptional()
  DATABASE_URL?: string;

  @ValidateIf(withoutDatabaseUrl)
  @IsString()
  @IsNotEmpty()
  DATABASE_HOST!: string;

  @ValidateIf(withoutDatabaseUrl)
  @IsNumber()
  DATABASE_PORT!: number;

  @ValidateIf(withoutDatabaseUrl)
  @IsString()
  @IsNotEmpty()
  DATABASE_NAME!: string;

  @ValidateIf(withoutDatabaseUrl)
  @IsString()
  @IsNotEmpty()
  DATABASE_USER!: string;

  @ValidateIf(withoutDatabaseUrl)
  @IsString()
  DATABASE_PASSWORD!: string;

  @IsString()
  @IsNotEmpty()
  JWT_SECRET!: string;

  @IsString()
  @IsNotEmpty()
  JWT_REFRESH_SECRET!: string;
}

export function validateEnv(config: Record<string, unknown>): Record<string, unknown> {
  const validated = plainToInstance(EnvironmentVariables, config, {
    enableImplicitConversion: true,
  });

  const errors = validateSync(validated, { skipMissingProperties: false });

  if (errors.length > 0) {
    const details = errors.map((e) => Object.values(e.constraints ?? {}).join(', ')).join('; ');
    throw new Error(`Invalid environment configuration: ${details}`);
  }

  return config;
}
