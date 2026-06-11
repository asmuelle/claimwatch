import type { Brief, BriefItem } from '@claimwatch/core';
import { verifyHref } from '../lib/verifyHref';
import { Blackline } from './Blackline';

const KIND_LABEL: Record<BriefItem['fact']['kind'], string> = {
  'claim-amended': 'Claim amended',
  'claim-cancelled': 'Claim cancelled',
  'new-filing': 'New filing — named competitor',
  'first-observation': 'First observation',
};

function BriefItemArticle({ item }: { readonly item: BriefItem }) {
  return (
    <article className="brief-item" data-kind={item.fact.kind}>
      <header>
        <span className="kind-tag">{KIND_LABEL[item.fact.kind]}</span>
        <span className="kind-tag">{item.fact.assignee}</span>
      </header>
      <h3>{item.fact.headline}</h3>
      {item.fact.hunks && item.fact.hunks.length > 0 ? (
        <Blackline hunks={item.fact.hunks} />
      ) : null}
      {item.sentences
        .filter((validation) => validation.kept)
        .map((validation, index) => (
          <p className="synthesized" key={index}>
            {validation.sentence.text}{' '}
            {validation.citations.map((citation) => (
              <a
                className="verify-link"
                key={`${citation.ref.docId}-${citation.ref.claimNumber ?? 'doc'}`}
                href={verifyHref(citation.ref)}
              >
                [verify]
              </a>
            ))}
          </p>
        ))}
      {item.fallbackUsed ? (
        <p className="fallback-note">
          Synthesized prose withheld (cite-or-omit) — deterministic record shown above.
        </p>
      ) : null}
    </article>
  );
}

export function BriefSection({ brief }: { readonly brief: Brief }) {
  return (
    <section aria-labelledby="brief-heading">
      <h2 id="brief-heading">
        Weekly brief — {brief.watchlistName}, week of {brief.weekOf}
      </h2>
      {brief.items.map((item, index) => (
        <BriefItemArticle key={index} item={item} />
      ))}
    </section>
  );
}
