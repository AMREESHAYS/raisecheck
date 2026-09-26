/**
 * Import third-party salary benchmarks you have the right to use — a licensed
 * data feed, a published industry report, an employer's own comp bands, or a
 * dataset released under terms that permit this.
 *
 * Every row must carry `source` and `license_note`. That is not bureaucracy:
 * the UI attributes each figure to its source by name, and the chatbot is
 * instructed never to merge a third-party number into the community percentiles.
 * A number with no provenance is the one thing this product cannot ship.
 *
 * Run: npm run import-benchmarks -- ./path/to/file.json
 */
import { config } from "dotenv";

// Same precedence Next.js uses, so the scripts and the app read one file.
// Explicit, because bare `dotenv/config` reads `.env` only — and a stray `.env`
// holding a service-role key is the one file that must never be committed.
config({ path: [".env.local", ".env"] });
import { readFileSync } from "node:fs";
import { supabase } from "../lib/db.ts";
import { CATEGORIES, CITIES } from "../lib/vocab.ts";

type Row = {
  source: string;
  source_url?: string;
  license_note: string;
  role_category: string;
  city?: string | null;
  min_years: number;
  max_years: number;
  p25?: number | null;
  p50: number;
  p75?: number | null;
  sample_size?: number | null;
  as_of: string;
};

const path = process.argv[2];
if (!path) {
  console.error("usage: npm run import-benchmarks -- ./benchmarks.json");
  process.exit(1);
}

const rows = JSON.parse(readFileSync(path, "utf8")) as Row[];
if (!Array.isArray(rows)) throw new Error("expected a JSON array");

for (const [i, r] of rows.entries()) {
  const fail = (m: string) => {
    console.error(`row ${i}: ${m}`);
    process.exit(1);
  };
  if (!r.source?.trim()) fail("missing `source`");
  if (!r.license_note?.trim())
    fail("missing `license_note` — state what permits you to use this data");
  if (!(CATEGORIES as readonly string[]).includes(r.role_category))
    fail(`role_category "${r.role_category}" is not one of ${CATEGORIES.join(", ")}`);
  if (r.city && !(CITIES as readonly string[]).includes(r.city))
    fail(`city "${r.city}" is not in the controlled list`);
  if (!Number.isFinite(r.p50) || r.p50 <= 0) fail("p50 must be a positive number");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(r.as_of)) fail("as_of must be YYYY-MM-DD");
}

const { error } = await supabase()
  .from("external_benchmark")
  .insert(
    rows.map((r) => ({
      source: r.source,
      source_url: r.source_url ?? null,
      license_note: r.license_note,
      role_category: r.role_category,
      city: r.city ?? null,
      min_years: r.min_years,
      max_years: r.max_years,
      p25: r.p25 ?? null,
      p50: r.p50,
      p75: r.p75 ?? null,
      sample_size: r.sample_size ?? null,
      as_of: r.as_of,
    })),
  );
if (error) {
  console.error(error.message);
  process.exit(1);
}
console.log(`imported ${rows.length} external benchmarks`);
