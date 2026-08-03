/**
 * Grant credits to a workspace by hand — for local testing, and for the support
 * cases the MANUAL grant reason exists for. Goes through UsageService so the
 * grant lands in the ledger exactly as a Stripe top-up would.
 *
 *   npm run credits                          # list workspaces and balances
 *   npm run credits -- <workspaceId> 10000   # grant 10,000 credits ($100)
 */
import 'dotenv/config';
import { NestFactory } from '@nestjs/core';
import { DataSource } from 'typeorm';
import { AppModule } from '../src/app.module';
import { UsageService } from '../src/usage/usage.service';
import { Workspace } from '../src/database/entities/workspace.entity';
import { CreditGrantReason } from '../src/common/enums/credit-grant-reason.enum';

async function main(): Promise<void> {
  const [workspaceId, rawCredits] = process.argv.slice(2);
  const context = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn'],
  });
  try {
    const usage = context.get(UsageService, { strict: false });
    const workspaces = await context
      .get(DataSource, { strict: false })
      .getRepository(Workspace)
      .find();

    if (!workspaceId) {
      console.log('workspaces:\n');
      for (const workspace of workspaces) {
        const balance = await usage.getBalance(workspace.id);
        console.log(
          `  ${workspace.id}  ${(workspace.name ?? '—').padEnd(24)} ` +
            `$${(balance.balance / 100).toFixed(2)}`,
        );
      }
      console.log('\nto grant:  npm run credits -- <workspaceId> 10000');
      return;
    }

    if (!workspaces.some((workspace) => workspace.id === workspaceId)) {
      throw new Error(`No workspace with id ${workspaceId}`);
    }
    const credits = Number(rawCredits);
    if (!Number.isFinite(credits) || credits <= 0) {
      throw new Error(`Credits must be a positive number, got: ${rawCredits}`);
    }

    await usage.grantCredits({
      workspaceId,
      reason: CreditGrantReason.MANUAL,
      credits,
      note: 'Local testing grant',
    });
    const balance = await usage.getBalance(workspaceId);
    console.log(
      `Granted ${credits} credits. New balance: $${(balance.balance / 100).toFixed(2)}`,
    );
  } finally {
    await context.close();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
