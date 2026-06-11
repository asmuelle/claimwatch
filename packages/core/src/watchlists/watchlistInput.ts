/**
 * Watchlist input validation (boundary schema, zod). The web form, server
 * actions, and the pipeline manager all validate through this one schema —
 * user input is never trusted past this point.
 */
import { z } from 'zod';

/**
 * CPC symbol prefix: section letter, 2-digit class, optional subclass letter,
 * optional group digits with an optional /subgroup (e.g. G06N, G06N3, H04L9/40).
 */
const CPC_PREFIX_RE = /^[A-HY]\d{2}(?:[A-Z](?:\d{1,4}(?:\/\d{2,6})?)?)?$/;

const MAX_LIST_ENTRIES = 100; // sanity cap; plan limits are enforced separately

export const watchlistInputSchema = z.object({
  name: z
    .string()
    .trim()
    .min(3, 'name must be at least 3 characters')
    .max(120, 'name must be at most 120 characters'),
  claimSpaceDescription: z
    .string()
    .trim()
    .min(20, 'describe the claim space in at least 20 characters — it seeds screening')
    .max(2000, 'claim-space description must be at most 2000 characters'),
  cpcPrefixes: z
    .array(
      z
        .string()
        .trim()
        .toUpperCase()
        .regex(CPC_PREFIX_RE, 'not a CPC symbol prefix (e.g. G06N or H04L9/40)'),
    )
    .min(1, 'at least one CPC class is required')
    .max(MAX_LIST_ENTRIES),
  competitors: z
    .array(z.string().trim().min(2, 'competitor names need at least 2 characters').max(160))
    .max(MAX_LIST_ENTRIES),
});

export type WatchlistInput = z.infer<typeof watchlistInputSchema>;

export interface WatchlistInputIssue {
  readonly path: string;
  readonly message: string;
}

export type WatchlistInputResult =
  | { readonly ok: true; readonly value: WatchlistInput }
  | { readonly ok: false; readonly issues: readonly WatchlistInputIssue[] };

/** Safe-parse wrapper returning UI-renderable issues (never throws). */
export function parseWatchlistInput(raw: unknown): WatchlistInputResult {
  const parsed = watchlistInputSchema.safeParse(raw);
  if (parsed.success) {
    return { ok: true, value: parsed.data };
  }
  return {
    ok: false,
    issues: parsed.error.issues.map((issue) => ({
      path: issue.path.join('.') || '(root)',
      message: issue.message,
    })),
  };
}

function splitOn(raw: string, separator: RegExp): readonly string[] {
  const entries = raw
    .split(separator)
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
  return [...new Set(entries)];
}

/** Splits a symbol list (CPC classes) on newlines, commas and semicolons. */
export function splitListField(raw: string): readonly string[] {
  return splitOn(raw, /[\n,;]+/);
}

/**
 * Splits a name list on newlines/semicolons ONLY — legal entity names
 * contain commas ("Vektor Cognition, Inc.") and must survive intact.
 */
export function splitNameListField(raw: string): readonly string[] {
  return splitOn(raw, /[\n;]+/);
}
