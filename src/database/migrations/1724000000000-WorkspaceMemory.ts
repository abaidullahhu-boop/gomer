import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Durable workspace memory: key/value facts the assistant retains across
 * conversations (targets, preferences, standing instructions). One row per
 * (workspace, key); the model upserts and deletes rows via its memory tools.
 */
export class WorkspaceMemory1724000000000 implements MigrationInterface {
  name = 'WorkspaceMemory1724000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "workspace_memory" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "workspaceId" uuid NOT NULL,
        "key" character varying(128) NOT NULL,
        "value" text NOT NULL,
        "updatedByUserId" uuid,
        "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_workspace_memory_id" PRIMARY KEY ("id")
      )`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_workspace_memory_workspace" ON "workspace_memory" ("workspaceId")`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_workspace_memory_workspace_key" ON "workspace_memory" ("workspaceId", "key")`,
    );
    await queryRunner.query(
      `ALTER TABLE "workspace_memory" ADD CONSTRAINT "FK_workspace_memory_workspace" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "workspace_memory" ADD CONSTRAINT "FK_workspace_memory_updated_by" FOREIGN KEY ("updatedByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "workspace_memory" DROP CONSTRAINT "FK_workspace_memory_updated_by"`,
    );
    await queryRunner.query(
      `ALTER TABLE "workspace_memory" DROP CONSTRAINT "FK_workspace_memory_workspace"`,
    );
    await queryRunner.query(`DROP INDEX "public"."IDX_workspace_memory_workspace_key"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_workspace_memory_workspace"`);
    await queryRunner.query(`DROP TABLE "workspace_memory"`);
  }
}
