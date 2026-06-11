/**
 * Deterministic structural classification of a claim diff.
 *
 * These are HEURISTIC tags computed from canonical text only. Any LLM
 * interpretation of what a change *means* lives in a separate annotation
 * field and never overwrites these tags (DESIGN.md decision log).
 */
import type { ParsedClaim } from '../claims/types';
import type { DiffHunk } from './diffWords';
import { countDiffTokens, diffClaimTexts } from './diffWords';

export type StructuralChange =
  | 'added'
  | 'cancelled'
  | 'dependency-rewritten'
  | 'narrowed'
  | 'broadened'
  | 'amended'
  | 'unchanged';

export interface ClaimChange {
  readonly claimNumber: number;
  readonly change: StructuralChange;
  readonly hunks: readonly DiffHunk[];
}

function sameDependencies(a: readonly number[], b: readonly number[]): boolean {
  if (a.length !== b.length) return false;
  const sortedA = [...a].sort((x, y) => x - y);
  const sortedB = [...b].sort((x, y) => x - y);
  return sortedA.every((value, index) => value === sortedB[index]);
}

function classifyAmendment(hunks: readonly DiffHunk[]): StructuralChange {
  const { inserted, deleted } = countDiffTokens(hunks);
  if (inserted > 0 && deleted === 0) return 'narrowed';
  if (deleted > 0 && inserted === 0) return 'broadened';
  if (inserted > deleted) return 'narrowed';
  if (deleted > inserted) return 'broadened';
  return 'amended';
}

/**
 * Classifies the change between two versions of one claim.
 * Precedence: added > cancelled > dependency-rewritten > narrowed/broadened/amended.
 */
export function classifyClaimDiff(input: {
  readonly fromClaim?: ParsedClaim;
  readonly toClaim: ParsedClaim;
}): ClaimChange {
  const { fromClaim, toClaim } = input;
  if (!fromClaim) {
    return {
      claimNumber: toClaim.number,
      change: 'added',
      hunks: [{ op: 'insert', text: toClaim.text }],
    };
  }
  if (toClaim.status === 'cancelled' && fromClaim.status === 'active') {
    return {
      claimNumber: toClaim.number,
      change: 'cancelled',
      hunks: [{ op: 'delete', text: fromClaim.text }],
    };
  }
  const hunks = diffClaimTexts(fromClaim.text, toClaim.text);
  if (fromClaim.text === toClaim.text) {
    return { claimNumber: toClaim.number, change: 'unchanged', hunks };
  }
  if (!sameDependencies(fromClaim.dependsOn, toClaim.dependsOn)) {
    return { claimNumber: toClaim.number, change: 'dependency-rewritten', hunks };
  }
  return { claimNumber: toClaim.number, change: classifyAmendment(hunks), hunks };
}
