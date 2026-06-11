import { plainToInstance } from 'class-transformer';
import { IsEnum, IsNotEmpty, IsNumber, IsOptional, IsString, validateSync } from 'class-validator';

enum Environment {
  Development = 'development',
  Production = 'production',
  Test = 'test',
}

/**
 * Schema used to validate environment variables at application bootstrap.
 * Missing required values cause the process to fail fast with a clear message.
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
  DATABASE_HOST!: string;

  @IsNumber()
  DATABASE_PORT!: number;

  @IsString()
  @IsNotEmpty()
  DATABASE_NAME!: string;

  @IsString()
  @IsNotEmpty()
  DATABASE_USER!: string;

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
