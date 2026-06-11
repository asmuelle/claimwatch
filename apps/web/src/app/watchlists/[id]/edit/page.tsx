/** Edit an existing watchlist — same form, same validation, same limits. */
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { entitledPlan } from '@claimwatch/core';
import { getWorkspaceStore, resolveDemoOrg } from '../../../../lib/server/workspace';
import { WatchlistForm } from '../../WatchlistForm';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Edit watchlist — ClaimWatch',
};

interface PageProps {
  readonly params: Promise<{ readonly id: string }>;
  readonly searchParams: Promise<{ readonly org?: string }>;
}

export default async function EditWatchlistPage({ params, searchParams }: PageProps) {
  const { id } = await params;
  const { org: orgParam } = await searchParams;
  const store = await getWorkspaceStore();

  const watchlist = await store.getWatchlist(id);
  if (!watchlist) notFound();

  const org = resolveDemoOrg(orgParam ?? watchlist.orgId);
  const plan = entitledPlan(await store.getSubscription(watchlist.orgId), new Date().toISOString());

  return (
    <>
      <header className="masthead">
        <h1>ClaimWatch</h1>
        <nav aria-label="Main navigation" className="site-nav">
          <Link href="/">Weekly brief</Link>
          <Link href={`/watchlists?org=${org.slug}`}>Watchlists</Link>
          <Link href={`/export?org=${org.slug}`}>Counsel export</Link>
        </nav>
        <p className="edition-line">
          <span>{org.name}</span>
          <span>Editing “{watchlist.name}”</span>
        </p>
      </header>
      <main>
        <section aria-labelledby="edit-heading">
          <h2 id="edit-heading">Edit watchlist</h2>
          <WatchlistForm
            mode="edit"
            orgSlug={org.slug}
            currentPlan={plan}
            watchlistId={watchlist.id}
            defaults={{
              name: watchlist.name,
              claimSpaceDescription: watchlist.claimSpaceDescription,
              cpcPrefixes: watchlist.cpcPrefixes.join(', '),
              competitors: watchlist.competitors.join('\n'),
            }}
          />
        </section>
      </main>
    </>
  );
}
