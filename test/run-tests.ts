/**
 * Minimal test entrypoint. The project has no full test framework wired, so we
 * lean on Node's built-in `node:test` runner: requiring each `*.spec.ts` file
 * registers its tests, and node:test runs and reports them at process exit
 * (setting a non-zero exit code on failure). Run with `npm test`.
 */
import { readdirSync } from 'fs';
import { join } from 'path';

const SRC = join(__dirname, '..', 'src');

function findSpecs(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...findSpecs(full));
    else if (entry.name.endsWith('.spec.ts')) out.push(full);
  }
  return out;
}

for (const spec of findSpecs(SRC)) {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  require(spec);
}
