import type { FamilyTimeline, StoredDocument } from '@claimwatch/pipeline';
import { canonicalAnchorId } from '../lib/verifyHref';

interface CanonicalRecordProps {
  readonly timelines: readonly FamilyTimeline[];
  readonly documents: readonly StoredDocument[];
}

/** The verification surface: append-only claim history, every version anchored. */
export function CanonicalRecord({ timelines, documents }: CanonicalRecordProps) {
  const docsById = new Map(documents.map((doc) => [doc.docId, doc]));
  return (
    <section aria-labelledby="record-heading">
      <h2 id="record-heading">Canonical record</h2>
      {timelines.map((timeline) => {
        const firstDoc = docsById.get(timeline.versions[0]?.docId ?? '');
        // Doc-level anchors (used by document citations) sit on the first
        // rendered version of each document — one anchor per docId.
        const docAnchorVersionIds = new Map<string, number>();
        for (const version of timeline.versions) {
          if (!docAnchorVersionIds.has(version.docId)) {
            docAnchorVersionIds.set(version.docId, version.id);
          }
        }
        return (
          <article className="claim-record" key={timeline.familyId}>
            <h3>
              {timeline.assignee} — family {timeline.familyId}{' '}
              <span className="doc-meta">{firstDoc ? firstDoc.title : ''}</span>
            </h3>
            <dl>
              {timeline.versions.map((version) => {
                const doc = docsById.get(version.docId);
                return (
                  <div
                    className="claim-version"
                    key={version.id}
                    id={
                      // Anchor the LATEST capture of each claim per document so
                      // verify links land on the cited text.
                      canonicalAnchorId(version.docId, version.claimNumber)
                    }
                  >
                    <dt
                      id={
                        docAnchorVersionIds.get(version.docId) === version.id
                          ? canonicalAnchorId(version.docId)
                          : undefined
                      }
                    >
                      Claim {version.claimNumber} · v{version.versionSeq} · {version.docId} ·{' '}
                      published {doc?.publicationDate ?? 'unknown'}
                      {version.status === 'cancelled' ? ' · CANCELLED' : ''}
                    </dt>
                    <dd data-status={version.status}>{version.text}</dd>
                  </div>
                );
              })}
            </dl>
          </article>
        );
      })}
    </section>
  );
}
