import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Adds a per-task model override and an author (the member who created the task)
 * to scheduled_tasks. The author backs the "Author: You" line in the dashboard
 * and a null model means the run falls back to the workspace's default model.
 */
export class ScheduledTaskModelAuthor1722000000000 implements MigrationInterface {
  name = 'ScheduledTaskModelAuthor1722000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "scheduled_tasks" ADD "model" character varying(128)`);
    await queryRunner.query(`ALTER TABLE "scheduled_tasks" ADD "createdByUserId" uuid`);
    await queryRunner.query(
      `ALTER TABLE "scheduled_tasks" ADD CONSTRAINT "FK_scheduled_tasks_createdByUserId" FOREIGN KEY ("createdByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "scheduled_tasks" DROP CONSTRAINT "FK_scheduled_tasks_createdByUserId"`,
    );
    await queryRunner.query(`ALTER TABLE "scheduled_tasks" DROP COLUMN "createdByUserId"`);
    await queryRunner.query(`ALTER TABLE "scheduled_tasks" DROP COLUMN "model"`);
  }
}
