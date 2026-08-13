import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Recurring Google Sheets exports: a cron-scheduled push of ROAS snapshots,
 * campaign insights, or rule-engine actions into a spreadsheet. `lastExportedAt`
 * is the append-only watermark that stops repeat runs duplicating rows.
 */
export class ScheduledExports1730000000000 implements MigrationInterface {
  name = 'ScheduledExports1730000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "scheduled_exports" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "workspaceId" uuid NOT NULL,
        "name" character varying(255) NOT NULL,
        "dataset" character varying(32) NOT NULL,
        "adAccountId" character varying(64),
        "windowDays" integer NOT NULL DEFAULT 7,
        "spreadsheetId" character varying(128),
        "spreadsheetTitle" character varying(255),
        "spreadsheetUrl" character varying(255),
        "sheetTitle" character varying(128) NOT NULL DEFAULT 'Sheet1',
        "cronExpression" character varying(128) NOT NULL,
        "timezone" character varying(64),
        "slackChannelId" character varying(64),
        "isActive" boolean NOT NULL DEFAULT true,
        "createdByUserId" uuid,
        "lastRun" TIMESTAMP WITH TIME ZONE,
        "nextRun" TIMESTAMP WITH TIME ZONE,
        "lastExportedAt" TIMESTAMP WITH TIME ZONE,
        "lastRowCount" integer,
        "lastError" text,
        "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_scheduled_exports_id" PRIMARY KEY ("id")
      )`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_scheduled_exports_workspace" ON "scheduled_exports" ("workspaceId")`,
    );
    await queryRunner.query(
      `ALTER TABLE "scheduled_exports" ADD CONSTRAINT "FK_scheduled_exports_workspace" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "scheduled_exports" ADD CONSTRAINT "FK_scheduled_exports_created_by" FOREIGN KEY ("createdByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "scheduled_exports" DROP CONSTRAINT "FK_scheduled_exports_created_by"`,
    );
    await queryRunner.query(
      `ALTER TABLE "scheduled_exports" DROP CONSTRAINT "FK_scheduled_exports_workspace"`,
    );
    await queryRunner.query(`DROP TABLE "scheduled_exports"`);
  }
}
