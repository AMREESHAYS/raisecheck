/**
 * Review the submissions the outlier gate held back.
 *
 * Without this, `status = 'pending'` is a black hole: the submitter is told
 * their figure is held for review, and no review ever happens. Either these get
 * decided or the app should stop claiming they will be.
 *
 *   npm run review                          # list what's waiting, with context
 *   npm run review -- --auto                # apply the heuristic below
 *   npm run review -- --approve <id|all>
 *   npm run review -- --reject  <id|all>
 */
import { config } from "dotenv";
config({ path: [".env.local", ".env"] });

import { supabase, bucketStats } from "../lib/db.ts";
import { expBucket } from "../lib/vocab.ts";
import { OUTLIER_SIGMA, MIN_SAMPLE } from "../lib/stats.ts";
import { inrFull } from "../lib/format.ts";

const argv = process.argv.slice(2);
const flag = (n: string) => {
  const i = argv.indexOf(`--${n}`);
  return i >= 0 ? argv[i + 1] : undefined;
};
const has = (n: string) => argv.includes(`--${n}`);

if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
  console.error("No Supabase credentials. See .env.local.example");
  process.exit(1);
}

const db = supabase();

async function setStatus(ids: string[], status: "verified" | "rejected") {
  if (!ids.length) return;
  const { error } = await db.from("salary_submission").update({ status }).in("id", ids);
  if (error) {
    console.error(error.message);
    process.exit(1);
  }
  console.log(`${status} ${ids.length} submission${ids.length === 1 ? "" : "s"}`);
}

const { data: pending, error } = await db
  .from("salary_submission")
  .select("*")
  .eq("status", "pending")
  .order("submitted_at", { ascending: true })
  .limit(200);
if (error) {
  console.error(error.message);
  process.exit(1);
}
if (!pending?.length) {
  console.log("Nothing pending.");
  process.exit(0);
}

const approve = flag("approve");
const reject = flag("reject");
if (approve === "all") {
  await setStatus(pending.map((r) => r.id), "verified");
  process.exit(0);
}
if (reject === "all") {
  await setStatus(pending.map((r) => r.id), "rejected");
  process.exit(0);
}
if (approve) {
  await setStatus([approve], "verified");
  process.exit(0);
}
if (reject) {
  await setStatus([reject], "rejected");
  process.exit(0);
}

// Re-measure each held row against its bucket as it stands now. A bucket that was
// thin when the row arrived may since have filled out, and a figure that looked
// extreme against 9 peers can be ordinary against 200.
console.log(`\n${pending.length} submission${pending.length === 1 ? "" : "s"} awaiting review\n`);

const verdicts: { id: string; keep: boolean; why: string }[] = [];

for (const r of pending) {
  const b = expBucket(r.years_experience);
  const peers = await bucketStats({
    role_category: r.role_category,
    city: r.city,
    minYears: b.min,
    maxYears: b.max,
  });

  const sigma = peers.n >= MIN_SAMPLE && peers.std > 0
    ? Math.abs(r.current_ctc_annual - peers.mean) / peers.std
    : null;

  // Only a figure that is still extreme against a bucket big enough to judge it
  // gets rejected. Anything else is a real salary we simply couldn't place yet.
  const keep = sigma === null || sigma <= OUTLIER_SIGMA;
  const why =
    sigma === null
      ? `bucket still too thin to judge (n=${peers.n})`
      : keep
        ? `now ${sigma.toFixed(1)}σ from a bucket of ${peers.n} — within tolerance`
        : `still ${sigma.toFixed(1)}σ from a bucket of ${peers.n}`;

  verdicts.push({ id: r.id, keep, why });

  console.log(`${keep ? "KEEP  " : "REJECT"} ${r.id}`);
  console.log(`       ${r.role_title} · ${r.years_experience}y · ${r.city} · ${inrFull(r.current_ctc_annual)}`);
  console.log(`       bucket median ${peers.n ? inrFull(peers.p50) : "—"} · ${why}`);
  console.log(`       submitted ${r.submitted_at.slice(0, 10)}\n`);
}

if (!has("auto")) {
  const keep = verdicts.filter((v) => v.keep).length;
  console.log(`Heuristic would approve ${keep} and reject ${verdicts.length - keep}.`);
  console.log("Re-run with --auto to apply, or --approve <id> / --reject <id> to decide one.");
  process.exit(0);
}

await setStatus(verdicts.filter((v) => v.keep).map((v) => v.id), "verified");
await setStatus(verdicts.filter((v) => !v.keep).map((v) => v.id), "rejected");
