/**
 * Pull third-party salary benchmarks through Apify into `external_benchmark`.
 *
 * Batch only — never called from a request. An actor run takes minutes and costs
 * credits, so results are cached in the table and the app reads only from there.
 *
 *   npm run ingest -- --source levels_fyi --probe      # see the raw shape, write nothing
 *   npm run ingest -- --source levels_fyi --dry-run    # parse + aggregate, write nothing
 *   npm run ingest -- --source levels_fyi              # write
 *
 * Flags: --max-items N  --min-sample N  --input '<json>'  --stale-days N
 */
import { config } from "dotenv";
config({ path: [".env.local", ".env"] });

import { readFileSync } from "node:fs";
import { runActor } from "../lib/apify.ts";
import { extractPoint, aggregate, type DataPoint } from "../lib/ingest/extract.ts";
import { supabase } from "../lib/db.ts";

type SourceCfg = {
  label: string;
  actorId: string;
  actorSlug: string;
  sourceUrl: string;
  license_note: string;
  input: Record<string, unknown>;
};

const argv = process.argv.slice(2);
const flag = (name: string) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 ? (argv[i + 1]?.startsWith("--") ? "" : argv[i + 1]) : undefined;
};
const has = (name: string) => argv.includes(`--${name}`);

const cfgAll = JSON.parse(readFileSync("data/apify-sources.json", "utf8")).sources as Record<string, SourceCfg>;
const sourceKey = flag("source");
if (!sourceKey || !cfgAll[sourceKey]) {
  console.error(`usage: npm run ingest -- --source <${Object.keys(cfgAll).join("|")}> [--probe|--dry-run]`);
  process.exit(1);
}
const cfg = cfgAll[sourceKey];
const probe = has("probe");
const dryRun = has("dry-run");
const maxItems = Number(flag("max-items") ?? (probe ? 10 : 500));
const minSample = Number(flag("min-sample") ?? 8);
const staleDays = Number(flag("stale-days") ?? 30);

if (!process.env.APIFY_TOKEN) {
  console.error("APIFY_TOKEN is not set — see .env.local.example");
  process.exit(1);
}
if (!probe && !dryRun && (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY)) {
  console.error("Writing needs Supabase credentials. Use --dry-run to test parsing without them.");
  process.exit(1);
}

// Don't pay for a run whose data we already have and is still fresh.
if (!probe && !dryRun) {
  const since = new Date(Date.now() - staleDays * 864e5).toISOString().slice(0, 10);
  const { data } = await supabase()
    .from("external_benchmark")
    .select("as_of")
    .eq("source", cfg.label)
    .gte("as_of", since)
    .limit(1);
  if (data?.length) {
    console.log(`${cfg.label} was ingested within ${staleDays} days. Use --stale-days 0 to force.`);
    process.exit(0);
  }
}

const input = { ...cfg.input, ...(flag("input") ? JSON.parse(flag("input")!) : {}) };
console.log(`running ${cfg.actorSlug} (${cfg.actorId}), max ${maxItems} items…`);

const run = await runActor(cfg.actorId, input, {
  maxItems,
  onTick: (status, secs) => process.stdout.write(`\r  ${status} ${secs}s`),
});
console.log(`\r  ${run.status} — ${run.items.length} items            `);

if (probe) {
  // The actors' output schemas aren't published, so look before mapping.
  console.log("\n--- first item ---");
  console.log(JSON.stringify(run.items[0] ?? null, null, 2).slice(0, 3000));
  console.log("\n--- keys seen across items ---");
  const keys = new Set<string>();
  for (const it of run.items) if (it && typeof it === "object") Object.keys(it).forEach((k) => keys.add(k));
  console.log([...keys].sort().join(", ") || "(none)");
  const parsed = run.items.map((r) => extractPoint(r as Record<string, unknown>));
  console.log(`\nparsed ${parsed.filter(Boolean).length}/${run.items.length} items into usable points`);
  console.log("If that ratio is poor, add the real field names to the *_KEYS lists in lib/ingest/extract.ts.");
  process.exit(0);
}

const points = run.items
  .map((r) => extractPoint(r as Record<string, unknown>))
  .filter((p): p is DataPoint => p !== null);

console.log(`parsed ${points.length}/${run.items.length} items`);
if (!points.length) {
  console.error("Nothing parsed. Run with --probe to see the actual field names.");
  process.exit(1);
}

const buckets = aggregate(points, minSample);
console.log(`${buckets.length} buckets at n>=${minSample}:`);
for (const b of buckets.slice(0, 15))
  console.log(
    `  ${b.role_category.padEnd(16)} ${(b.city ?? "all India").padEnd(16)} ` +
      `${b.min_years}-${b.max_years}y  n=${String(b.sample_size).padStart(4)}  ` +
      `p50=₹${b.p50.toLocaleString("en-IN")}`,
  );
if (buckets.length > 15) console.log(`  … and ${buckets.length - 15} more`);

if (dryRun) {
  console.log("\n--dry-run: nothing written.");
  process.exit(0);
}

const as_of = new Date().toISOString().slice(0, 10);
const rows = buckets.map((b) => ({
  source: cfg.label,
  source_url: cfg.sourceUrl,
  license_note: cfg.license_note,
  role_category: b.role_category,
  city: b.city,
  min_years: b.min_years,
  max_years: b.max_years,
  p25: b.p25,
  p50: b.p50,
  p75: b.p75,
  sample_size: b.sample_size,
  as_of,
}));

// Replace this source's previous snapshot rather than stacking generations of it.
await supabase().from("external_benchmark").delete().eq("source", cfg.label);
const { error } = await supabase().from("external_benchmark").insert(rows);
if (error) {
  console.error(error.message);
  process.exit(1);
}
console.log(`\nwrote ${rows.length} benchmarks for ${cfg.label} (as_of ${as_of})`);
