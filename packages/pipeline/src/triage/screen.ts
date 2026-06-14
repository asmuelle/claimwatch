/**
 * Recall-biased screening (invariant 3): CPC-prefix ∪ embedding ∪ named
 * assignee — union, never intersection. Models may downrank, never delete:
 * EVERY document gets a logged screening_result, including rejects. Named
 * competitors bypass the classifier entirely.
 */
import type { MatchArm, ScreeningResultRow, SliceStore, StoredDocument } from '../store/types';
import { termOverlapScore } from '../llm/mocks';
import { spendTokens } from '../llm/types';
import type { RelevanceClassifier, TokenBudget } from '../llm/types';
import type { WatchlistConfig } from './watchlist';

export interface ScreeningOutcome {
  readonly results: readonly ScreeningResultRow[];
  /** Documents queued for the brief (decision === 'surface'). */
  readonly surfaced: readonly StoredDocument[];
  readonly budget: TokenBudget;
}

function matchArms(
  doc: StoredDocument,
  watchlist: WatchlistConfig,
  embeddingScore: number,
): readonly MatchArm[] {
  const arms: MatchArm[] = [];
  if (doc.cpcCodes.some((code) => watchlist.cpcPrefixes.some((p) => code.startsWith(p)))) {
    arms.push('cpc-prefix');
  }
  if (embeddingScore > 0) {
    arms.push('embedding');
  }
  if (watchlist.namedAssignees.includes(doc.assignee)) {
    arms.push('named-assignee');
  }
  return arms;
}

/**
 * Screens the week's documents against one watchlist. Deterministic order
 * (sorted by docId); classifier spend is budget-capped (invariant 7).
 */
export async function screenDocuments(
  store: SliceStore,
  watchlist: WatchlistConfig,
  docs: readonly StoredDocument[],
  classifier: RelevanceClassifier,
  initialBudget: TokenBudget,
): Promise<ScreeningOutcome> {
  const ordered = [...docs].sort((a, b) => a.docId.localeCompare(b.docId));
  const surfaced: StoredDocument[] = [];
  const results: ScreeningResultRow[] = [];
  let budget = initialBudget;

  for (const doc of ordered) {
    const embeddingScore = termOverlapScore(watchlist.claimSpaceTerms, doc.title);
    const arms = matchArms(doc, watchlist, embeddingScore);

    if (arms.includes('named-assignee')) {
      // Named competitors always surface — no classifier, no spend.
      const row = await store.appendScreeningResult({
        docId: doc.docId,
        watchlistName: watchlist.name,
        embeddingScore,
        matchedBy: arms,
        verdict: 'in-scope',
        confidence: 1,
        rationale: 'named competitor — bypasses screening entirely (invariant 3)',
        decision: 'surface',
        model: 'bypass',
        promptVersion: 'none',
      });
      results.push(row);
      surfaced.push(doc);
      continue;
    }

    if (arms.length === 0) {
      // Not a candidate, but still logged for recall audits — never silent.
      const row = await store.appendScreeningResult({
        docId: doc.docId,
        watchlistName: watchlist.name,
        embeddingScore,
        matchedBy: arms,
        verdict: 'out-of-scope',
        confidence: 0,
        rationale: 'no screening arm matched (CPC ∪ embedding ∪ name)',
        decision: 'downrank',
        model: 'deterministic-prefilter',
        promptVersion: 'none',
      });
      results.push(row);
      continue;
    }

    const verdict = await classifier.classify(doc, watchlist.claimSpaceDescription);
    budget = spendTokens(budget, verdict.tokensUsed, 'screening');
    const decision = verdict.verdict === 'out-of-scope' ? 'downrank' : 'surface';
    const row = await store.appendScreeningResult({
      docId: doc.docId,
      watchlistName: watchlist.name,
      embeddingScore,
      matchedBy: arms,
      verdict: verdict.verdict,
      confidence: verdict.confidence,
      rationale: verdict.rationale,
      decision,
      model: verdict.model,
      promptVersion: verdict.promptVersion,
    });
    results.push(row);
    if (decision === 'surface') {
      surfaced.push(doc);
    }
  }

  return { results, surfaced, budget };
}
