import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Adds native Meta Ads support to the integrations table. A `provider` column
 * distinguishes Pipedream-brokered connections (the existing default) from
 * `meta` connections that talk directly to Meta's hosted MCP, and four nullable
 * columns hold the Meta OAuth token material used as the MCP bearer credential.
 * Existing rows are backfilled to `pipedream`.
 */
export class IntegrationMetaProvider1723100000000 implements MigrationInterface {
  name = 'IntegrationMetaProvider1723100000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "integrations" ADD "provider" character varying(16) NOT NULL DEFAULT 'pipedream'`,
    );
    await queryRunner.query(`ALTER TABLE "integrations" ADD "accessToken" text`);
    await queryRunner.query(`ALTER TABLE "integrations" ADD "refreshToken" text`);
    await queryRunner.query(
      `ALTER TABLE "integrations" ADD "tokenExpiresAt" TIMESTAMP WITH TIME ZONE`,
    );
    await queryRunner.query(`ALTER TABLE "integrations" ADD "scopes" character varying(1024)`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "integrations" DROP COLUMN "scopes"`);
    await queryRunner.query(`ALTER TABLE "integrations" DROP COLUMN "tokenExpiresAt"`);
    await queryRunner.query(`ALTER TABLE "integrations" DROP COLUMN "refreshToken"`);
    await queryRunner.query(`ALTER TABLE "integrations" DROP COLUMN "accessToken"`);
    await queryRunner.query(`ALTER TABLE "integrations" DROP COLUMN "provider"`);
  }
}
