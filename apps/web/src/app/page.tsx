/**
 * Read-only render of the M1 slice: fixture-driven, deterministic, no
 * database and no model API. The page is the brief archive + verification
 * surface (DESIGN.md flow 5): every citation links to the canonical stored
 * claim text rendered below.
 */
import { join } from 'node:path';
import { runSlice } from '@claimwatch/pipeline';
import { BriefSection } from '../components/BriefSection';
import { CanonicalRecord } from '../components/CanonicalRecord';
import { ScreeningTable } from '../components/ScreeningTable';

const FIXTURES_DIR = join(process.cwd(), '..', '..', 'fixtures', 'uspto');

export default async function HomePage() {
  const slice = await runSlice({ fixturesDir: FIXTURES_DIR });
  const { brief } = slice;

  return (
    <>
      <header className="masthead">
        <h1>ClaimWatch</h1>
        <p className="edition-line">
          <span>Watchlist: {slice.watchlist.name}</span>
          <span>Week of {brief.weekOf}</span>
          <span>
            {slice.documents.length} documents · {slice.screening.length} screened ·{' '}
            {brief.items.length} brief items
          </span>
          {brief.validatedAt ? (
            <span className="validated-stamp">
              citations validated {brief.validatedAt.slice(0, 10)}
            </span>
          ) : (
            <span className="blocked-stamp">validation failed — send blocked</span>
          )}
        </p>
      </header>
      <main>
        <BriefSection brief={brief} />
        <ScreeningTable results={slice.screening} />
        <CanonicalRecord timelines={slice.timelines} documents={slice.documents} />
      </main>
      <footer>
        <p>{brief.disclaimer}</p>
        <p>
          Coverage: watching {brief.coverage.watched.join('; ')}. Not watched:{' '}
          {brief.coverage.notWatched.join(', ')}.
        </p>
        <p>
          Model spend this week (mocked, deterministic): screening {slice.screeningTokensUsed}{' '}
          tokens of {slice.watchlist.screeningTokenBudget}; synthesis {slice.synthesisTokensUsed}{' '}
          tokens of {slice.watchlist.synthesisTokenBudget}.
        </p>
      </footer>
    </>
  );
}
