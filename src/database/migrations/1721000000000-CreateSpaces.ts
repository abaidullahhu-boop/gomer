import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Creates the Spaces feature schema: AI-built web apps whose shape lives in a
 * JSON `spec`, their passwordless end-users, magic-link tokens, and a generic
 * per-Space record store (so no real table is created per app).
 */
export class CreateSpaces1721000000000 implements MigrationInterface {
  name = 'CreateSpaces1721000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "spaces" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "workspaceId" uuid NOT NULL,
        "createdByUserId" uuid,
        "slug" character varying(255) NOT NULL,
        "name" character varying(255) NOT NULL,
        "description" text,
        "spec" jsonb NOT NULL,
        "status" character varying(16) NOT NULL DEFAULT 'published',
        "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_spaces" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_spaces_slug" ON "spaces" ("slug")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_spaces_workspaceId" ON "spaces" ("workspaceId")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_spaces_createdByUserId" ON "spaces" ("createdByUserId")`,
    );
    await queryRunner.query(`
      ALTER TABLE "spaces"
        ADD CONSTRAINT "FK_spaces_workspace" FOREIGN KEY ("workspaceId")
        REFERENCES "workspaces"("id") ON DELETE CASCADE,
        ADD CONSTRAINT "FK_spaces_created_by" FOREIGN KEY ("createdByUserId")
        REFERENCES "users"("id") ON DELETE SET NULL
    `);

    await queryRunner.query(`
      CREATE TABLE "space_users" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "spaceId" uuid NOT NULL,
        "email" character varying(320) NOT NULL,
        "name" character varying(255),
        "role" character varying(16) NOT NULL DEFAULT 'member',
        "lastLoginAt" TIMESTAMP WITH TIME ZONE,
        "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_space_users" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_space_users_space_email" ON "space_users" ("spaceId", "email")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_space_users_spaceId" ON "space_users" ("spaceId")`,
    );
    await queryRunner.query(`
      ALTER TABLE "space_users"
        ADD CONSTRAINT "FK_space_users_space" FOREIGN KEY ("spaceId")
        REFERENCES "spaces"("id") ON DELETE CASCADE
    `);

    await queryRunner.query(`
      CREATE TABLE "space_auth_tokens" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "spaceId" uuid NOT NULL,
        "email" character varying(320) NOT NULL,
        "tokenHash" character varying(255) NOT NULL,
        "expiresAt" TIMESTAMP WITH TIME ZONE NOT NULL,
        "usedAt" TIMESTAMP WITH TIME ZONE,
        "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_space_auth_tokens" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "IDX_space_auth_tokens_spaceId" ON "space_auth_tokens" ("spaceId")`,
    );
    await queryRunner.query(`
      ALTER TABLE "space_auth_tokens"
        ADD CONSTRAINT "FK_space_auth_tokens_space" FOREIGN KEY ("spaceId")
        REFERENCES "spaces"("id") ON DELETE CASCADE
    `);

    await queryRunner.query(`
      CREATE TABLE "space_records" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "spaceId" uuid NOT NULL,
        "entityName" character varying(128) NOT NULL,
        "data" jsonb NOT NULL,
        "createdBySpaceUserId" uuid,
        "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_space_records" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "IDX_space_records_spaceId" ON "space_records" ("spaceId")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_space_records_space_entity" ON "space_records" ("spaceId", "entityName")`,
    );
    await queryRunner.query(`
      ALTER TABLE "space_records"
        ADD CONSTRAINT "FK_space_records_space" FOREIGN KEY ("spaceId")
        REFERENCES "spaces"("id") ON DELETE CASCADE
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "space_records"`);
    await queryRunner.query(`DROP TABLE "space_auth_tokens"`);
    await queryRunner.query(`DROP TABLE "space_users"`);
    await queryRunner.query(`DROP TABLE "spaces"`);
  }
}
