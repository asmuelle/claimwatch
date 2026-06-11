/** Claim text normalization. Pure functions, no IO. */
import type { ClaimStatus } from './types';

/** Collapses whitespace runs and trims. The only normalization applied to canonical text. */
export function normalizeClaimText(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

const LEADING_NUMBER_RE = /^(\d+)\s*\.\s*/;
const CANCELLED_RE = /^\(\s*cancell?ed\s*\)\.?$/i;

export interface ClaimBody {
  readonly text: string;
  readonly status: ClaimStatus;
}

/**
 * Strips the published "N." prefix and detects cancelled claims
 * (published as e.g. "2. (canceled)").
 */
export function parseClaimBody(normalized: string): ClaimBody {
  const withoutNumber = normalized.replace(LEADING_NUMBER_RE, '');
  if (CANCELLED_RE.test(withoutNumber)) {
    return { text: withoutNumber, status: 'cancelled' };
  }
  return { text: withoutNumber, status: 'active' };
}
