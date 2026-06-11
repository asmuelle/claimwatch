/**
 * Recall eval harness (DESIGN.md M2): screening recall and precision against
 * the hand-labeled ground-truth set for the pilot CPC vertical.
 *
 * The harness runs the REAL screening path (union prefilter + classifier via
 * the RelevanceClassifier interface) over labeled publications and reports
 * recall/precision. The companion test publishes the numbers and fails CI on
 * any regression — no retention or recall marketing claim without this gate.
 */
import { readFileSync } from 'node:fs';
import { z } from 'zod';
import { MockRelevanceClassifier } from '../llm/mocks';
import type { RelevanceClassifier } from '../llm/types';
import { MemoryStore } from '../store/memoryStore';
import type { StoredDocument } from '../store/types';
import { screenDocuments } from '../triage/screen';
import type { WatchlistConfig } from '../triage/watchlist';

const groundTruthEntrySchema = z.object({
  docId: z.string().min(1),
  title: z.string().min(1),
  assignee: z.string().min(1),
  cpcCodes: z.array(z.string().min(1)).min(1),
  publicationDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  label: z.enum(['in-scope', 'out-of-scope']),
  note: z.string().min(1),
});

const groundTruthFileSchema = z.object({
  description: z.string().min(1),
  watchlist: z.string().min(1),
  entries: z.array(groundTruthEntrySchema).min(100),
});

export type GroundTruthEntry = z.infer<typeof groundTruthEntrySchema>;
export type GroundTruthFile = z.infer<typeof groundTruthFileSchema>;

export class GroundTruthLoadError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'GroundTruthLoadError';
  }
}

/** Loads and validates the labeled set; ≥100 entries with unique docIds. */
export function loadGroundTruth(path: string): GroundTruthFile {
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(path, 'utf8'));
  } catch (cause) {
    throw new GroundTruthLoadError(`cannot read ground truth at ${path}: ${String(cause)}`);
  }
  const parsed = groundTruthFileSchema.safeParse(raw);
  if (!parsed.success) {
    throw new GroundTruthLoadError(
      `invalid ground truth file: ${parsed.error.issues
        .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
        .join('; ')}`,
    );
  }
  const ids = new Set(parsed.data.entries.map((entry) => entry.docId));
  if (ids.size !== parsed.data.entries.length) {
    throw new GroundTruthLoadError('ground truth contains duplicate docIds');
  }
  return parsed.data;
}

function toStoredDocument(entry: GroundTruthEntry): StoredDocument {
  return {
    docId: entry.docId,
    source: 'USPTO',
    docNumber: entry.docId.replace(/^US-/, '').replace(/-A1$/, ''),
    kindCode: 'A1',
    applicationNumber: `eval-${entry.docId}`,
    publicationDate: entry.publicationDate,
    title: entry.title,
    assignee: entry.assignee,
    cpcCodes: entry.cpcCodes,
    contentHash: `eval-hash-${entry.docId}`,
    rawKey: `eval/${entry.docId}`,
  };
}

export interface ScreeningEvalReport {
  readonly datasetSize: number;
  readonly inScopeCount: number;
  readonly surfacedCount: number;
  readonly truePositives: number;
  readonly falseNegatives: readonly string[];
  readonly falsePositives: readonly string[];
  readonly recall: number;
  readonly precision: number;
  readonly screeningTokensUsed: number;
}

/** Token budget for one full eval pass — eval-only, not a production budget. */
const EVAL_TOKEN_BUDGET = 200_000;

/** Runs the screening pipeline over the labeled set and scores it. */
export async function evaluateScreening(
  groundTruth: GroundTruthFile,
  watchlist: WatchlistConfig,
  classifier: RelevanceClassifier = new MockRelevanceClassifier(watchlist.claimSpaceTerms),
): Promise<ScreeningEvalReport> {
  const store = new MemoryStore();
  const docs = groundTruth.entries.map(toStoredDocument);
  const outcome = await screenDocuments(store, watchlist, docs, classifier, {
    limit: EVAL_TOKEN_BUDGET,
    used: 0,
  });
  if (outcome.results.length !== groundTruth.entries.length) {
    throw new Error(
      `screening logged ${outcome.results.length} of ${groundTruth.entries.length} documents — invariant 3 violated`,
    );
  }

  const surfacedIds = new Set(outcome.surfaced.map((doc) => doc.docId));
  const inScope = groundTruth.entries.filter((entry) => entry.label === 'in-scope');
  const outOfScope = groundTruth.entries.filter((entry) => entry.label === 'out-of-scope');

  const falseNegatives = inScope
    .filter((entry) => !surfacedIds.has(entry.docId))
    .map((entry) => entry.docId);
  const falsePositives = outOfScope
    .filter((entry) => surfacedIds.has(entry.docId))
    .map((entry) => entry.docId);
  const truePositives = inScope.length - falseNegatives.length;

  return {
    datasetSize: groundTruth.entries.length,
    inScopeCount: inScope.length,
    surfacedCount: surfacedIds.size,
    truePositives,
    falseNegatives,
    falsePositives,
    recall: truePositives / inScope.length,
    precision: truePositives / (truePositives + falsePositives.length),
    screeningTokensUsed: outcome.budget.used,
  };
}
