/**
 * Schema-shape tests via drizzle table metadata — no Postgres connection.
 * Guards the append-only invariants (AGENTS.md invariant 5) and the
 * idempotency keys that make ingestion re-runs no-ops (invariant 6).
 */
import { getTableConfig } from 'drizzle-orm/pg-core';
import { describe, expect, test } from 'vitest';
import { claimDiff, claimVersion, document, org, screeningResult, watchlist } from './schema';

function columnNames(table: Parameters<typeof getTableConfig>[0]): readonly string[] {
  return getTableConfig(table).columns.map((c) => c.name);
}

describe('append-only tables (invariant 5)', () => {
  test('document has no updated_at column — rows are immutable', () => {
    expect(columnNames(document)).not.toContain('updated_at');
  });

  test('claim_version has no updated_at column — history is append-only', () => {
    expect(columnNames(claimVersion)).not.toContain('updated_at');
  });

  test('claim_version is uniquely keyed by (family, claim, version_seq)', () => {
    const config = getTableConfig(claimVersion);
    const unique = config.indexes.find(
      (index) => index.config.name === 'claim_version_family_claim_seq_unique',
    );
    expect(unique).toBeDefined();
    expect(unique?.config.unique).toBe(true);
  });
});

describe('idempotency keys (invariant 6)', () => {
  test('document is unique on (source, doc_number, kind_code)', () => {
    const config = getTableConfig(document);
    const unique = config.indexes.find(
      (index) => index.config.name === 'document_source_number_kind_unique',
    );
    expect(unique?.config.unique).toBe(true);
  });

  test('document content_hash is unique — re-ingesting the same payload is a no-op', () => {
    const config = getTableConfig(document);
    const unique = config.indexes.find(
      (index) => index.config.name === 'document_content_hash_unique',
    );
    expect(unique?.config.unique).toBe(true);
  });
});

describe('deterministic/LLM separation (DESIGN.md decision log)', () => {
  test('claim_diff keeps hunks and llm_annotation as separate columns', () => {
    const names = columnNames(claimDiff);
    expect(names).toContain('hunks');
    expect(names).toContain('llm_annotation');
  });

  test('llm_annotation is nullable; deterministic hunks are required', () => {
    const config = getTableConfig(claimDiff);
    const byName = new Map(config.columns.map((c) => [c.name, c]));
    expect(byName.get('hunks')?.notNull).toBe(true);
    expect(byName.get('llm_annotation')?.notNull).toBe(false);
  });
});

describe('screening audit trail (invariant 3)', () => {
  test('screening_result stores verdict, decision, and matched_by for every row', () => {
    const names = columnNames(screeningResult);
    for (const required of ['verdict', 'decision', 'matched_by', 'embedding_score', 'rationale']) {
      expect(names).toContain(required);
    }
  });
});

describe('M0 base tables', () => {
  test('org and watchlist exist with their core columns', () => {
    expect(columnNames(org)).toEqual(expect.arrayContaining(['id', 'name', 'created_at']));
    expect(columnNames(watchlist)).toEqual(
      expect.arrayContaining(['id', 'org_id', 'cpc_prefixes', 'named_assignees', 'embedding']),
    );
  });
});
