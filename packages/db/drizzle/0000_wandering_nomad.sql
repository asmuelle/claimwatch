CREATE EXTENSION IF NOT EXISTS vector;--> statement-breakpoint
CREATE TABLE "claim_diff" (
	"id" serial PRIMARY KEY NOT NULL,
	"from_version_id" integer,
	"to_version_id" integer NOT NULL,
	"change" text NOT NULL,
	"hunks" jsonb NOT NULL,
	"llm_annotation" text,
	"computed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "claim_version" (
	"id" serial PRIMARY KEY NOT NULL,
	"family_id" text NOT NULL,
	"document_id" text NOT NULL,
	"claim_number" integer NOT NULL,
	"version_seq" integer NOT NULL,
	"text" text NOT NULL,
	"status" text NOT NULL,
	"depends_on" jsonb NOT NULL,
	"captured_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "document" (
	"id" text PRIMARY KEY NOT NULL,
	"source" text NOT NULL,
	"doc_number" text NOT NULL,
	"kind_code" text NOT NULL,
	"application_number" text NOT NULL,
	"publication_date" text NOT NULL,
	"title" text NOT NULL,
	"assignee" text NOT NULL,
	"cpc_codes" jsonb NOT NULL,
	"s3_key" text NOT NULL,
	"content_hash" text NOT NULL,
	"ingested_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "org" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "screening_result" (
	"id" serial PRIMARY KEY NOT NULL,
	"document_id" text NOT NULL,
	"watchlist_id" text NOT NULL,
	"embedding_score" real NOT NULL,
	"matched_by" jsonb NOT NULL,
	"verdict" text NOT NULL,
	"confidence" real NOT NULL,
	"rationale" text NOT NULL,
	"decision" text NOT NULL,
	"model" text NOT NULL,
	"prompt_version" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "watchlist" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"name" text NOT NULL,
	"claim_space_description" text NOT NULL,
	"cpc_prefixes" jsonb NOT NULL,
	"named_assignees" jsonb NOT NULL,
	"jurisdictions" jsonb NOT NULL,
	"embedding" vector(1024),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "claim_diff" ADD CONSTRAINT "claim_diff_from_version_id_claim_version_id_fk" FOREIGN KEY ("from_version_id") REFERENCES "public"."claim_version"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "claim_diff" ADD CONSTRAINT "claim_diff_to_version_id_claim_version_id_fk" FOREIGN KEY ("to_version_id") REFERENCES "public"."claim_version"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "claim_version" ADD CONSTRAINT "claim_version_document_id_document_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."document"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "screening_result" ADD CONSTRAINT "screening_result_document_id_document_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."document"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "screening_result" ADD CONSTRAINT "screening_result_watchlist_id_watchlist_id_fk" FOREIGN KEY ("watchlist_id") REFERENCES "public"."watchlist"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "watchlist" ADD CONSTRAINT "watchlist_org_id_org_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."org"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "claim_version_family_claim_seq_unique" ON "claim_version" USING btree ("family_id","claim_number","version_seq");--> statement-breakpoint
CREATE UNIQUE INDEX "document_source_number_kind_unique" ON "document" USING btree ("source","doc_number","kind_code");--> statement-breakpoint
CREATE UNIQUE INDEX "document_content_hash_unique" ON "document" USING btree ("content_hash");