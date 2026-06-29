import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Stores the IANA timezone a task's cron expression is interpreted in, so a
 * schedule like "every day at 9am Asia/Karachi" fires at that local time rather
 * than the server's. Null falls back to server-local time.
 */
export class ScheduledTaskTimezone1722500000000 implements MigrationInterface {
  name = 'ScheduledTaskTimezone1722500000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "scheduled_tasks" ADD "timezone" character varying(64)`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "scheduled_tasks" DROP COLUMN "timezone"`);
  }
}
