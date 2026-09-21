import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Team invites. An admin adds a Slack teammate by email from the dashboard and
 * the member row is created right then, before that person has ever signed in
 * or messaged the bot. `invitedAt` marks such rows so the Team page can show
 * "Invited" until `lastActiveAt` is first set; members who arrived on their
 * own keep it null.
 */
export class UserInvites1733000000000 implements MigrationInterface {
  name = 'UserInvites1733000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "users" ADD "invitedAt" TIMESTAMP WITH TIME ZONE`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "users" DROP COLUMN "invitedAt"`);
  }
}
