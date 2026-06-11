/** Watchlist definition + the hardcoded M1 pilot watchlist (DESIGN.md M1). */

export interface WatchlistConfig {
  readonly name: string;
  readonly claimSpaceDescription: string;
  /** Terms standing in for the voyage-3 claim-space embedding in the slice. */
  readonly claimSpaceTerms: readonly string[];
  readonly cpcPrefixes: readonly string[];
  /** Named competitors always surface — they bypass screening (invariant 3). */
  readonly namedAssignees: readonly string[];
  readonly jurisdictionsWatched: readonly string[];
  readonly jurisdictionsNotWatched: readonly string[];
  /** Weekly model-token budgets, enforced in code (invariant 7). */
  readonly screeningTokenBudget: number;
  readonly synthesisTokenBudget: number;
}

/** The single hardcoded M1 watchlist: efficient neural-network inference. */
export const M1_WATCHLIST: WatchlistConfig = {
  name: 'Efficient neural inference (pilot)',
  claimSpaceDescription:
    'Efficient neural network inference: mixture-of-experts routing, transformer ' +
    'attention and key-value cache compression, quantization, continual learning ' +
    'for embedded and machine learning systems.',
  claimSpaceTerms: [
    'neural network',
    'inference',
    'transformer',
    'attention',
    'cache',
    'quantiz',
    'mixture-of-experts',
    'continual learning',
    'machine learning',
  ],
  cpcPrefixes: ['G06N'],
  namedAssignees: ['Vektor Cognition, Inc.'],
  jurisdictionsWatched: ['USPTO (US grants Tue / pre-grant publications Thu)'],
  jurisdictionsNotWatched: ['EPO', 'WIPO/PCT', 'CNIPA', 'JPO'],
  screeningTokenBudget: 4_000,
  synthesisTokenBudget: 4_000,
};
