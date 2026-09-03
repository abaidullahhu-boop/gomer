import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * The subscription credit model: buckets, expiry, allocations and plans.
 *
 * Four changes land together because none of them is correct alone:
 *
 *  1. Credits are redenominated from 100 to 400 per dollar. Every stored figure
 *     is multiplied by four so no workspace gains or loses value — only the
 *     unit changes.
 *  2. Grants gain a bucket and an expiry, so a plan allowance can run out while
 *     a top-up does not.
 *  3. `credit_allocations` records which grant paid for which run. Spend used to
 *     be a single subtraction; with four buckets it has to say *which* credits
 *     were drawn, or expiry cannot be computed.
 *  4. `subscriptions` mirrors Stripe's recurring plans.
 *
 * The allocation backfill is the delicate part. Balances were previously
 * SUM(grants) - SUM(events); afterwards they are per-grant remainders. Without
 * backfilling, every historical grant would read as untouched and every
 * workspace's balance would jump by whatever it had already spent.
 */
export class SubscriptionCreditModel1731000000000 implements MigrationInterface {
  name = 'SubscriptionCreditModel1731000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // --- 1. Redenominate: 100 -> 400 credits per dollar -------------------
    // Both sides of the ledger scale by the same factor, so every balance is
    // unchanged in dollar terms. Done first so everything below is written in
    // the new unit.
    await queryRunner.query(`UPDATE "credit_grants" SET "credits" = "credits" * 4`);
    await queryRunner.query(`UPDATE "credit_events" SET "creditsUsed" = "creditsUsed" * 4`);

    // --- 2. Widen the reason enum -----------------------------------------
    // Recreated rather than ALTER TYPE ... ADD VALUE, which cannot be used in
    // the same transaction that writes the new values on some Postgres versions.
    await queryRunner.query(
      `CREATE TYPE "public"."credit_grants_reason_enum_new" AS ENUM(
        'onboarding', 'topup', 'manual', 'subscription', 'rollover', 'referral', 'seat_bonus')`,
    );
    await queryRunner.query(
      `ALTER TABLE "credit_grants" ALTER COLUMN "reason" TYPE "public"."credit_grants_reason_enum_new"
       USING "reason"::text::"public"."credit_grants_reason_enum_new"`,
    );
    await queryRunner.query(`DROP TYPE "public"."credit_grants_reason_enum"`);
    await queryRunner.query(
      `ALTER TYPE "public"."credit_grants_reason_enum_new" RENAME TO "credit_grants_reason_enum"`,
    );

    // --- 3. Buckets and expiry on grants ----------------------------------
    await queryRunner.query(
      `CREATE TYPE "public"."credit_bucket_enum" AS ENUM('rollover', 'plan', 'topup', 'reward')`,
    );
    await queryRunner.query(
      `ALTER TABLE "credit_grants" ADD "bucket" "public"."credit_bucket_enum" NOT NULL DEFAULT 'topup'`,
    );
    await queryRunner.query(`ALTER TABLE "credit_grants" ADD "expiresAt" TIMESTAMP WITH TIME ZONE`);
    await queryRunner.query(
      `ALTER TABLE "credit_grants" ADD "stripeInvoiceId" character varying(255)`,
    );
    await queryRunner.query(
      `ALTER TABLE "credit_grants" ADD CONSTRAINT "UQ_credit_grants_stripe_invoice" UNIQUE ("stripeInvoiceId")`,
    );
    // Existing grants: bought credits are top-ups, everything given away is a
    // reward. Both never expire, which is what these rows already were.
    await queryRunner.query(
      `UPDATE "credit_grants" SET "bucket" = 'reward' WHERE "reason" <> 'topup'`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_credit_grants_bucket" ON "credit_grants" ("bucket")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_credit_grants_expires_at" ON "credit_grants" ("expiresAt")`,
    );

    // --- 4. Allocations ----------------------------------------------------
    await queryRunner.query(
      `CREATE TABLE "credit_allocations" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "creditEventId" uuid,
        "grantId" uuid NOT NULL,
        "bucket" "public"."credit_bucket_enum" NOT NULL,
        "credits" integer NOT NULL,
        "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_credit_allocations_id" PRIMARY KEY ("id")
      )`,
    );
    await queryRunner.query(
      `ALTER TABLE "credit_allocations" ADD CONSTRAINT "FK_credit_allocations_event"
       FOREIGN KEY ("creditEventId") REFERENCES "credit_events"("id") ON DELETE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "credit_allocations" ADD CONSTRAINT "FK_credit_allocations_grant"
       FOREIGN KEY ("grantId") REFERENCES "credit_grants"("id") ON DELETE CASCADE`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_credit_allocations_event" ON "credit_allocations" ("creditEventId")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_credit_allocations_grant" ON "credit_allocations" ("grantId")`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_credit_allocations_grant_event"
       ON "credit_allocations" ("grantId", "creditEventId")`,
    );

    // --- 5. Backfill historical consumption --------------------------------
    // Each workspace's total prior spend is laid across its grants oldest
    // first: a grant absorbs whatever part of the running total falls inside
    // its own slice. `creditEventId` is null because spend recorded before this
    // table existed cannot be attributed to one run — only to the pot it came
    // out of.
    await queryRunner.query(
      `INSERT INTO "credit_allocations" ("creditEventId", "grantId", "bucket", "credits")
       SELECT NULL, ranked."id", ranked."bucket",
              LEAST(ranked."credits", GREATEST(0, spend."used" - ranked."prior"))
       FROM (
         SELECT g."id", g."workspaceId", g."credits", g."bucket",
                COALESCE(SUM(g."credits") OVER (
                  PARTITION BY g."workspaceId"
                  ORDER BY g."createdAt", g."id"
                  ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING
                ), 0) AS "prior"
         FROM "credit_grants" g
       ) ranked
       JOIN (
         SELECT "workspaceId", COALESCE(SUM("creditsUsed"), 0) AS "used"
         FROM "credit_events" GROUP BY "workspaceId"
       ) spend ON spend."workspaceId" = ranked."workspaceId"
       WHERE LEAST(ranked."credits", GREATEST(0, spend."used" - ranked."prior")) > 0`,
    );

    // --- 6. Subscriptions ---------------------------------------------------
    await queryRunner.query(
      `CREATE TYPE "public"."subscriptions_status_enum" AS ENUM(
        'trialing', 'active', 'past_due', 'canceled', 'incomplete')`,
    );
    await queryRunner.query(
      `CREATE TABLE "subscriptions" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "workspaceId" uuid NOT NULL,
        "planId" character varying(64) NOT NULL,
        "status" "public"."subscriptions_status_enum" NOT NULL,
        "stripeSubscriptionId" character varying(255) NOT NULL,
        "stripeCustomerId" character varying(255) NOT NULL,
        "currentPeriodStart" TIMESTAMP WITH TIME ZONE NOT NULL,
        "currentPeriodEnd" TIMESTAMP WITH TIME ZONE NOT NULL,
        "seats" integer NOT NULL DEFAULT 0,
        "cancelAtPeriodEnd" boolean NOT NULL DEFAULT false,
        "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_subscriptions_id" PRIMARY KEY ("id")
      )`,
    );
    await queryRunner.query(
      `ALTER TABLE "subscriptions" ADD CONSTRAINT "FK_subscriptions_workspace"
       FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE CASCADE`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_subscriptions_workspace" ON "subscriptions" ("workspaceId")`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_subscriptions_stripe_id" ON "subscriptions" ("stripeSubscriptionId")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "subscriptions"`);
    await queryRunner.query(`DROP TYPE "public"."subscriptions_status_enum"`);
    await queryRunner.query(`DROP TABLE "credit_allocations"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_credit_grants_expires_at"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_credit_grants_bucket"`);
    await queryRunner.query(
      `ALTER TABLE "credit_grants" DROP CONSTRAINT "UQ_credit_grants_stripe_invoice"`,
    );
    await queryRunner.query(`ALTER TABLE "credit_grants" DROP COLUMN "stripeInvoiceId"`);
    await queryRunner.query(`ALTER TABLE "credit_grants" DROP COLUMN "expiresAt"`);
    await queryRunner.query(`ALTER TABLE "credit_grants" DROP COLUMN "bucket"`);
    await queryRunner.query(`DROP TYPE "public"."credit_bucket_enum"`);

    // Rows carrying a reason the old enum lacks would fail the cast; fold them
    // into the nearest old meaning first. Both were credits given, not sold.
    await queryRunner.query(
      `UPDATE "credit_grants" SET "reason" = 'manual'
       WHERE "reason" IN ('subscription', 'rollover', 'referral', 'seat_bonus')`,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."credit_grants_reason_enum_old" AS ENUM('onboarding', 'topup', 'manual')`,
    );
    await queryRunner.query(
      `ALTER TABLE "credit_grants" ALTER COLUMN "reason" TYPE "public"."credit_grants_reason_enum_old"
       USING "reason"::text::"public"."credit_grants_reason_enum_old"`,
    );
    await queryRunner.query(`DROP TYPE "public"."credit_grants_reason_enum"`);
    await queryRunner.query(
      `ALTER TYPE "public"."credit_grants_reason_enum_old" RENAME TO "credit_grants_reason_enum"`,
    );

    // Back to 100 credits per dollar.
    await queryRunner.query(`UPDATE "credit_events" SET "creditsUsed" = "creditsUsed" / 4`);
    await queryRunner.query(`UPDATE "credit_grants" SET "credits" = "credits" / 4`);
  }
}
