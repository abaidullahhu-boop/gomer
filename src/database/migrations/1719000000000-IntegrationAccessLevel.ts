import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Adds per-account access control to connected integrations:
 * - `accessLevel` ('team' | 'private') — who in the workspace may see/use it.
 *   Existing rows default to 'team', preserving the original workspace-shared
 *   behavior.
 * - `nickname` — a member-set label to tell several accounts of the same app
 *   apart.
 */
export class IntegrationAccessLevel1719000000000 implements MigrationInterface {
  name = 'IntegrationAccessLevel1719000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "integrations" ADD "nickname" character varying(255)`,
    );
    await queryRunner.query(
      `ALTER TABLE "integrations" ADD "accessLevel" character varying(16) NOT NULL DEFAULT 'team'`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "integrations" DROP COLUMN "accessLevel"`);
    await queryRunner.query(`ALTER TABLE "integrations" DROP COLUMN "nickname"`);
  }
}
