import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Initial schema for hektor.ai covering all Phase 1 entities:
 * workspaces, users, integrations, skills, user_skills, scheduled_tasks,
 * credit_events and messages.
 *
 * Constraint/index names match TypeORM's generated naming so that future
 * `migration:generate` runs produce clean (empty) diffs.
 */
export class InitialSchema1717000000000 implements MigrationInterface {
  name = 'InitialSchema1717000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // uuid_generate_v4() (used for all UUID primary keys) is provided by uuid-ossp.
    await queryRunner.query(`CREATE EXTENSION IF NOT EXISTS "uuid-ossp"`);

    await queryRunner.query(
      `CREATE TYPE "public"."scheduled_tasks_type_enum" AS ENUM('system', 'user')`,
    );
    await queryRunner.query(
      `CREATE TABLE "scheduled_tasks" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "workspaceId" uuid NOT NULL, "name" character varying(255) NOT NULL, "description" text, "cronExpression" character varying(128) NOT NULL, "prompt" text NOT NULL, "isActive" boolean NOT NULL DEFAULT true, "type" "public"."scheduled_tasks_type_enum" NOT NULL DEFAULT 'user', "lastRun" TIMESTAMP WITH TIME ZONE, "nextRun" TIMESTAMP WITH TIME ZONE, "oneTime" boolean NOT NULL DEFAULT false, "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_abc9348e8ae95b59b11a982ea87" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_aeefc44888658f88151fa77ed3" ON "scheduled_tasks" ("workspaceId") `,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."messages_role_enum" AS ENUM('user', 'assistant')`,
    );
    await queryRunner.query(
      `CREATE TABLE "messages" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "workspaceId" uuid NOT NULL, "userId" uuid, "threadId" character varying(255) NOT NULL, "role" "public"."messages_role_enum" NOT NULL, "content" text NOT NULL, "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_18325f38ae6de43878487eff986" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_1d227f15b5d76efbfd5ddd72be" ON "messages" ("workspaceId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_15f9bd2bf472ff12b6ee20012d" ON "messages" ("threadId") `,
    );
    await queryRunner.query(
      `CREATE TABLE "skills" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "name" character varying(255) NOT NULL, "description" text NOT NULL, "category" character varying(128) NOT NULL, "systemPrompt" text NOT NULL, "author" character varying(255) NOT NULL, "tags" text NOT NULL DEFAULT '', "isBundle" boolean NOT NULL DEFAULT false, "requiredIntegrations" text NOT NULL DEFAULT '', "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_0d3212120f4ecedf90864d7e298" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE TABLE "user_skills" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "userId" uuid NOT NULL, "skillId" uuid NOT NULL, "installedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "UQ_user_skills_user_skill" UNIQUE ("userId", "skillId"), CONSTRAINT "PK_4d0a72117fbf387752dbc8506af" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_60177dd93dcdc055e4eaa93bad" ON "user_skills" ("userId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_b19f190afaada3852e0f56566b" ON "user_skills" ("skillId") `,
    );
    await queryRunner.query(`CREATE TYPE "public"."users_role_enum" AS ENUM('admin', 'member')`);
    await queryRunner.query(
      `CREATE TABLE "users" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "workspaceId" uuid NOT NULL, "slackUserId" character varying(64) NOT NULL, "name" character varying(255) NOT NULL, "email" character varying(255), "avatarUrl" text, "role" "public"."users_role_enum" NOT NULL DEFAULT 'member', "isActive" boolean NOT NULL DEFAULT true, "lastActiveAt" TIMESTAMP WITH TIME ZONE, "refreshTokenHash" text, "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "UQ_users_workspace_slack_user" UNIQUE ("workspaceId", "slackUserId"), CONSTRAINT "PK_a3ffb1c0c8416b9fc6f907b7433" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_949fea12b7977a8b2f483bf802" ON "users" ("workspaceId") `,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."credit_events_type_enum" AS ENUM('thread', 'scheduled_task')`,
    );
    await queryRunner.query(
      `CREATE TABLE "credit_events" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "workspaceId" uuid NOT NULL, "userId" uuid, "taskId" uuid, "type" "public"."credit_events_type_enum" NOT NULL, "sourceName" character varying(255) NOT NULL, "creditsUsed" integer NOT NULL DEFAULT '0', "tokensUsed" integer NOT NULL DEFAULT '0', "model" character varying(128) NOT NULL, "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_780dafc9e3a1e3e7b97e8488919" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_d3c2ff60c2e656f4c44adba60c" ON "credit_events" ("workspaceId") `,
    );
    await queryRunner.query(
      `CREATE TABLE "integrations" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "workspaceId" uuid NOT NULL, "userId" uuid NOT NULL, "appName" character varying(128) NOT NULL, "appSlug" character varying(128) NOT NULL, "externalAccountId" character varying(255), "isActive" boolean NOT NULL DEFAULT true, "connectedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_9adcdc6d6f3922535361ce641e8" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_74b4a6216901cce047e144fc9a" ON "integrations" ("workspaceId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_c32758a01d05d0d1da56fa46ae" ON "integrations" ("userId") `,
    );
    await queryRunner.query(
      `CREATE TABLE "workspaces" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "name" character varying(255) NOT NULL, "slackTeamId" character varying(64) NOT NULL, "slackBotToken" text, "credits" integer NOT NULL DEFAULT '0', "workspaceInstructions" text, "defaultModel" character varying(128), "personalityTone" character varying(128), "accessControl" jsonb, "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "UQ_59e46057e0f6cb5f8261f588533" UNIQUE ("slackTeamId"), CONSTRAINT "PK_098656ae401f3e1a4586f47fd8e" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `ALTER TABLE "scheduled_tasks" ADD CONSTRAINT "FK_aeefc44888658f88151fa77ed38" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "messages" ADD CONSTRAINT "FK_1d227f15b5d76efbfd5ddd72be6" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "messages" ADD CONSTRAINT "FK_4838cd4fc48a6ff2d4aa01aa646" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "user_skills" ADD CONSTRAINT "FK_60177dd93dcdc055e4eaa93bade" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "user_skills" ADD CONSTRAINT "FK_b19f190afaada3852e0f56566bc" FOREIGN KEY ("skillId") REFERENCES "skills"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "users" ADD CONSTRAINT "FK_949fea12b7977a8b2f483bf802a" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "credit_events" ADD CONSTRAINT "FK_d3c2ff60c2e656f4c44adba60c7" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "credit_events" ADD CONSTRAINT "FK_6dedfd9835d624c09b3d63a01ae" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "credit_events" ADD CONSTRAINT "FK_225de0b066604075b6cbb3bf5b3" FOREIGN KEY ("taskId") REFERENCES "scheduled_tasks"("id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "integrations" ADD CONSTRAINT "FK_74b4a6216901cce047e144fc9af" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "integrations" ADD CONSTRAINT "FK_c32758a01d05d0d1da56fa46ae1" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "integrations" DROP CONSTRAINT "FK_c32758a01d05d0d1da56fa46ae1"`,
    );
    await queryRunner.query(
      `ALTER TABLE "integrations" DROP CONSTRAINT "FK_74b4a6216901cce047e144fc9af"`,
    );
    await queryRunner.query(
      `ALTER TABLE "credit_events" DROP CONSTRAINT "FK_225de0b066604075b6cbb3bf5b3"`,
    );
    await queryRunner.query(
      `ALTER TABLE "credit_events" DROP CONSTRAINT "FK_6dedfd9835d624c09b3d63a01ae"`,
    );
    await queryRunner.query(
      `ALTER TABLE "credit_events" DROP CONSTRAINT "FK_d3c2ff60c2e656f4c44adba60c7"`,
    );
    await queryRunner.query(`ALTER TABLE "users" DROP CONSTRAINT "FK_949fea12b7977a8b2f483bf802a"`);
    await queryRunner.query(
      `ALTER TABLE "user_skills" DROP CONSTRAINT "FK_b19f190afaada3852e0f56566bc"`,
    );
    await queryRunner.query(
      `ALTER TABLE "user_skills" DROP CONSTRAINT "FK_60177dd93dcdc055e4eaa93bade"`,
    );
    await queryRunner.query(
      `ALTER TABLE "messages" DROP CONSTRAINT "FK_4838cd4fc48a6ff2d4aa01aa646"`,
    );
    await queryRunner.query(
      `ALTER TABLE "messages" DROP CONSTRAINT "FK_1d227f15b5d76efbfd5ddd72be6"`,
    );
    await queryRunner.query(
      `ALTER TABLE "scheduled_tasks" DROP CONSTRAINT "FK_aeefc44888658f88151fa77ed38"`,
    );
    await queryRunner.query(`DROP TABLE "workspaces"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_c32758a01d05d0d1da56fa46ae"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_74b4a6216901cce047e144fc9a"`);
    await queryRunner.query(`DROP TABLE "integrations"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_d3c2ff60c2e656f4c44adba60c"`);
    await queryRunner.query(`DROP TABLE "credit_events"`);
    await queryRunner.query(`DROP TYPE "public"."credit_events_type_enum"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_949fea12b7977a8b2f483bf802"`);
    await queryRunner.query(`DROP TABLE "users"`);
    await queryRunner.query(`DROP TYPE "public"."users_role_enum"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_b19f190afaada3852e0f56566b"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_60177dd93dcdc055e4eaa93bad"`);
    await queryRunner.query(`DROP TABLE "user_skills"`);
    await queryRunner.query(`DROP TABLE "skills"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_15f9bd2bf472ff12b6ee20012d"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_1d227f15b5d76efbfd5ddd72be"`);
    await queryRunner.query(`DROP TABLE "messages"`);
    await queryRunner.query(`DROP TYPE "public"."messages_role_enum"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_aeefc44888658f88151fa77ed3"`);
    await queryRunner.query(`DROP TABLE "scheduled_tasks"`);
    await queryRunner.query(`DROP TYPE "public"."scheduled_tasks_type_enum"`);
  }
}
