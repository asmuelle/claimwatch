/**
 * Synthesis step: deterministic facts -> mocked frontier-model drafts ->
 * cite-or-omit gate (core) -> span-pinned citations.
 *
 * The LLM is behind the BriefSynthesizer interface; the deterministic facts
 * and the citation gate never depend on it (invariants 1 and 2).
 */
import { assembleBrief } from '@claimwatch/core';
import type {
  Brief,
  BriefItemDraft,
  BriefItemFact,
  CitationContext,
  CitationContextEntry,
  CitationRef,
  CoverageDisclosure,
} from '@claimwatch/core';
import type { ClaimDiffRow, SliceStore, StoredDocument } from '../store/types';
import { spendTokens } from '../llm/types';
import type { BriefSynthesizer, TokenBudget } from '../llm/types';
import type { WatchlistConfig } from '../triage/watchlist';
import { renderBlacklineText } from './renderBlackline';

/** A citation pinned to the exact character span of its marker in the sentence. */
export interface PinnedCitation {
  readonly ref: CitationRef;
  readonly sentenceText: string;
  readonly start: number;
  readonly end: number;
  readonly marker: string;
}

export interface SynthesisResult {
  readonly brief: Brief;
  readonly pinnedCitations: readonly PinnedCitation[];
  readonly budget: TokenBudget;
}

function headlineFor(diff: ClaimDiffRow, publicationDate: string): string {
  const verb = diff.change === 'cancelled' ? 'cancelled' : `amended (${diff.change})`;
  return `Claim ${diff.claimNumber} ${verb} on ${publicationDate}: ${renderBlacklineText(diff.hunks)}`;
}

async function diffFacts(
  store: SliceStore,
  weekDocs: readonly StoredDocument[],
): Promise<BriefItemFact[]> {
  const docsById = new Map(weekDocs.map((doc) => [doc.docId, doc]));
  const versionsById = new Map((await store.listClaimVersions()).map((row) => [row.id, row]));
  const facts: BriefItemFact[] = [];
  for (const diff of await store.listClaimDiffs()) {
    // Only diffs against a prior version are amendment facts; 'added' hunks on
    // first capture belong to new-filing facts instead.
    if (diff.fromVersionId === null) continue;
    const version = versionsById.get(diff.toVersionId);
    const doc = version ? docsById.get(version.docId) : undefined;
    if (!version || !doc) continue;
    facts.push({
      kind: diff.change === 'cancelled' ? 'claim-cancelled' : 'claim-amended',
      familyId: diff.familyId,
      docId: doc.docId,
      assignee: doc.assignee,
      publicationDate: doc.publicationDate,
      claimNumber: diff.claimNumber,
      change: diff.change,
      hunks: diff.hunks,
      headline: headlineFor(diff, doc.publicationDate),
    });
  }
  return facts;
}

async function newFilingFacts(
  store: SliceStore,
  surfaced: readonly StoredDocument[],
  watchlist: WatchlistConfig,
): Promise<BriefItemFact[]> {
  const allVersions = await store.listClaimVersions();
  const facts: BriefItemFact[] = [];
  for (const doc of surfaced) {
    const hasPriorVersion = allVersions.some(
      (row) => row.familyId === doc.applicationNumber && row.docId !== doc.docId,
    );
    if (hasPriorVersion) continue; // amendments are covered by diff facts
    const isNamedCompetitor = watchlist.namedAssignees.includes(doc.assignee);
    facts.push({
      kind: isNamedCompetitor ? 'new-filing' : 'first-observation',
      familyId: doc.applicationNumber,
      docId: doc.docId,
      assignee: doc.assignee,
      publicationDate: doc.publicationDate,
      headline: `${doc.assignee} — new publication ${doc.docId} on ${doc.publicationDate}: "${doc.title}"`,
    });
  }
  return facts;
}

/** Citation context: every stored doc with the claim numbers it published. */
export async function buildCitationContext(store: SliceStore): Promise<CitationContext> {
  const allVersions = await store.listClaimVersions();
  const documents = new Map<string, CitationContextEntry>();
  for (const doc of await store.listDocuments()) {
    const claimNumbers = new Set<number>();
    for (const version of allVersions) {
      if (version.docId === doc.docId) claimNumbers.add(version.claimNumber);
    }
    documents.set(doc.docId, { publicationDate: doc.publicationDate, claimNumbers });
  }
  return { documents };
}

function markerFor(ref: CitationRef): string {
  return ref.claimNumber !== undefined
    ? `(${ref.docId}, claim ${ref.claimNumber}, ${ref.date})`
    : `(${ref.docId}, ${ref.date})`;
}

/** Pins every citation of every KEPT sentence to its character span. */
export function pinCitations(brief: Brief): readonly PinnedCitation[] {
  const pinned: PinnedCitation[] = [];
  for (const item of brief.items) {
    for (const validation of item.sentences) {
      if (!validation.kept) continue;
      for (const record of validation.citations) {
        const marker = markerFor(record.ref);
        const start = validation.sentence.text.indexOf(marker);
        pinned.push({
          ref: record.ref,
          sentenceText: validation.sentence.text,
          start,
          end: start === -1 ? -1 : start + marker.length,
          marker,
        });
      }
    }
  }
  return pinned;
}

export interface SynthesizeBriefInput {
  readonly store: SliceStore;
  readonly watchlist: WatchlistConfig;
  readonly weekDocs: readonly StoredDocument[];
  readonly surfaced: readonly StoredDocument[];
  readonly synthesizer: BriefSynthesizer;
  readonly budget: TokenBudget;
  readonly weekOf: string;
  /** Injected clock for determinism. */
  readonly nowIso: string;
}

/** Assembles the validated weekly brief from stored facts. */
export async function synthesizeBrief(input: SynthesizeBriefInput): Promise<SynthesisResult> {
  const surfacedIds = new Set(input.surfaced.map((doc) => doc.docId));
  const facts = [
    ...(await diffFacts(input.store, input.weekDocs)).filter((fact) => surfacedIds.has(fact.docId)),
    ...(await newFilingFacts(input.store, input.surfaced, input.watchlist)),
  ].sort((a, b) => a.docId.localeCompare(b.docId) || (a.claimNumber ?? 0) - (b.claimNumber ?? 0));

  let budget = input.budget;
  const drafts: BriefItemDraft[] = [];
  for (const fact of facts) {
    const draft = await input.synthesizer.draftSentences(fact);
    budget = spendTokens(budget, draft.tokensUsed, 'synthesis');
    drafts.push({ fact, sentences: draft.sentences });
  }

  const coverage: CoverageDisclosure = {
    watched: input.watchlist.jurisdictionsWatched,
    notWatched: input.watchlist.jurisdictionsNotWatched,
  };
  const brief = assembleBrief({
    watchlistName: input.watchlist.name,
    weekOf: input.weekOf,
    drafts,
    citationContext: await buildCitationContext(input.store),
    coverage,
    nowIso: input.nowIso,
  });
  return { brief, pinnedCitations: pinCitations(brief), budget };
}
