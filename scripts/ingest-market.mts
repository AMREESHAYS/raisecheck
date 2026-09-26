/**
 * Build a real market baseline, segment by segment.
 *
 * The problem this exists to solve: a salary benchmark with no salaries is a
 * random number generator with a nice UI. This ingests genuine published figures
 * per employer segment so the app can answer "am I underpaid" from something
 * real on day one, before a single user has submitted anything.
 *
 * Segments are ingested separately and stored separately. An IT services median
 * and a product-company median are both correct and several times apart; showing
 * one blended number across them describes nobody.
 *
 *   npm run ingest:market -- --segment "IT Services" --dry-run
 *   npm run ingest:market -- --segment "IT Services"
 *   npm run ingest:market -- --all
 *
 * Employer identity is discarded at aggregation and never stored.
 */
import { config } from "dotenv";
config({ path: [".env.local", ".env"] });

import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { runActor } from "../lib/apify.ts";
import { extractPoint, aggregate, type DataPoint } from "../lib/ingest/extract.ts";
import { supabase } from "../lib/db.ts";

type Sources = Record<string, { label: string; actorId: string; actorSlug: string; sourceUrl: string; license_note: string; input: Record<string, unknown> }>;

const sources = JSON.parse(readFileSync("data/apify-sources.json", "utf8")).sources as Sources;
const employers = JSON.parse(readFileSync("data/employers.json", "utf8")).segments as Record<string, string[]>;
const cfg = sources.ambitionbox;

const argv = process.argv.slice(2);
const flag = (n: string) => {
  const i = argv.indexOf(`--${n}`);
  return i >= 0 && !argv[i + 1]?.startsWith("--") ? argv[i + 1] : undefined;
};
const has = (n: string) => argv.includes(`--${n}`);

const dryRun = has("dry-run");
// Cache raw rows and stop. Scraping and interpreting are separate jobs — the
// aggregation can then be re-tuned offline without spending another credit.
const cacheOnly = has("cache");
const perCompany = Number(flag("per-company") ?? 40);
const minSample = Number(flag("min-sample") ?? 5);
const batchSize = Number(flag("batch") ?? 10);

const wanted = has("all") ? Object.keys(employers) : [flag("segment") ?? ""].filter(Boolean);
if (!wanted.length || wanted.some((s) => !employers[s])) {
  console.error(`usage: npm run ingest:market -- --segment "<name>" | --all`);
  console.error(`segments: ${Object.keys(employers).join(" | ")}`);
  process.exit(1);
}
if (!process.env.APIFY_TOKEN) {
  console.error("APIFY_TOKEN is not set — see .env.local.example");
  process.exit(1);
}
if (!dryRun && !cacheOnly && process.env.TABLE_SUFFIX !== "_v2") {
  console.error("Refusing to write: set TABLE_SUFFIX=_v2 so this cannot touch the live demo's tables.");
  process.exit(1);
}

const as_of = new Date().toISOString().slice(0, 10);
let grandTotal = 0;

for (const segment of wanted) {
  const companies = employers[segment];
  console.log(`\n=== ${segment} — ${companies.length} employers ===`);

  const points: DataPoint[] = [];
  let raw = 0;

  // Batched because one actor run over 20 companies routinely times out, and a
  // timeout costs the credits without returning the rows.
  for (let i = 0; i < companies.length; i += batchSize) {
    const batch = companies.slice(i, i + batchSize);
    process.stdout.write(`  [${i / batchSize + 1}] ${batch.length} employers… `);
    try {
      const run = await runActor(
        cfg.actorId,
        { ...cfg.input, companies: batch, maxResults: perCompany },
        { maxItems: batch.length * perCompany, timeoutSecs: 900 },
      );
      raw += run.items.length;
      // Save before parsing: a parser bug must never cost the rows again.
      mkdirSync("data/raw", { recursive: true });
      writeFileSync(
        `data/raw/${segment.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}-${run.datasetId}.json`,
        JSON.stringify({ segment, dataset: run.datasetId, fetched: new Date().toISOString(), items: run.items }),
      );
      const got = run.items
        .map((r) => extractPoint(r as Record<string, unknown>))
        .filter((p): p is DataPoint => p !== null);
      points.push(...got);
      console.log(`${run.items.length} rows -> ${got.length} usable`);
    } catch (e) {
      // One bad batch must not lose the batches that already succeeded.
      console.log(`failed: ${(e as Error).message.slice(0, 120)}`);
    }
  }

  if (!points.length) {
    console.log(`  nothing usable for ${segment} — check the slugs with --probe`);
    continue;
  }

  const buckets = aggregate(points, minSample);
  console.log(`  ${raw} raw -> ${points.length} usable -> ${buckets.length} buckets at n>=${minSample}`);
  for (const b of buckets.slice(0, 8))
    console.log(
      `    ${b.role_category.padEnd(16)} ${String(b.min_years + "-" + b.max_years + "y").padEnd(8)} ` +
        `n=${String(b.sample_size).padStart(4)}  p50=₹${b.p50.toLocaleString("en-IN")}`,
    );

  if (dryRun || cacheOnly) continue;

  const rows = buckets.map((b) => ({
    source: cfg.label,
    source_url: cfg.sourceUrl,
    license_note: cfg.license_note,
    role_category: b.role_category,
    segment,
    city: b.city,
    min_years: b.min_years,
    max_years: b.max_years,
    p25: b.p25,
    p50: b.p50,
    p75: b.p75,
    sample_size: b.sample_size,
    as_of,
  }));

  // Replace this segment's previous snapshot rather than stacking generations.
  await supabase().from("external_benchmark_v2").delete().eq("source", cfg.label).eq("segment", segment);
  const { error } = await supabase().from("external_benchmark_v2").insert(rows);
  if (error) {
    console.error(`  write failed: ${error.message}`);
    continue;
  }
  grandTotal += rows.length;
  console.log(`  wrote ${rows.length} benchmarks for ${segment}`);
}

console.log(dryRun ? "\n--dry-run: nothing written." : `\ntotal written: ${grandTotal} benchmarks (as_of ${as_of})`);
