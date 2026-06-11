-- Append-only enforcement at the DATABASE level (product invariant 5).
-- The application layer already exposes no update/delete path; these triggers
-- make the guarantee hold even for direct SQL, future code, and migrations.
-- TRUNCATE is deliberately NOT blocked: row-level triggers do not fire on it,
-- which keeps test-database resets possible without weakening row immutability.
CREATE FUNCTION claimwatch_append_only_guard() RETURNS trigger
LANGUAGE plpgsql AS $append_only$
BEGIN
  RAISE EXCEPTION 'append-only violation: % on table % is not allowed (claim history is immutable)',
    TG_OP, TG_TABLE_NAME;
END;
$append_only$;
--> statement-breakpoint
CREATE TRIGGER document_append_only
  BEFORE UPDATE OR DELETE ON "document"
  FOR EACH ROW EXECUTE FUNCTION claimwatch_append_only_guard();
--> statement-breakpoint
CREATE TRIGGER claim_version_append_only
  BEFORE UPDATE OR DELETE ON "claim_version"
  FOR EACH ROW EXECUTE FUNCTION claimwatch_append_only_guard();
--> statement-breakpoint
CREATE TRIGGER claim_diff_append_only
  BEFORE UPDATE OR DELETE ON "claim_diff"
  FOR EACH ROW EXECUTE FUNCTION claimwatch_append_only_guard();
