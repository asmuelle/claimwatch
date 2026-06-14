/**
 * Drizzle schema — Postgres 16 + pgvector.
 *
 * PRODUCT INVARIANT 5: `document` and `claim_version` are append-only.
 * There is deliberately NO updated_at column on either table and no update
 * helper exported from this package; ingestion either inserts a new row or
 * is a no-op (content-hash keyed).
 */
import {
  boolean,
  doublePrecision,
  integer,
  jsonb,
  pgTable,
  serial,
  text,
  timestamp,
  uniqueIndex,
  vector,
} from 'drizzle-orm/pg-core';

/** Workspace owning watchlists and briefs. */
export const org = pgTable('org', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

/** The only true user-accumulated state (DESIGN.md data model). */
export const watchlist = pgTable('watchlist', {
  id: text('id').primaryKey(),
  orgId: text('org_id')
    .notNull()
    .references(() => org.id),
  name: text('name').notNull(),
  claimSpaceDescription: text('claim_space_description').notNull(),
  cpcPrefixes: jsonb('cpc_prefixes').$type<readonly string[]>().notNull(),
  namedAssignees: jsonb('named_assignees').$type<readonly string[]>().notNull(),
  jurisdictions: jsonb('jurisdictions').$type<readonly string[]>().notNull(),
  /** voyage-3 claim-space embedding (nullable until first embed run). */
  embedding: vector('embedding', { dimensions: 1024 }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

/**
 * Billing state per org (M3). Mutable by design — subscription lifecycle is
 * driven by the pure state machine in @claimwatch/core (billing/subscription)
 * and persisted here as a single row per org. This is billing state, NOT
 * claim history: the append-only invariant does not apply.
 */
export const subscription = pgTable('subscription', {
  orgId: text('org_id')
    .primaryKey()
    .references(() => org.id),
  planId: text('plan_id', { enum: ['startup', 'pro', 'firm'] }).notNull(),
  billingCycle: text('billing_cycle', { enum: ['monthly', 'annual'] }).notNull(),
  status: text('status', { enum: ['active', 'grace', 'lapsed', 'canceled'] }).notNull(),
  currentPeriodEnd: timestamp('current_period_end', { withTimezone: true }).notNull(),
  graceUntil: timestamp('grace_until', { withTimezone: true }),
  pendingPlanId: text('pending_plan_id', { enum: ['startup', 'pro', 'firm'] }),
  cancelAtPeriodEnd: boolean('cancel_at_period_end').notNull().default(false),
  provider: text('provider', { enum: ['mock', 'stripe'] }).notNull(),
  providerRef: text('provider_ref'),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

/** Canonical publication unit. Immutable — append-only, content-hash keyed. */
export const document = pgTable(
  'document',
  {
    /** Internal id, e.g. "US-12790314-B2". */
    id: text('id').primaryKey(),
    // TS-level enum only (plain text column in DDL — no migration on widen).
    // 'CourtListener' added in M4 for litigation dockets in the document model.
    source: text('source', { enum: ['USPTO', 'EPO', 'CourtListener'] }).notNull(),
    docNumber: text('doc_number').notNull(),
    kindCode: text('kind_code').notNull(),
    applicationNumber: text('application_number').notNull(),
    publicationDate: text('publication_date').notNull(),
    title: text('title').notNull(),
    assignee: text('assignee').notNull(),
    cpcCodes: jsonb('cpc_codes').$type<readonly string[]>().notNull(),
    /** S3 key of the immutable raw XML/PDF. */
    s3Key: text('s3_key').notNull(),
    /** sha-256 of the raw payload — the idempotency key for re-runs. */
    contentHash: text('content_hash').notNull(),
    ingestedAt: timestamp('ingested_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('document_source_number_kind_unique').on(
      table.source,
      table.docNumber,
      table.kindCode,
    ),
    uniqueIndex('document_content_hash_unique').on(table.contentHash),
  ],
);

/** Append-only longitudinal core: one row per claim per document capture. */
export const claimVersion = pgTable(
  'claim_version',
  {
    id: serial('id').primaryKey(),
    /** Family key — US application serial number in the M1 slice. */
    familyId: text('family_id').notNull(),
    documentId: text('document_id')
      .notNull()
      .references(() => document.id),
    claimNumber: integer('claim_number').notNull(),
    versionSeq: integer('version_seq').notNull(),
    text: text('text').notNull(),
    status: text('status', { enum: ['active', 'cancelled'] }).notNull(),
    dependsOn: jsonb('depends_on').$type<readonly number[]>().notNull(),
    capturedAt: timestamp('captured_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('claim_version_family_claim_seq_unique').on(
      table.familyId,
      table.claimNumber,
      table.versionSeq,
    ),
  ],
);

/** Deterministic word-level diff between consecutive claim versions. */
export const claimDiff = pgTable('claim_diff', {
  id: serial('id').primaryKey(),
  fromVersionId: integer('from_version_id').references(() => claimVersion.id),
  toVersionId: integer('to_version_id')
    .notNull()
    .references(() => claimVersion.id),
  /** Structural heuristic tag (narrowed/broadened/cancelled/added/...). */
  change: text('change').notNull(),
  /** Deterministic word-level hunks (JSON), pure function of the two texts. */
  hunks: jsonb('hunks')
    // Structurally identical to DiffHunk in @claimwatch/core (kept local so
    // the schema package has zero workspace dependencies).
    .$type<readonly { readonly op: 'equal' | 'delete' | 'insert'; readonly text: string }[]>()
    .notNull(),
  /**
   * SEPARATE nullable LLM annotation — never merged with the deterministic
   * fields above (DESIGN.md decision log).
   */
  llmAnnotation: text('llm_annotation'),
  computedAt: timestamp('computed_at', { withTimezone: true }).notNull().defaultNow(),
});

/** Audit trail for recall claims: every screened doc keeps a logged row. */
export const screeningResult = pgTable('screening_result', {
  id: serial('id').primaryKey(),
  documentId: text('document_id')
    .notNull()
    .references(() => document.id),
  watchlistId: text('watchlist_id')
    .notNull()
    .references(() => watchlist.id),
  // double precision (not float4): scores round-trip bit-exactly from JS,
  // which the byte-identical re-run guarantee depends on.
  embeddingScore: doublePrecision('embedding_score').notNull(),
  matchedBy: jsonb('matched_by').$type<readonly string[]>().notNull(),
  verdict: text('verdict', { enum: ['in-scope', 'adjacent', 'out-of-scope'] }).notNull(),
  confidence: doublePrecision('confidence').notNull(),
  rationale: text('rationale').notNull(),
  decision: text('decision', { enum: ['surface', 'downrank'] }).notNull(),
  model: text('model').notNull(),
  promptVersion: text('prompt_version').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});
