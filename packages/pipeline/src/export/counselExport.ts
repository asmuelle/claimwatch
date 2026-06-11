/**
 * Counsel-ready brief export (M3): the validated weekly brief packaged as a
 * print-grade artifact. Pro+ feature; the white-label variant (firm branding,
 * no ClaimWatch marks) is Firm-only.
 *
 * Trust rules, enforced here and tested:
 * - An unvalidated brief (validatedAt === null) can NEVER be exported — same
 *   hard gate as sending (invariant 2).
 * - Exported prose carries ONLY validated, citation-pinned sentences: a kept
 *   sentence whose citations are not all span-pinned is omitted and counted,
 *   never paraphrased.
 * - White-label output carries zero ClaimWatch branding but always keeps the
 *   counsel disclaimer and coverage disclosure (invariant 4).
 */
import type {
  Brief,
  BriefItemFact,
  CoverageDisclosure,
  PlanFeature,
  PlanId,
} from '@claimwatch/core';
import { PLANS, PLAN_ORDER, counselDisclaimerFor, hasFeature } from '@claimwatch/core';
import type { PinnedCitation } from '../synth/synthesizeBrief';

export type ExportVariant = 'counsel' | 'white-label';

const FEATURE_FOR_VARIANT: Readonly<Record<ExportVariant, PlanFeature>> = {
  counsel: 'counsel-export',
  'white-label': 'white-label-briefs',
};

export class ExportNotEntitledError extends Error {
  constructor(
    readonly plan: PlanId,
    readonly variant: ExportVariant,
    readonly requiredFeature: PlanFeature,
    readonly suggestedPlan: PlanId | null,
  ) {
    super(
      `plan ${plan} does not include ${requiredFeature} — ` +
        (suggestedPlan ? `upgrade to ${suggestedPlan}` : 'no plan offers this'),
    );
    this.name = 'ExportNotEntitledError';
  }
}

export class ExportBlockedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ExportBlockedError';
  }
}

/** Cheapest tier carrying a feature, for the upgrade prompt. */
export function cheapestPlanWith(feature: PlanFeature): PlanId | null {
  for (const planId of PLAN_ORDER) {
    if (PLANS[planId].features.includes(feature)) return planId;
  }
  return null;
}

/** Throws ExportNotEntitledError unless the plan carries the variant's feature. */
export function assertExportEntitled(plan: PlanId, variant: ExportVariant): void {
  const required = FEATURE_FOR_VARIANT[variant];
  if (!hasFeature(plan, required)) {
    throw new ExportNotEntitledError(plan, variant, required, cheapestPlanWith(required));
  }
}

export interface ExportSentence {
  readonly text: string;
  readonly citations: readonly PinnedCitation[];
}

export interface ExportItem {
  readonly fact: BriefItemFact;
  readonly sentences: readonly ExportSentence[];
}

export interface CounselExport {
  readonly brand: string;
  readonly whiteLabel: boolean;
  readonly watchlistName: string;
  readonly weekOf: string;
  readonly validatedAt: string;
  readonly items: readonly ExportItem[];
  readonly coverage: CoverageDisclosure;
  readonly disclaimer: string;
  /** Kept sentences omitted from the export for missing citation pins. */
  readonly omittedSentenceCount: number;
}

export interface CounselExportOptions {
  readonly plan: PlanId;
  readonly variant: ExportVariant;
  /** Required for the white-label variant; replaces all product branding. */
  readonly firmName?: string;
}

const PRODUCT_BRAND = 'ClaimWatch';

function pinsFor(
  sentenceText: string,
  pinnedCitations: readonly PinnedCitation[],
): readonly PinnedCitation[] {
  return pinnedCitations.filter((pin) => pin.sentenceText === sentenceText && pin.start >= 0);
}

/** Builds the export model. Pure function of the brief + pinned citations. */
export function buildCounselExport(
  brief: Brief,
  pinnedCitations: readonly PinnedCitation[],
  options: CounselExportOptions,
): CounselExport {
  assertExportEntitled(options.plan, options.variant);

  const whiteLabel = options.variant === 'white-label';
  const firmName = options.firmName?.trim() ?? '';
  if (whiteLabel && firmName === '') {
    throw new ExportBlockedError('white-label export requires a firm name');
  }
  if (brief.validatedAt === null) {
    throw new ExportBlockedError(
      'brief failed citation validation (validatedAt is null) — export is gated exactly like sending',
    );
  }

  let omitted = 0;
  const items: ExportItem[] = brief.items.map((item) => {
    const sentences: ExportSentence[] = [];
    for (const validation of item.sentences) {
      if (!validation.kept) continue; // dropped by cite-or-omit; never exported
      const pins = pinsFor(validation.sentence.text, pinnedCitations);
      if (pins.length === 0 || pins.length < validation.citations.length) {
        omitted += 1; // omit, never paraphrase
        continue;
      }
      sentences.push({ text: validation.sentence.text, citations: pins });
    }
    return { fact: item.fact, sentences };
  });

  const brand = whiteLabel ? firmName : PRODUCT_BRAND;
  const result: CounselExport = {
    brand,
    whiteLabel,
    watchlistName: brief.watchlistName,
    weekOf: brief.weekOf,
    validatedAt: brief.validatedAt,
    items,
    coverage: brief.coverage,
    disclaimer: counselDisclaimerFor(brand),
    omittedSentenceCount: omitted,
  };

  if (whiteLabel && JSON.stringify(result).toLowerCase().includes(PRODUCT_BRAND.toLowerCase())) {
    // Loud failure beats a brand leak in a firm's client deliverable.
    throw new ExportBlockedError('white-label export would leak product branding');
  }
  return result;
}
