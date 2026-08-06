import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Records the cached slices of each run's prompt. They are already part of
 * `inputTokens`, but a cache write and a cache read cost us more and far less
 * than fresh input respectively, so without the split `providerCostUsd` could
 * not be derived — a cache-heavy run was recorded at up to 3x its real cost.
 *
 * Existing rows keep 0/0, which prices them as fully uncached. That is what
 * they were already recorded as, so the backfill changes no historical figure;
 * rows written before this migration stay approximate by construction.
 */
export class CreditEventCacheTokens1729000200000 implements MigrationInterface {
  name = 'CreditEventCacheTokens1729000200000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "credit_events" ADD COLUMN IF NOT EXISTS "cacheWriteTokens" integer NOT NULL DEFAULT 0`,
    );
    await queryRunner.query(
      `ALTER TABLE "credit_events" ADD COLUMN IF NOT EXISTS "cacheReadTokens" integer NOT NULL DEFAULT 0`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "credit_events" DROP COLUMN IF EXISTS "cacheReadTokens"`);
    await queryRunner.query(`ALTER TABLE "credit_events" DROP COLUMN IF EXISTS "cacheWriteTokens"`);
  }
}
