import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Adds Pipedream Connect support to the integrations table: an optional cached
 * `iconUrl` for the connected-apps UI and a unique index on
 * (workspaceId, externalAccountId) so confirming the same connected account is
 * idempotent (re-confirm updates rather than duplicates).
 */
export class IntegrationsPipedream1718000000000 implements MigrationInterface {
  name = 'IntegrationsPipedream1718000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "integrations" ADD "iconUrl" character varying(1024)`);
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_integrations_workspace_account" ON "integrations" ("workspaceId", "externalAccountId") `,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "public"."UQ_integrations_workspace_account"`);
    await queryRunner.query(`ALTER TABLE "integrations" DROP COLUMN "iconUrl"`);
  }
}
