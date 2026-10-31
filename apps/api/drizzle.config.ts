import { defineConfig } from 'drizzle-kit';

// `pnpm --filter @wally/api db:generate` writes the SQL migration for schema changes.
// Until a hosted database has applied it, regenerate the single migration instead of
// adding another (docs/superpowers/specs/2026-10-27-postgres-foundation-design.md).
export default defineConfig({
  dialect: 'postgresql',
  schema: './src/lib/postgres/schema/index.ts',
  out: './drizzle',
  casing: 'snake_case',
});
