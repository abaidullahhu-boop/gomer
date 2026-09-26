import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Pages: a second kind of Space, written by Gaspo as a complete HTML document
 * instead of rendered from an app spec, for plans, reports and calculators that
 * people read rather than fill in. `kind` tells the runtime which one it is,
 * `html` holds the page, and `pageState` is what the page saves as people use
 * it (ticked steps, calculator inputs), shared by everyone who can open it.
 */
export class SpacePages1734000000000 implements MigrationInterface {
  name = 'SpacePages1734000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "spaces" ADD "kind" character varying(16) NOT NULL DEFAULT 'app'`,
    );
    await queryRunner.query(`ALTER TABLE "spaces" ADD "html" text`);
    await queryRunner.query(`ALTER TABLE "spaces" ADD "pageState" jsonb NOT NULL DEFAULT '{}'`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "spaces" DROP COLUMN "pageState"`);
    await queryRunner.query(`ALTER TABLE "spaces" DROP COLUMN "html"`);
    await queryRunner.query(`ALTER TABLE "spaces" DROP COLUMN "kind"`);
  }
}
