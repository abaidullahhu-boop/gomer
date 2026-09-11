import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * In-app bug reports: what a dashboard user files, and what the owner panel
 * triages.
 *
 * `reportedByUserId` is ON DELETE SET NULL rather than CASCADE — a report has
 * to survive its reporter leaving, or the bugs most worth reading (filed by the
 * person who churned over them) delete themselves.
 */
export class BugReports1732000000000 implements MigrationInterface {
  name = 'BugReports1732000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TYPE "bug_reports_severity_enum" AS ENUM('low', 'medium', 'high', 'critical')`,
    );
    await queryRunner.query(
      `CREATE TYPE "bug_reports_status_enum" AS ENUM('open', 'in_progress', 'resolved', 'dismissed')`,
    );
    await queryRunner.query(
      `CREATE TABLE "bug_reports" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "workspaceId" uuid NOT NULL,
        "reportedByUserId" uuid,
        "title" character varying(200) NOT NULL,
        "description" text NOT NULL,
        "stepsToReproduce" text,
        "severity" "bug_reports_severity_enum" NOT NULL DEFAULT 'medium',
        "status" "bug_reports_status_enum" NOT NULL DEFAULT 'open',
        "pageUrl" character varying(512),
        "userAgent" character varying(512),
        "resolutionNote" text,
        "resolvedAt" TIMESTAMP WITH TIME ZONE,
        "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_bug_reports_id" PRIMARY KEY ("id")
      )`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_bug_reports_workspace" ON "bug_reports" ("workspaceId")`,
    );
    // The owner panel's default view is "everything still open, newest first",
    // so status leads the index and createdAt orders within it.
    await queryRunner.query(
      `CREATE INDEX "IDX_bug_reports_status_created" ON "bug_reports" ("status", "createdAt")`,
    );
    await queryRunner.query(
      `ALTER TABLE "bug_reports" ADD CONSTRAINT "FK_bug_reports_workspace" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "bug_reports" ADD CONSTRAINT "FK_bug_reports_reported_by" FOREIGN KEY ("reportedByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "bug_reports" DROP CONSTRAINT "FK_bug_reports_reported_by"`,
    );
    await queryRunner.query(`ALTER TABLE "bug_reports" DROP CONSTRAINT "FK_bug_reports_workspace"`);
    await queryRunner.query(`DROP TABLE "bug_reports"`);
    await queryRunner.query(`DROP TYPE "bug_reports_status_enum"`);
    await queryRunner.query(`DROP TYPE "bug_reports_severity_enum"`);
  }
}
