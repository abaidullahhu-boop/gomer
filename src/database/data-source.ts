import 'dotenv/config';
import { DataSource, DataSourceOptions } from 'typeorm';
import { entities } from './entities';

/**
 * Standalone TypeORM DataSource used by the TypeORM CLI for generating and
 * running migrations. The runtime connection is configured separately in
 * DatabaseModule via TypeOrmModule.forRootAsync().
 */
export const dataSourceOptions: DataSourceOptions = {
  type: 'postgres',
  url: process.env.DATABASE_URL,
  host: process.env.DATABASE_HOST ?? 'localhost',
  port: parseInt(process.env.DATABASE_PORT ?? '5432', 10),
  username: process.env.DATABASE_USER ?? 'postgres',
  password: process.env.DATABASE_PASSWORD ?? 'password',
  database: process.env.DATABASE_NAME ?? 'gomer',
  entities,
  migrations: [__dirname + '/migrations/*{.ts,.js}'],
  synchronize: false,
  logging: process.env.NODE_ENV === 'development',
};

const dataSource = new DataSource(dataSourceOptions);
export default dataSource;
