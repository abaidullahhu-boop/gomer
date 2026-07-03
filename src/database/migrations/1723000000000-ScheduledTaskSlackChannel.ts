import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Stores the Slack destination a task delivers its output to — a channel/group
 * id, or a user id (a DM is opened for it). Null means the task runs silently
 * (its answer is not posted), which is the prior behaviour for existing rows.
 */
export class ScheduledTaskSlackChannel1723000000000 implements MigrationInterface {
  name = 'ScheduledTaskSlackChannel1723000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "scheduled_tasks" ADD "slackChannelId" character varying(64)`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "scheduled_tasks" DROP COLUMN "slackChannelId"`);
  }
}
