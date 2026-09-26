import { drizzle } from "drizzle-orm/postgres-js";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import * as schema from "./schema";

export type Db = PostgresJsDatabase<typeof schema>;

let cached: Db | null = null;

/**
 * Returns the shared database handle.
 *
 * Production and local dev both talk to a real Postgres via DATABASE_URL. If
 * DATABASE_URL is unset we fall back to PGlite — Postgres compiled to WASM,
 * running in-process against a folder on disk — so `npm run dev` and the test
 * suite work with zero setup. Same SQL dialect either way, so nothing in the
 * app needs to know which one it got.
 */
export async function getDb(): Promise<Db> {
  if (cached) return cached;

  const url = process.env.DATABASE_URL;
  if (url) {
    const postgres = (await import("postgres")).default;
    // A small pool: serverless runtimes create many short-lived instances.
    const client = postgres(url, { max: 5, prepare: false });
    cached = drizzle(client, { schema });
  } else {
    const { PGlite } = await import("@electric-sql/pglite");
    const { drizzle: drizzlePglite } = await import("drizzle-orm/pglite");
    const dataDir = process.env.PGLITE_DIR ?? ".pglite";
    const client = new PGlite(dataDir);
    cached = drizzlePglite(client, { schema }) as unknown as Db;
    await ensureSchema(client);
  }
  return cached;
}

/** Applied only on the PGlite path, where there is no migration step to run. */
async function ensureSchema(client: { exec: (sql: string) => Promise<unknown> }) {
  await client.exec(`
    CREATE TABLE IF NOT EXISTS submissions (
      id serial PRIMARY KEY,
      created_at timestamptz NOT NULL DEFAULT now(),
      role_slug text NOT NULL,
      level_slug text NOT NULL,
      city_slug text NOT NULL,
      company_type text NOT NULL,
      years_experience real NOT NULL,
      years_at_company real NOT NULL,
      annual_base_inr integer NOT NULL,
      annual_bonus_inr integer NOT NULL DEFAULT 0,
      annual_equity_inr integer NOT NULL DEFAULT 0,
      total_comp_inr integer NOT NULL,
      last_raise_pct real,
      months_since_raise integer,
      source text NOT NULL DEFAULT 'user',
      status text NOT NULL DEFAULT 'approved',
      trust_score real NOT NULL DEFAULT 1,
      flag_reason text,
      fingerprint text,
      shareable boolean NOT NULL DEFAULT true
    );
    CREATE INDEX IF NOT EXISTS submissions_cohort_idx ON submissions (role_slug, city_slug, status);
    CREATE INDEX IF NOT EXISTS submissions_role_idx ON submissions (role_slug, status);
    CREATE INDEX IF NOT EXISTS submissions_fingerprint_idx ON submissions (fingerprint);
  `);
}

export { schema };
