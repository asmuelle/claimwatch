import type { DiffHunk } from '@claimwatch/core';

/** Renders deterministic diff hunks as a legal blackline (del/ins semantics). */
export function Blackline({ hunks }: { readonly hunks: readonly DiffHunk[] }) {
  return (
    <p className="blackline">
      {hunks.map((hunk, index) => {
        const spacer = index > 0 ? ' ' : '';
        if (hunk.op === 'delete') {
          return (
            <del key={index}>
              {spacer}
              {hunk.text}
            </del>
          );
        }
        if (hunk.op === 'insert') {
          return (
            <ins key={index}>
              {spacer}
              {hunk.text}
            </ins>
          );
        }
        return (
          <span key={index}>
            {spacer}
            {hunk.text}
          </span>
        );
      })}
    </p>
  );
}
