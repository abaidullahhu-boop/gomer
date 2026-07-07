import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Sent anomaly alerts (CPA spikes, ROAS drops, spend spikes), unique per
 * workspace/account/metric/day so the hourly monitoring sweep never notifies
 * the same anomaly twice in a day.
 */
export class AnomalyAlerts1728000000000 implements MigrationInterface {
  name = 'AnomalyAlerts1728000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "anomaly_alerts" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "workspaceId" uuid NOT NULL,
        "adAccountId" character varying(64) NOT NULL,
        "metric" character varying(32) NOT NULL,
        "day" date NOT NULL,
        "message" text NOT NULL,
        "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_anomaly_alerts_id" PRIMARY KEY ("id")
      )`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_anomaly_alerts_workspace" ON "anomaly_alerts" ("workspaceId")`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_anomaly_alerts_daily" ON "anomaly_alerts" ("workspaceId", "adAccountId", "metric", "day")`,
    );
    await queryRunner.query(
      `ALTER TABLE "anomaly_alerts" ADD CONSTRAINT "FK_anomaly_alerts_workspace" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "anomaly_alerts" DROP CONSTRAINT "FK_anomaly_alerts_workspace"`,
    );
    await queryRunner.query(`DROP INDEX "public"."UQ_anomaly_alerts_daily"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_anomaly_alerts_workspace"`);
    await queryRunner.query(`DROP TABLE "anomaly_alerts"`);
  }
}
