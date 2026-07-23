import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Splits metered tokens into input and output on credit_events.
 *
 * Every model prices output several times higher than input, so a single
 * blended token count cannot bill multi-provider usage accurately. `tokensUsed`
 * stays as the sum, keeping the existing analytics queries untouched.
 *
 * Historic rows have no split available, so they are backfilled by attributing
 * everything to input — the cheaper side, so no past run is retroactively
 * over-billed. Only the new columns are affected; `creditsUsed` is immutable.
 */
export class CreditEventTokenSplit1729000000000 implements MigrationInterface {
  name = 'CreditEventTokenSplit1729000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "credit_events" ADD "inputTokens" integer NOT NULL DEFAULT '0'`,
    );
    await queryRunner.query(
      `ALTER TABLE "credit_events" ADD "outputTokens" integer NOT NULL DEFAULT '0'`,
    );
    await queryRunner.query(`UPDATE "credit_events" SET "inputTokens" = "tokensUsed"`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "credit_events" DROP COLUMN "outputTokens"`);
    await queryRunner.query(`ALTER TABLE "credit_events" DROP COLUMN "inputTokens"`);
  }
}
