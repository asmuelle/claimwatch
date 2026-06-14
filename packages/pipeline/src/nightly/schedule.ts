/**
 * Schedulable entrypoint configuration for the nightly runner (M4).
 * DOCUMENTED, NOT STARTED: nothing in the repo registers these schedules at
 * runtime — production wiring picks ONE of the two options below.
 *
 * Option A — cron (TOOLS.md has the crontab lines):
 *   15 6 * * 2,4  just nightly --live   # Tue/Thu 06:15 ET after USPTO publishes
 *   0  2 * * *    just nightly          # nightly fixture regression run
 *
 * Option B — Inngest (DESIGN.md scheduler decision): a cron-triggered
 * function calling runNightly with a Drizzle-backed store. Shape:
 *
 *   inngest.createFunction(
 *     { id: NIGHTLY_FUNCTION_ID },
 *     { cron: `TZ=${NIGHTLY_CRON_TZ} ${NIGHTLY_LIVE_CRON}` },
 *     async () => runNightly({ live: true, fixturesDir, env: process.env }),
 *   )
 */

/** Tue/Thu 06:15 — aligned to the USPTO grant/pre-grant publication cycle. */
export const NIGHTLY_LIVE_CRON = '15 6 * * 2,4';

/** Daily 02:00 — fixture-driven regression run (no network). */
export const NIGHTLY_FIXTURES_CRON = '0 2 * * *';

export const NIGHTLY_CRON_TZ = 'America/New_York';

export const NIGHTLY_FUNCTION_ID = 'claimwatch-nightly';
