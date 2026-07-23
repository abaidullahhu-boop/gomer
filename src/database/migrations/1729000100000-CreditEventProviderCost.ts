import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Records what a run cost us, separately from what the workspace was charged.
 *
 * Credits are a billing decision (with a 1-credit floor and a margin multiplier);
 * they say nothing about the real spend behind a run. Once a gateway can route
 * one request to a free backend and the next to a paid frontier model, the two
 * numbers stop tracking each other entirely.
 *
 * Both columns are additive and nullable/defaulted, so existing rows stay valid —
 * they simply have no cost attributed, which is honest: it was never captured.
 */
export class CreditEventProviderCost1729000100000 implements MigrationInterface {
  name = 'CreditEventProviderCost1729000100000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "credit_events" ADD COLUMN IF NOT EXISTS "resolvedModel" character varying(128)`,
    );
    await queryRunner.query(
      `ALTER TABLE "credit_events" ADD COLUMN IF NOT EXISTS "providerCostUsd" numeric(12,6) NOT NULL DEFAULT 0`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "credit_events" DROP COLUMN IF EXISTS "providerCostUsd"`);
    await queryRunner.query(`ALTER TABLE "credit_events" DROP COLUMN IF EXISTS "resolvedModel"`);
  }
}
