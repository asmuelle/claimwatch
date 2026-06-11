/**
 * Postgres client factory + programmatic migration runner.
 *
 * The only IO entry point of this package: everything else is schema. Tests
 * and the pipeline construct a client from $DATABASE_URL; nothing in this
 * package reads env vars itself (validated at startup by the caller).
 */
import { fileURLToPath } from 'node:url';
import { drizzle } from 'drizzle-orm/postgres-js';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';
import * as schema from './schema';

export type Db = PostgresJsDatabase<typeof schema>;

export interface DbClient {
  readonly db: Db;
  /** Raw SQL escape hatch (tests: truncation, trigger probes). */
  readonly sql: postgres.Sql;
  close(): Promise<void>;
}

/** Connects to Postgres. Caller owns the lifecycle — always await close(). */
export function createDbClient(databaseUrl: string): DbClient {
  const sql = postgres(databaseUrl, {
    // Single connection: deterministic statement ordering for the slice tests.
    max: 1,
    onnotice: () => undefined,
  });
  const db = drizzle(sql, { schema });
  return {
    db,
    sql,
    close: () => sql.end({ timeout: 5 }),
  };
}

const MIGRATIONS_FOLDER = fileURLToPath(new URL('../drizzle', import.meta.url));

/** Applies all committed Drizzle migrations (same set `just migrate` uses). */
export async function migrateDb(db: Db): Promise<void> {
  await migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });
}
