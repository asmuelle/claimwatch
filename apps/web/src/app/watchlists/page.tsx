/**
 * Watchlist management (M3): plan summary, the org's watchlists with frozen
 * marking after downgrades, and the create form enforced against plan limits.
 * Pre-auth demo surface: ?org= selects one of the seeded demo workspaces.
 */
import type { Metadata } from 'next';
import Link from 'next/link';
import { PLANS, entitledPlan, partitionWatchlistsByEntitlement } from '@claimwatch/core';
import type { WatchlistRecord } from '@claimwatch/pipeline';
import { DEMO_ORGS, getWorkspaceStore, resolveDemoOrg } from '../../lib/server/workspace';
import { WatchlistForm } from './WatchlistForm';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Watchlists — ClaimWatch',
};

interface PageProps {
  readonly searchParams: Promise<{ readonly org?: string }>;
}

function WatchlistRow({
  watchlist,
  frozen,
  orgSlug,
}: {
  readonly watchlist: WatchlistRecord;
  readonly frozen: boolean;
  readonly orgSlug: string;
}) {
  return (
    <article className="watchlist-card" data-frozen={frozen || undefined}>
      <header>
        <h3>{watchlist.name}</h3>
        {frozen ? (
          <span className="frozen-tag">frozen — over plan limit, read-only</span>
        ) : (
          <Link
            className="edit-link"
            href={`/watchlists/${watchlist.id}/edit?org=${orgSlug}`}
          >
            Edit
          </Link>
        )}
      </header>
      <p className="watchlist-description">{watchlist.claimSpaceDescription}</p>
      <dl className="watchlist-facts">
        <div>
          <dt>CPC classes</dt>
          <dd>{watchlist.cpcPrefixes.join(', ')}</dd>
        </div>
        <div>
          <dt>Named competitors</dt>
          <dd>{watchlist.competitors.length > 0 ? watchlist.competitors.join('; ') : '—'}</dd>
        </div>
      </dl>
    </article>
  );
}

export default async function WatchlistsPage({ searchParams }: PageProps) {
  const { org: orgParam } = await searchParams;
  const org = resolveDemoOrg(orgParam);
  const store = await getWorkspaceStore();
  const nowIso = new Date().toISOString();

  const subscription = await store.getSubscription(org.slug);
  const plan = entitledPlan(subscription, nowIso);
  const watchlists = await store.listWatchlists(org.slug);
  const { active, frozen } = plan
    ? partitionWatchlistsByEntitlement(plan, watchlists)
    : { active: [], frozen: watchlists };
  const frozenIds = new Set(frozen.map((row) => row.id));
  const planDef = plan ? PLANS[plan] : null;

  return (
    <>
      <header className="masthead">
        <h1>ClaimWatch</h1>
        <nav aria-label="Main navigation" className="site-nav">
          <Link href="/">Weekly brief</Link>
          <Link href={`/watchlists?org=${org.slug}`} aria-current="page">
            Watchlists
          </Link>
          <Link href={`/export?org=${org.slug}`}>Counsel export</Link>
        </nav>
        <p className="edition-line">
          <span>{org.name}</span>
          {planDef ? (
            <span className="plan-line">
              {planDef.label} plan — ${planDef.monthlyUsd.toLocaleString('en-US')}/mo
            </span>
          ) : (
            <span className="plan-line">no active plan</span>
          )}
          {planDef ? (
            <span className="usage-line">
              {watchlists.length} of {planDef.limits.watchlists} watchlist
              {planDef.limits.watchlists === 1 ? '' : 's'} in use
            </span>
          ) : null}
        </p>
        <nav aria-label="Demo workspaces" className="org-switcher">
          <span>Demo workspaces:</span>
          {DEMO_ORGS.map((demo) => (
            <Link
              key={demo.slug}
              href={`/watchlists?org=${demo.slug}`}
              aria-current={demo.slug === org.slug ? 'page' : undefined}
            >
              {demo.name}
            </Link>
          ))}
        </nav>
      </header>
      <main>
        <section aria-labelledby="watchlists-heading">
          <h2 id="watchlists-heading">Watchlists</h2>
          {watchlists.length === 0 ? (
            <p className="empty-note">
              No watchlists yet. The first one seeds screening for the next Tue/Thu cycle.
            </p>
          ) : (
            [...active, ...frozen].map((watchlist) => (
              <WatchlistRow
                key={watchlist.id}
                watchlist={watchlist}
                frozen={frozenIds.has(watchlist.id)}
                orgSlug={org.slug}
              />
            ))
          )}
        </section>
        <section aria-labelledby="create-heading">
          <h2 id="create-heading">Create a watchlist</h2>
          <WatchlistForm mode="create" orgSlug={org.slug} currentPlan={plan} />
        </section>
      </main>
    </>
  );
}
