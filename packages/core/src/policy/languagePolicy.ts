/**
 * Observation-not-opinion language policy (product invariant 4).
 *
 * ClaimWatch reports research observations, never freedom-to-operate or
 * infringement opinions. Synthesized output containing a banned phrase
 * fails brief assembly.
 */

export const BANNED_PHRASES: readonly string[] = [
  'freedom to operate',
  'freedom-to-operate',
  'non-infringement',
  'noninfringement',
  'you may practice',
  'you may not practice',
  'infringement risk',
  'clear to launch',
  'legal opinion',
];

/** Standalone "FTO" acronym (word-bounded, case-sensitive uppercase use). */
const FTO_RE = /\bFTO\b/;

export interface PolicyViolation {
  readonly phrase: string;
  readonly index: number;
}

/** Scans text for banned legal-advice phrasing. Deterministic, case-insensitive. */
export function scanBannedPhrases(text: string): readonly PolicyViolation[] {
  const lower = text.toLowerCase();
  const violations: PolicyViolation[] = [];
  for (const phrase of BANNED_PHRASES) {
    let from = 0;
    let index = lower.indexOf(phrase, from);
    while (index !== -1) {
      violations.push({ phrase, index });
      from = index + phrase.length;
      index = lower.indexOf(phrase, from);
    }
  }
  const ftoMatch = FTO_RE.exec(text);
  if (ftoMatch) violations.push({ phrase: 'FTO', index: ftoMatch.index });
  return violations.sort((a, b) => a.index - b.index);
}

/** Counsel disclaimer carried on every brief surface (web, email, PDF). */
export const COUNSEL_DISCLAIMER =
  'ClaimWatch reports research observations from public patent records. ' +
  'It is not legal advice and is no substitute for review by qualified patent counsel.';
