/**
 * Counsel-ready brief export (M3): print-optimized blackline artifact over
 * the validated fixture brief. Gated server-side: counsel variant is Pro+,
 * the white-label variant (firm branding, zero ClaimWatch marks) is Firm.
 * A non-entitled org gets the designed upgrade prompt, never an error.
 */
import { join } from 'node:path';
import type { Metadata } from 'next';
import Link from 'next/link';
import { entitledPlan, hasFeature } from '@claimwatch/core';
import type { CounselExport, ExportSentence } from '@claimwatch/pipeline';
import { buildCounselExport, cheapestPlanWith, runSlice } from '@claimwatch/pipeline';
import { Blackline } from '../../components/Blackline';
import { UpgradePrompt } from '../../components/UpgradePrompt';
import { getWorkspaceStore, resolveDemoOrg } from '../../lib/server/workspace';

export const dynamic = 'force-dynamic';

const FIXTURES_DIR = join(process.cwd(), '..', '..', 'fixtures', 'uspto');

interface PageProps {
  readonly searchParams: Promise<{ readonly org?: string }>;
}

export async function generateMetadata({ searchParams }: PageProps): Promise<Metadata> {
  const { org: orgParam } = await searchParams;
  const org = resolveDemoOrg(orgParam);
  const whiteLabel = org.plan === 'firm';
  return {
    title: whiteLabel ? `Counsel brief — ${org.name}` : 'Counsel brief export — ClaimWatch',
  };
}

function SentenceLine({ sentence }: { readonly sentence: ExportSentence }) {
  return (
    <p className="export-sentence">
      {sentence.text}
      {sentence.citations.map((pin, index) => (
        <span className="export-citation" key={index}>
          {' '}
          [{pin.ref.docId}
          {pin.ref.claimNumber !== undefined ? `, claim ${pin.ref.claimNumber}` : ''}, {pin.ref.date}
          ]
        </span>
      ))}
    </p>
  );
}

function ExportArtifact({ exported }: { readonly exported: CounselExport }) {
  return (
    <article className="export-brief" data-variant={exported.whiteLabel ? 'white-label' : 'counsel'}>
      <header className="export-masthead">
        <p className="export-brand">{exported.brand}</p>
        <h2>Weekly claim-evolution brief</h2>
        <p className="export-edition">
          <span>Watchlist: {exported.watchlistName}</span>
          <span>Week of {exported.weekOf}</span>
          <span className="validated-stamp">
            citations validated {exported.validatedAt.slice(0, 10)}
          </span>
        </p>
      </header>
      {exported.items.map((item, index) => (
        <section className="export-item" key={index}>
          <h3>{item.fact.headline}</h3>
          {item.fact.hunks && item.fact.hunks.length > 0 ? (
            <Blackline hunks={item.fact.hunks} />
          ) : null}
          {item.sentences.map((sentence, sIndex) => (
            <SentenceLine key={sIndex} sentence={sentence} />
          ))}
        </section>
      ))}
      <footer className="export-footer">
        <p>{exported.disclaimer}</p>
        <p>
          Coverage: watching {exported.coverage.watched.join('; ')}. Not watched:{' '}
          {exported.coverage.notWatched.join(', ')}.
        </p>
        {exported.omittedSentenceCount > 0 ? (
          <p>
            {exported.omittedSentenceCount} synthesized sentence
            {exported.omittedSentenceCount === 1 ? '' : 's'} omitted (citation pinning) — the
            deterministic record above is complete.
          </p>
        ) : null}
      </footer>
    </article>
  );
}

export default async function ExportPage({ searchParams }: PageProps) {
  const { org: orgParam } = await searchParams;
  const org = resolveDemoOrg(orgParam);
  const store = await getWorkspaceStore();
  const plan = entitledPlan(await store.getSubscription(org.slug), new Date().toISOString());

  const entitled = plan !== null && hasFeature(plan, 'counsel-export');
  const whiteLabel = plan !== null && hasFeature(plan, 'white-label-briefs');

  if (!entitled) {
    return (
      <>
        <header className="masthead">
          <h1>ClaimWatch</h1>
          <nav aria-label="Main navigation" className="site-nav">
            <Link href="/">Weekly brief</Link>
            <Link href={`/watchlists?org=${org.slug}`}>Watchlists</Link>
            <Link href={`/export?org=${org.slug}`} aria-current="page">
              Counsel export
            </Link>
          </nav>
          <p className="edition-line">
            <span>{org.name}</span>
          </p>
        </header>
        <main>
          <section aria-labelledby="export-heading">
            <h2 id="export-heading">Counsel-ready export</h2>
            <UpgradePrompt
              title="Counsel-ready export is a Pro feature"
              detail="Print-grade brief artifacts with pinned citations ship on Pro and above; white-label firm branding ships on Firm."
              currentPlan={plan}
              suggestedPlan={cheapestPlanWith('counsel-export')}
            />
          </section>
        </main>
      </>
    );
  }

  const slice = await runSlice({ fixturesDir: FIXTURES_DIR });
  const exported = buildCounselExport(slice.brief, slice.pinnedCitations, {
    plan,
    variant: whiteLabel ? 'white-label' : 'counsel',
    firmName: org.name,
  });

  return (
    <>
      <header className="masthead export-chrome">
        {whiteLabel ? <h1>{org.name}</h1> : <h1>ClaimWatch</h1>}
        <nav aria-label="Main navigation" className="site-nav">
          <Link href="/">Weekly brief</Link>
          <Link href={`/watchlists?org=${org.slug}`}>Watchlists</Link>
          <Link href={`/export?org=${org.slug}`} aria-current="page">
            Counsel export
          </Link>
        </nav>
        <p className="edition-line">
          <span>Prepared for {org.name}</span>
          <span className="print-hint">Print this page to produce the PDF deliverable.</span>
        </p>
      </header>
      <main>
        <ExportArtifact exported={exported} />
      </main>
    </>
  );
}
