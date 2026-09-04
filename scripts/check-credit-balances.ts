/**
 * Cross-checks every workspace's reported balance against the ledger itself.
 *
 * `getBalance` aggregates grants and allocations in one grouped query, which is
 * fast and — twice now — subtly wrong in a way nothing failed on: an alias that
 * is a reserved word, and a join that counted a grant once per time it had been
 * spent. Neither is reachable from a unit test, because both live in SQL rather
 * than in the arithmetic around it.
 *
 * So this recomputes the same figure the slow, obvious way — one row per grant,
 * allocations summed per grant first — and fails if the two disagree. Read-only
 * and safe to point at production.
 *
 *   npm run check:credits
 */
import 'dotenv/config';
import { NestFactory } from '@nestjs/core';
import { DataSource } from 'typeorm';
import { AppModule } from '../src/app.module';
import { UsageService } from '../src/usage/usage.service';
import { Workspace } from '../src/database/entities/workspace.entity';
import { CREDITS_PER_DOLLAR } from '../src/ai/providers/model-catalog';

/** The balance, computed without a fan-out-prone join. */
const TRUTH = `
  SELECT COALESCE(SUM(GREATEST(0, g."credits" - COALESCE(a."spent", 0))), 0) AS balance
  FROM "credit_grants" g
  LEFT JOIN (
    SELECT "grantId", SUM("credits") AS "spent"
    FROM "credit_allocations"
    GROUP BY "grantId"
  ) a ON a."grantId" = g."id"
  WHERE g."workspaceId" = $1
    AND (g."expiresAt" IS NULL OR g."expiresAt" > NOW())
`;

const asDollars = (credits: number) => `$${(credits / CREDITS_PER_DOLLAR).toFixed(2)}`;

async function main(): Promise<void> {
  const app = await NestFactory.createApplicationContext(AppModule, { logger: false });
  let mismatches = 0;
  try {
    const usage = app.get(UsageService);
    const dataSource = app.get(DataSource);
    const workspaces = await dataSource.getRepository(Workspace).find();

    for (const workspace of workspaces) {
      const reported = (await usage.getBalance(workspace.id)).balance;
      const [{ balance }] = await dataSource.query<Array<{ balance: string }>>(TRUTH, [
        workspace.id,
      ]);
      const truth = Number(balance);
      const ok = reported === truth;
      if (!ok) mismatches += 1;
      console.log(
        `${ok ? 'ok  ' : 'FAIL'}  ${(workspace.name ?? workspace.id).padEnd(24)} ` +
          `reported ${reported.toLocaleString()} (${asDollars(reported)})` +
          (ok ? '' : `  ledger says ${truth.toLocaleString()} (${asDollars(truth)})`),
      );
    }

    console.log(
      `\n${workspaces.length} workspace(s) checked, ${mismatches} mismatch(es).` +
        (mismatches ? ' The balance query and the ledger disagree.' : ''),
    );
  } finally {
    await app.close();
  }
  if (mismatches > 0) process.exit(1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
