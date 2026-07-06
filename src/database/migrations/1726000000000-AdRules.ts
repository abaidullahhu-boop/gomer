import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * The automated rule engine: {@link AdRule} definitions (metric/threshold/action
 * on a schedule, with guardrails) and {@link AdRuleAction} audit rows recording
 * every action taken, which also back the rolling daily-action cap.
 */
export class AdRules1726000000000 implements MigrationInterface {
  name = 'AdRules1726000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "ad_rules" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "workspaceId" uuid NOT NULL,
        "name" character varying(255) NOT NULL,
        "adAccountId" character varying(64) NOT NULL,
        "scope" character varying(16) NOT NULL,
        "metric" character varying(16) NOT NULL,
        "comparator" character varying(8) NOT NULL,
        "threshold" numeric(14,4) NOT NULL,
        "windowDays" integer NOT NULL DEFAULT 3,
        "action" character varying(16) NOT NULL,
        "scalePct" integer,
        "autoExecute" boolean NOT NULL DEFAULT true,
        "maxScalePct" integer NOT NULL DEFAULT 25,
        "maxActionsPerRun" integer NOT NULL DEFAULT 10,
        "dailyActionCap" integer NOT NULL DEFAULT 25,
        "cronExpression" character varying(128) NOT NULL,
        "timezone" character varying(64),
        "slackChannelId" character varying(64),
        "isActive" boolean NOT NULL DEFAULT true,
        "createdByUserId" uuid,
        "lastRun" TIMESTAMP WITH TIME ZONE,
        "nextRun" TIMESTAMP WITH TIME ZONE,
        "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_ad_rules_id" PRIMARY KEY ("id")
      )`,
    );
    await queryRunner.query(`CREATE INDEX "IDX_ad_rules_workspace" ON "ad_rules" ("workspaceId")`);
    await queryRunner.query(
      `ALTER TABLE "ad_rules" ADD CONSTRAINT "FK_ad_rules_workspace" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "ad_rules" ADD CONSTRAINT "FK_ad_rules_created_by" FOREIGN KEY ("createdByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );

    await queryRunner.query(
      `CREATE TABLE "ad_rule_actions" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "ruleId" uuid NOT NULL,
        "workspaceId" uuid NOT NULL,
        "entityType" character varying(16) NOT NULL,
        "entityId" character varying(64),
        "entityName" character varying(255),
        "metricValue" numeric(14,4),
        "action" character varying(16) NOT NULL,
        "detail" text,
        "success" boolean NOT NULL DEFAULT true,
        "error" text,
        "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_ad_rule_actions_id" PRIMARY KEY ("id")
      )`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_ad_rule_actions_rule" ON "ad_rule_actions" ("ruleId")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_ad_rule_actions_workspace" ON "ad_rule_actions" ("workspaceId")`,
    );
    await queryRunner.query(
      `ALTER TABLE "ad_rule_actions" ADD CONSTRAINT "FK_ad_rule_actions_rule" FOREIGN KEY ("ruleId") REFERENCES "ad_rules"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "ad_rule_actions" ADD CONSTRAINT "FK_ad_rule_actions_workspace" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "ad_rule_actions" DROP CONSTRAINT "FK_ad_rule_actions_workspace"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ad_rule_actions" DROP CONSTRAINT "FK_ad_rule_actions_rule"`,
    );
    await queryRunner.query(`DROP TABLE "ad_rule_actions"`);
    await queryRunner.query(`ALTER TABLE "ad_rules" DROP CONSTRAINT "FK_ad_rules_created_by"`);
    await queryRunner.query(`ALTER TABLE "ad_rules" DROP CONSTRAINT "FK_ad_rules_workspace"`);
    await queryRunner.query(`DROP TABLE "ad_rules"`);
  }
}
