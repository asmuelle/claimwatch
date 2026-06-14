/**
 * CLI entrypoint for the nightly runner: `just nightly [--live]`.
 *
 * Writes the run ledger (JSON) and the rendered brief (Markdown) to
 * out/nightly/ (gitignored) and prints a one-screen summary to stdout.
 * Exits non-zero on a runner crash; a failed SOURCE is recorded in the
 * ledger without failing the run (coverage notes carry the gap).
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runNightly } from './runNightly';

const HERE = fileURLToPath(new URL('.', import.meta.url));
const REPO_ROOT = join(HERE, '..', '..', '..', '..');
const FIXTURES_DIR = join(REPO_ROOT, 'fixtures', 'uspto');
const OUT_DIR = join(REPO_ROOT, 'out', 'nightly');

function out(line: string): void {
  process.stdout.write(`${line}\n`);
}

async function main(): Promise<void> {
  const live = process.argv.includes('--live');
  const result = await runNightly({
    live,
    fixturesDir: FIXTURES_DIR,
    env: process.env,
  });

  const stamp = result.ledger.startedAt.replace(/[:.]/g, '-');
  mkdirSync(OUT_DIR, { recursive: true });
  const ledgerPath = join(OUT_DIR, `ledger-${stamp}.json`);
  const briefPath = join(OUT_DIR, `brief-${stamp}.md`);
  writeFileSync(ledgerPath, `${JSON.stringify(result.ledger, null, 2)}\n`, 'utf8');
  writeFileSync(briefPath, result.renderedBrief, 'utf8');

  out(`nightly run (${result.ledger.mode}) — ${result.ledger.startedAt}`);
  for (const source of result.ledger.sources) {
    out(`  source ${source.source}: ${source.status} (${source.docsFetched} docs) — ${source.detail}`);
  }
  out(
    `  ingested ${result.ledger.docsIngested} docs ` +
      `(${result.ledger.docsSkippedDuplicate} duplicate no-ops), ` +
      `${result.ledger.claimVersionsAdded} claim versions, ` +
      `${result.ledger.claimDiffsComputed} diffs`,
  );
  out(
    `  models: ${result.ledger.modelProvider} — ` +
      `${result.ledger.screeningModelCalls} screening calls (${result.ledger.screeningTokensUsed} tok), ` +
      `${result.ledger.synthesisModelCalls} synthesis calls (${result.ledger.synthesisTokensUsed} tok)`,
  );
  out(
    `  brief: ${result.ledger.briefsProduced} produced, ` +
      `validated=${result.ledger.briefValidated} — items ${result.brief.items.length}, ` +
      `dropped ${result.brief.droppedSentenceCount}, violations ${result.brief.policyViolationCount}`,
  );
  for (const note of result.ledger.coverageNotes) out(`  coverage note: ${note}`);
  out(`  ledger: ${ledgerPath}`);
  out(`  brief:  ${briefPath}`);
}

main().catch((cause: unknown) => {
  console.error(`nightly run failed: ${String(cause)}`);
  process.exitCode = 1;
});
