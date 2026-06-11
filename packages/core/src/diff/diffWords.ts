/**
 * Deterministic word-level diff engine (LCS over whitespace tokens).
 *
 * PRODUCT INVARIANT 1: claim diffs are a pure function of the two claim texts —
 * byte-identical across runs, no LLM anywhere. This module has zero IO and
 * zero nondeterminism.
 */

export type DiffOp = 'equal' | 'delete' | 'insert';

export interface DiffHunk {
  readonly op: DiffOp;
  readonly text: string;
}

function tokenize(text: string): readonly string[] {
  const trimmed = text.trim();
  return trimmed.length === 0 ? [] : trimmed.split(/\s+/);
}

/** Builds the LCS length table for two token arrays. */
function lcsTable(a: readonly string[], b: readonly string[]): Int32Array {
  const cols = b.length + 1;
  const table = new Int32Array((a.length + 1) * cols);
  for (let i = a.length - 1; i >= 0; i -= 1) {
    for (let j = b.length - 1; j >= 0; j -= 1) {
      table[i * cols + j] =
        a[i] === b[j]
          ? (table[(i + 1) * cols + j + 1] ?? 0) + 1
          : Math.max(table[(i + 1) * cols + j] ?? 0, table[i * cols + j + 1] ?? 0);
    }
  }
  return table;
}

interface TokenOp {
  readonly op: DiffOp;
  readonly token: string;
}

/** Backtracks the LCS table into per-token ops. Deletes are emitted before inserts. */
function backtrack(a: readonly string[], b: readonly string[], table: Int32Array): TokenOp[] {
  const cols = b.length + 1;
  const ops: TokenOp[] = [];
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    const ai = a[i];
    const bj = b[j];
    if (ai !== undefined && ai === bj) {
      ops.push({ op: 'equal', token: ai });
      i += 1;
      j += 1;
    } else if ((table[(i + 1) * cols + j] ?? 0) >= (table[i * cols + j + 1] ?? 0)) {
      if (ai !== undefined) ops.push({ op: 'delete', token: ai });
      i += 1;
    } else {
      if (bj !== undefined) ops.push({ op: 'insert', token: bj });
      j += 1;
    }
  }
  for (; i < a.length; i += 1) {
    const ai = a[i];
    if (ai !== undefined) ops.push({ op: 'delete', token: ai });
  }
  for (; j < b.length; j += 1) {
    const bj = b[j];
    if (bj !== undefined) ops.push({ op: 'insert', token: bj });
  }
  return ops;
}

/** Merges consecutive same-op tokens into hunks; within a replacement, deletes precede inserts. */
function mergeOps(ops: readonly TokenOp[]): readonly DiffHunk[] {
  const hunks: DiffHunk[] = [];
  let current: { op: DiffOp; tokens: string[] } | null = null;
  const flush = (): void => {
    if (current) hunks.push({ op: current.op, text: current.tokens.join(' ') });
    current = null;
  };
  for (const tokenOp of ops) {
    if (current && current.op === tokenOp.op) {
      current.tokens.push(tokenOp.token);
    } else {
      flush();
      current = { op: tokenOp.op, tokens: [tokenOp.token] };
    }
  }
  flush();
  return hunks;
}

/** Reorders insert-then-delete adjacencies to the blackline convention: delete first. */
function normalizeOrder(hunks: readonly DiffHunk[]): readonly DiffHunk[] {
  const out = [...hunks];
  for (let k = 0; k + 1 < out.length; k += 1) {
    const a = out[k];
    const b = out[k + 1];
    if (a !== undefined && b !== undefined && a.op === 'insert' && b.op === 'delete') {
      out[k] = b;
      out[k + 1] = a;
    }
  }
  return out;
}

/**
 * Computes the word-level blackline between two claim texts.
 * Pure function; the same inputs always produce the same hunks.
 */
export function diffClaimTexts(fromText: string, toText: string): readonly DiffHunk[] {
  const a = tokenize(fromText);
  const b = tokenize(toText);
  if (a.length === 0 && b.length === 0) return [];
  if (a.join(' ') === b.join(' ')) return [{ op: 'equal', text: a.join(' ') }];
  return normalizeOrder(mergeOps(backtrack(a, b, lcsTable(a, b))));
}

/** Counts inserted and deleted tokens in a hunk list. */
export function countDiffTokens(hunks: readonly DiffHunk[]): {
  readonly inserted: number;
  readonly deleted: number;
} {
  let inserted = 0;
  let deleted = 0;
  for (const hunk of hunks) {
    const n = hunk.text.length === 0 ? 0 : hunk.text.split(/\s+/).length;
    if (hunk.op === 'insert') inserted += n;
    if (hunk.op === 'delete') deleted += n;
  }
  return { inserted, deleted };
}
