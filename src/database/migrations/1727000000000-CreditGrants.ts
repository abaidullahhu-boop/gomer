import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Credit grants: the income side of the credit ledger (onboarding gifts,
 * Stripe top-ups, manual grants). Balance = SUM(grants) - SUM(credit_events).
 * Existing workspaces are backfilled with the $100 onboarding grant that new
 * workspaces receive on creation.
 */
export class CreditGrants1727000000000 implements MigrationInterface {
  name = 'CreditGrants1727000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TYPE "public"."credit_grants_reason_enum" AS ENUM('onboarding', 'topup', 'manual')`,
    );
    await queryRunner.query(
      `CREATE TABLE "credit_grants" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "workspaceId" uuid NOT NULL,
        "userId" uuid,
        "reason" "public"."credit_grants_reason_enum" NOT NULL,
        "credits" integer NOT NULL,
        "amountCents" integer,
        "currency" character varying(8),
        "stripeSessionId" character varying(255),
        "note" character varying(255),
        "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_credit_grants_id" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_credit_grants_stripe_session" UNIQUE ("stripeSessionId")
      )`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_credit_grants_workspace" ON "credit_grants" ("workspaceId")`,
    );
    await queryRunner.query(
      `ALTER TABLE "credit_grants" ADD CONSTRAINT "FK_credit_grants_workspace" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "credit_grants" ADD CONSTRAINT "FK_credit_grants_user" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    // Backfill: every existing workspace gets the same one-time onboarding
    // grant new workspaces receive (10,000 credits = $100).
    await queryRunner.query(
      `INSERT INTO "credit_grants" ("workspaceId", "reason", "credits", "note")
       SELECT "id", 'onboarding', 10000, 'Free onboarding credits ($100)' FROM "workspaces"`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "credit_grants" DROP CONSTRAINT "FK_credit_grants_user"`);
    await queryRunner.query(
      `ALTER TABLE "credit_grants" DROP CONSTRAINT "FK_credit_grants_workspace"`,
    );
    await queryRunner.query(`DROP INDEX "public"."IDX_credit_grants_workspace"`);
    await queryRunner.query(`DROP TABLE "credit_grants"`);
    await queryRunner.query(`DROP TYPE "public"."credit_grants_reason_enum"`);
  }
}
