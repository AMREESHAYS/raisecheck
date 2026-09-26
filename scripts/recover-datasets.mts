/**
 * Pull rows back out of actor runs that already completed.
 *
 * Reading a dataset costs nothing, but a `--dry-run` threw its rows away after
 * the run had already been paid for — and on a free tier that is the difference
 * between having real data and having none. This recovers what those runs
 * produced and caches it to disk, so parsing and aggregation can be re-run as
 * often as needed without touching the quota again.
 *
 *   npm run recover -- --list
 *   npm run recover -- --dataset <id> --segment "Product & Internet"
 */
import { config } from "dotenv";
config({ path: [".env.local", ".env"] });

import { mkdirSync, writeFileSync } from "node:fs";

const argv = process.argv.slice(2);
const flag = (n: string) => {
  const i = argv.indexOf(`--${n}`);
  return i >= 0 && !argv[i + 1]?.startsWith("--") ? argv[i + 1] : undefined;
};

const token = process.env.APIFY_TOKEN;
if (!token) {
  console.error("APIFY_TOKEN is not set");
  process.exit(1);
}
const auth = { authorization: `Bearer ${token}` };

if (argv.includes("--list")) {
  const res = await fetch("https://api.apify.com/v2/actor-runs?limit=30&desc=true", { headers: auth });
  const runs = (await res.json()).data?.items ?? [];
  for (const r of runs) {
    const d = await fetch(`https://api.apify.com/v2/datasets/${r.defaultDatasetId}`, { headers: auth });
    const count = (await d.json()).data?.itemCount ?? 0;
    console.log(`${r.status.padEnd(10)} ${r.defaultDatasetId}  ${String(count).padStart(5)} items  ${r.startedAt?.slice(0, 19)}`);
  }
  process.exit(0);
}

const id = flag("dataset");
const segment = flag("segment") ?? "unlabelled";
if (!id) {
  console.error('usage: npm run recover -- --list | --dataset <id> --segment "<name>"');
  process.exit(1);
}

const res = await fetch(`https://api.apify.com/v2/datasets/${id}/items?clean=true&limit=10000`, { headers: auth });
if (!res.ok) {
  console.error(`apify ${res.status}: ${(await res.text()).slice(0, 200)}`);
  process.exit(1);
}
const items = (await res.json()) as unknown[];

mkdirSync("data/raw", { recursive: true });
const path = `data/raw/${segment.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}-${id}.json`;
writeFileSync(path, JSON.stringify({ segment, dataset: id, fetched: new Date().toISOString(), items }, null, 2));
console.log(`saved ${items.length} rows -> ${path}`);
