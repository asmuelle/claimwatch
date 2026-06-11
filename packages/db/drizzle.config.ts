import { defineConfig } from 'drizzle-kit';

// `drizzle-kit generate` is offline; only `drizzle-kit migrate` (just migrate)
// needs a reachable DATABASE_URL. The fallback keeps offline tooling working
// without pretending a database exists.
export default defineConfig({
  dialect: 'postgresql',
  schema: './src/schema.ts',
  out: './drizzle',
  dbCredentials: {
    url: process.env.DATABASE_URL ?? 'postgres://claimwatch:claimwatch@localhost:5433/claimwatch',
  },
});
