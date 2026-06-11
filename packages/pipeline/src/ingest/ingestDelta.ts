/**
 * Ingestion step: raw XML -> document row -> claim_versions -> deterministic
 * claim_diffs. Pure orchestration over packages/core; no LLM anywhere
 * (invariant 1). Content-hash keyed so re-runs are no-ops (invariant 6).
 */
import { createHash } from 'node:crypto';
import { classifyClaimDiff, parseUsptoXml } from '@claimwatch/core';
import type { ParsedClaim, ParsedDocument } from '@claimwatch/core';
import type { ClaimVersionRow, SliceStore } from '../store/types';
import type { LoadedDelta } from './loadDelta';

export interface IngestCounts {
  readonly deltaId: string;
  readonly filesSeen: number;
  readonly documentsAdded: number;
  readonly documentsSkipped: number;
  readonly claimVersionsAdded: number;
  readonly claimDiffsComputed: number;
}

function sha256(payload: string): string {
  return createHash('sha256').update(payload, 'utf8').digest('hex');
}

function toParsedClaim(row: ClaimVersionRow): ParsedClaim {
  return {
    number: row.claimNumber,
    text: row.text,
    status: row.status,
    dependsOn: row.dependsOn,
  };
}

async function appendVersionsAndDiffs(
  store: SliceStore,
  doc: ParsedDocument,
): Promise<{ readonly versions: number; readonly diffs: number }> {
  const familyId = doc.applicationNumber;
  const previousByClaim = new Map(
    (await store.latestClaimVersions(familyId)).map((row) => [row.claimNumber, row]),
  );
  let versions = 0;
  let diffs = 0;
  for (const claim of doc.claims) {
    const previous = previousByClaim.get(claim.number);
    const inserted = await store.appendClaimVersion({
      familyId,
      docId: doc.docId,
      claimNumber: claim.number,
      versionSeq: (previous?.versionSeq ?? 0) + 1,
      text: claim.text,
      status: claim.status,
      dependsOn: claim.dependsOn,
    });
    versions += 1;
    const change = classifyClaimDiff({
      fromClaim: previous ? toParsedClaim(previous) : undefined,
      toClaim: claim,
    });
    if (change.change === 'unchanged') continue;
    await store.appendClaimDiff({
      familyId,
      fromVersionId: previous?.id ?? null,
      toVersionId: inserted.id,
      claimNumber: claim.number,
      change: change.change,
      hunks: change.hunks,
      llmAnnotation: null,
    });
    diffs += 1;
  }
  return { versions, diffs };
}

/**
 * Ingests one delta into the store. Documents whose content hash is already
 * recorded are skipped wholesale — re-running a delta adds zero rows.
 */
export async function ingestDelta(store: SliceStore, delta: LoadedDelta): Promise<IngestCounts> {
  let documentsAdded = 0;
  let documentsSkipped = 0;
  let claimVersionsAdded = 0;
  let claimDiffsComputed = 0;
  for (const file of delta.files) {
    const contentHash = sha256(file.xml);
    if (await store.hasContentHash(contentHash)) {
      documentsSkipped += 1;
      continue;
    }
    const parsed = parseUsptoXml(file.xml);
    await store.appendDocument({
      docId: parsed.docId,
      source: parsed.source,
      docNumber: parsed.docNumber,
      kindCode: parsed.kindCode,
      applicationNumber: parsed.applicationNumber,
      publicationDate: parsed.publicationDate,
      title: parsed.title,
      assignee: parsed.assignee,
      cpcCodes: parsed.cpcCodes,
      contentHash,
      rawKey: `uspto/${parsed.docId}/${delta.manifest.published}/${file.path}`,
    });
    documentsAdded += 1;
    const { versions, diffs } = await appendVersionsAndDiffs(store, parsed);
    claimVersionsAdded += versions;
    claimDiffsComputed += diffs;
  }
  return {
    deltaId: delta.manifest.deltaId,
    filesSeen: delta.files.length,
    documentsAdded,
    documentsSkipped,
    claimVersionsAdded,
    claimDiffsComputed,
  };
}
