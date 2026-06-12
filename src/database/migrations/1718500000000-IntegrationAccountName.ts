import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Stores the user-facing label of a connected Pipedream account (e.g. "butts g
 * acc") so the per-app configure view can list accounts without re-querying
 * Pipedream.
 */
export class IntegrationAccountName1718500000000 implements MigrationInterface {
  name = 'IntegrationAccountName1718500000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "integrations" ADD "accountName" character varying(255)`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "integrations" DROP COLUMN "accountName"`);
  }
}
