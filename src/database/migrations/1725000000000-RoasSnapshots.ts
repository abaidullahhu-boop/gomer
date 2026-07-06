import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Verified-ROAS snapshots: Meta ad spend reconciled against actual Stripe
 * revenue over a window. One row per verification run, kept so results are
 * queryable over time and can feed the automated rule engine.
 */
export class RoasSnapshots1725000000000 implements MigrationInterface {
  name = 'RoasSnapshots1725000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "roas_snapshots" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "workspaceId" uuid NOT NULL,
        "adAccountId" character varying(64) NOT NULL,
        "sinceDate" date NOT NULL,
        "untilDate" date NOT NULL,
        "metaSpend" numeric(14,2) NOT NULL,
        "spendCurrency" character varying(8),
        "stripeRevenue" numeric(14,2) NOT NULL,
        "revenueCurrency" character varying(8),
        "roas" numeric(10,4),
        "purchases" integer NOT NULL,
        "cpa" numeric(14,2),
        "caveats" jsonb,
        "createdByUserId" uuid,
        "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_roas_snapshots_id" PRIMARY KEY ("id")
      )`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_roas_snapshots_workspace" ON "roas_snapshots" ("workspaceId")`,
    );
    await queryRunner.query(
      `ALTER TABLE "roas_snapshots" ADD CONSTRAINT "FK_roas_snapshots_workspace" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "roas_snapshots" ADD CONSTRAINT "FK_roas_snapshots_created_by" FOREIGN KEY ("createdByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "roas_snapshots" DROP CONSTRAINT "FK_roas_snapshots_created_by"`,
    );
    await queryRunner.query(
      `ALTER TABLE "roas_snapshots" DROP CONSTRAINT "FK_roas_snapshots_workspace"`,
    );
    await queryRunner.query(`DROP INDEX "public"."IDX_roas_snapshots_workspace"`);
    await queryRunner.query(`DROP TABLE "roas_snapshots"`);
  }
}
