/**
 * Plain-text blackline rendering of deterministic diff hunks, used for the
 * always-safe fact headline (DESIGN.md flow 3.3 fallback rendering).
 * Convention: deletions in [-…-], insertions in {+…+}.
 */
import type { DiffHunk } from '@claimwatch/core';

export function renderBlacklineText(hunks: readonly DiffHunk[]): string {
  return hunks
    .map((hunk) => {
      if (hunk.op === 'delete') return `[-${hunk.text}-]`;
      if (hunk.op === 'insert') return `{+${hunk.text}+}`;
      return hunk.text;
    })
    .join(' ');
}
