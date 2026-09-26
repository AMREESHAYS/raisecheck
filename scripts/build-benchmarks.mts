/**
 * Build segmented market benchmarks from cached raw rows.
 *
 * Runs entirely offline against `data/raw/*.json`, so aggregation can be fixed,
 * re-tuned and re-run without spending a single Apify credit. Scraping and
 * interpreting are separate jobs; conflating them is how a free-tier quota gets
 * burned re-fetching data you already have.
 *
 *   npm run build:benchmarks -- --dry-run
 *   TABLE_SUFFIX=_v2 npm run build:benchmarks
 *
 * The employer name is read only to assign a segment and is then discarded. It
 * is never stored, so the coach cannot claim what a named company pays.
 */
import { config } from "dotenv";
config({ path: [".env.local", ".env"] });

import { readFileSync, readdirSync } from "node:fs";
import { extractPoint, aggregate, type DataPoint } from "../lib/ingest/extract.ts";
import { supabase } from "../lib/db.ts";

const argv = process.argv.slice(2);
const flag = (n: string) => {
  const i = argv.indexOf(`--${n}`);
  return i >= 0 && !argv[i + 1]?.startsWith("--") ? argv[i + 1] : undefined;
};
const dryRun = argv.includes("--dry-run");
const minSample = Number(flag("min-sample") ?? 5);

const employers = JSON.parse(readFileSync("data/employers.json", "utf8"));
const slugify = (s: unknown) =>
  String(s ?? "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

const segmentOf = new Map<string, string>();
for (const [segment, list] of Object.entries(employers.segments as Record<string, string[]>))
  for (const slug of list) segmentOf.set(slug, segment);
for (const [slug, segment] of Object.entries(employers.aliases as Record<string, string>))
  segmentOf.set(slug, segment);

if (!dryRun && process.env.TABLE_SUFFIX !== "_v2") {
  console.error("Refusing to write: set TABLE_SUFFIX=_v2 so this cannot touch the live demo's tables.");
  process.exit(1);
}

// Group every cached row by the segment its employer belongs to.
const bySegment = new Map<string, DataPoint[]>();
let rows = 0;
let unsegmented = 0;
let unparsed = 0;

for (const file of readdirSync("data/raw").filter((f) => f.endsWith(".json"))) {
  const items = JSON.parse(readFileSync(`data/raw/${file}`, "utf8")).items as Record<string, unknown>[];
  for (const item of items) {
    rows++;
    const segment = segmentOf.get(slugify(item.company_name));
    if (!segment) {
      unsegmented++;
      continue; // An unknown employer has no segment, and a blended figure is worse than none.
    }
    const point = extractPoint(item);
    if (!point) {
      unparsed++;
      continue;
    }
    if (!bySegment.has(segment)) bySegment.set(segment, []);
    bySegment.get(segment)!.push(point);
  }
}

console.log(`\n${rows} cached rows — ${unsegmented} unknown employer, ${unparsed} unreadable\n`);

const as_of = new Date().toISOString().slice(0, 10);
const all: Record<string, unknown>[] = [];

for (const [segment, points] of [...bySegment.entries()].sort()) {
  const buckets = aggregate(points, minSample);
  console.log(`${segment} — ${points.length} usable points, ${buckets.length} buckets at n>=${minSample}`);
  for (const b of buckets.slice(0, 6))
    console.log(
      `   ${b.role_category.padEnd(16)} ${`${b.min_years}-${b.max_years}y`.padEnd(8)} ` +
        `n=${String(b.sample_size).padStart(4)}  p50=₹${b.p50.toLocaleString("en-IN")}`,
    );
  all.push(
    ...buckets.map((b) => ({
      source: "AmbitionBox",
      source_url: "https://www.ambitionbox.com",
      license_note: "Collected via Apify. Verify your use complies with AmbitionBox's terms.",
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
    })),
  );
}

// The point of segmenting: show that two correct figures disagree for a reason.
const eng = all.filter((r) => r.role_category === "Engineering" && r.min_years === 3);
if (eng.length > 1) {
  console.log("\nSame role, same experience, different employer segment:");
  for (const r of eng)
    console.log(`   Engineering 3-5y · ${String(r.segment).padEnd(20)} ₹${Number(r.p50).toLocaleString("en-IN")}  (n=${r.sample_size})`);
}

if (dryRun) {
  console.log(`\n--dry-run: ${all.length} benchmarks computed, nothing written.`);
  process.exit(0);
}

const db = supabase();
await db.from("external_benchmark_v2").delete().eq("source", "AmbitionBox");
const { error } = await db.from("external_benchmark_v2").insert(all);
if (error) {
  console.error(error.message);
  process.exit(1);
}
console.log(`\nwrote ${all.length} segmented benchmarks (as_of ${as_of})`);
