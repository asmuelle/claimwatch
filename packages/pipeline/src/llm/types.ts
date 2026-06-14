/**
 * Model integration boundary. ALL platform-model calls go through these
 * interfaces; the M1 slice and every test run against deterministic mocks —
 * no API key, no network, byte-identical output across runs.
 */
import type { SynthesizedSentence } from '@claimwatch/core';
import type { BriefItemFact } from '@claimwatch/core';
import type { StoredDocument } from '../store/types';

export interface ClassifierVerdict {
  readonly verdict: 'in-scope' | 'adjacent' | 'out-of-scope';
  readonly confidence: number;
  readonly rationale: string;
  readonly tokensUsed: number;
  readonly model: string;
  readonly promptVersion: string;
}

/**
 * Sync-or-async return (M4): the deterministic mocks stay synchronous; the
 * real Anthropic adapter returns promises. Callers always `await`, so the
 * downstream gates (citation validator, send-gate) run identically for both.
 */
export type MaybePromise<T> = T | Promise<T>;

/** Haiku-class relevance screening (cost ladder layer 2). */
export interface RelevanceClassifier {
  classify(doc: StoredDocument, claimSpaceDescription: string): MaybePromise<ClassifierVerdict>;
}

export interface SynthesisDraft {
  readonly sentences: readonly SynthesizedSentence[];
  readonly tokensUsed: number;
}

/** Sonnet-class brief synthesis (cost ladder layer 3). */
export interface BriefSynthesizer {
  draftSentences(fact: BriefItemFact): MaybePromise<SynthesisDraft>;
}

/** Per-watchlist weekly token budget (invariant 7: enforced in code). */
export interface TokenBudget {
  readonly limit: number;
  readonly used: number;
}

export class BudgetExceededError extends Error {
  constructor(
    readonly stage: 'screening' | 'synthesis',
    readonly budget: TokenBudget,
  ) {
    super(
      `${stage} token budget exceeded: ${budget.used} used of ${budget.limit} — halting step (alert, not overrun)`,
    );
    this.name = 'BudgetExceededError';
  }
}

/** Returns a new budget with usage added, or throws when the cap is crossed. */
export function spendTokens(
  budget: TokenBudget,
  tokens: number,
  stage: 'screening' | 'synthesis',
): TokenBudget {
  const next = { limit: budget.limit, used: budget.used + tokens };
  if (next.used > next.limit) {
    throw new BudgetExceededError(stage, next);
  }
  return next;
}
