// Smallest thing that fails if the money logic breaks. Runs offline — no database,
// no API key. Run: npm test
import assert from "node:assert/strict";
import { isOutlier, marketRate, MIN_SAMPLE, type BucketFetcher } from "./stats.ts";
import { inflationBetween, realChange } from "./inflation.ts";
import { validate, CTC_FLOOR, CTC_REVIEW_CEILING } from "./validate.ts";
import { expBucket, ROLES } from "./vocab.ts";
import {
  parseMoney, toAnnualInr, matchCity, matchRoleCategory, matchYears,
  pickField, extractPoint, aggregate,
} from "./ingest/extract.ts";

// --- outlier gate ---
assert.equal(isOutlier(1.1e6, { n: 20, mean: 1.1e6, std: 5e4 }), false, "typical value passes");
assert.equal(isOutlier(5e7, { n: 20, mean: 1.1e6, std: 5e4 }), true, "absurd value is flagged");
assert.equal(isOutlier(5e7, { n: 3, mean: 1.1e6, std: 5e4 }), false, "thin bucket cannot reject anything");
assert.equal(isOutlier(5e7, { n: MIN_SAMPLE - 1, mean: 1e6, std: 1e4 }), false, `n=${MIN_SAMPLE - 1} still cannot reject`);
assert.equal(isOutlier(1e6, { n: 20, mean: 1e6, std: 0 }), false, "zero variance, identical value");
assert.equal(isOutlier(2e6, { n: 20, mean: 1e6, std: 0 }), true, "zero variance, different value");

// --- inflation ---
const oneYear = inflationBetween(new Date("2023-01-01"), new Date("2024-01-01"));
assert.ok(Math.abs(oneYear.pct - 5.4) < 0.01, `2023 full year should be 5.4%, got ${oneYear.pct}`);
const twoYears = inflationBetween(new Date("2023-01-01"), new Date("2025-01-01"));
assert.ok(Math.abs(twoYears.pct - (1.054 * 1.049 - 1) * 100) < 0.01, "compounds, not sums");
assert.equal(inflationBetween(new Date("2024-01-01"), new Date("2023-01-01")).pct, 0, "reversed range is zero");
const half = inflationBetween(new Date("2023-01-01"), new Date("2023-07-02"));
assert.ok(half.pct > 2.5 && half.pct < 3, `half of 2023 prorates, got ${half.pct}`);

const flat = realChange(1_060_000, 6, new Date("2023-01-01"), new Date("2024-01-01"));
assert.equal(flat.verdict, "flat");
assert.ok(Math.abs(flat.realPct - 0.569) < 0.01, `real change math, got ${flat.realPct}`);
const behind = realChange(1_020_000, 2, new Date("2023-01-01"), new Date("2024-01-01"));
assert.equal(behind.verdict, "behind");
assert.ok(behind.rupeeDelta < 0 && behind.sentence.includes("gave up"), behind.sentence);
const ahead = realChange(1_200_000, 20, new Date("2023-01-01"), new Date("2024-01-01"));
assert.equal(ahead.verdict, "ahead");
assert.ok(ahead.rupeeDelta > 0);

// --- validation gates ---
const good = {
  role_title: "UX Designer", city: "Bangalore", years_experience: 3,
  current_ctc_annual: 1_400_000, last_raise_pct: 8, last_raise_date: "2025-04-01",
  employment_type: "full-time", company_size_bucket: "50-500",
};
const v = validate(good);
assert.ok(v.ok && v.value.role_category === "Design", "role maps to its category");
assert.ok(v.ok && !v.value.needsReview);

assert.equal(validate({ ...good, role_title: "Chief Vibes Officer" }).ok, false, "free-text role rejected");
assert.equal(validate({ ...good, city: "Springfield" }).ok, false, "free-text city rejected");
assert.equal(validate({ ...good, current_ctc_annual: CTC_FLOOR - 1 }).ok, false, "below floor rejected");
assert.equal(validate({ ...good, current_ctc_annual: 90_000 }).ok, false, "monthly figure rejected");
assert.equal(validate({ ...good, years_experience: 2.5 }).ok, false, "fractional years rejected");
assert.equal(validate({ ...good, last_raise_date: "2099-01-01" }).ok, false, "future raise date rejected");
assert.equal(validate({ ...good, last_raise_pct: 8, last_raise_date: "" }).ok, false, "raise % without a date rejected");
assert.equal(validate({ ...good, last_raise_pct: "", last_raise_date: "" }).ok, true, "both blank is fine");
assert.equal(validate({ ...good, years_experience: 1, current_ctc_annual: 20_000_000 }).ok, false, "fresher on 2 Cr rejected");
const review = validate({ ...good, years_experience: 18, current_ctc_annual: CTC_REVIEW_CEILING + 1 });
assert.ok(review.ok && review.value.needsReview, "above the review ceiling goes to manual review");

// --- buckets & vocab ---
assert.equal(expBucket(0).label, "0-2 yrs");
assert.equal(expBucket(4).label, "3-5 yrs");
assert.equal(expBucket(40).label, "15+ yrs");
assert.ok(Object.keys(ROLES).length > 150, "role vocabulary is big enough to be usable");
for (const k of ["name", "email", "phone", "company"]) {
  assert.ok(!(k in (v as { value: object }).value), `${k} must not exist in a submission`);
}

// --- market rate widening ---
// A stand-in for the bucket_stats RPC, computing the same things in memory so the
// widening ladder can be exercised without a database.
function fakeDb(rows: { city: string; years: number; ctc: number }[]): BucketFetcher {
  return async ({ city, minYears, maxYears, ctc }) => {
    const hit = rows
      .filter((r) => (city === null || r.city === city) && r.years >= minYears && r.years <= maxYears)
      .map((r) => r.ctc)
      .sort((a, b) => a - b);
    const pct = (p: number) => {
      if (!hit.length) return 0;
      const i = (p / 100) * (hit.length - 1);
      const lo = Math.floor(i);
      return Math.round(hit[lo] + (hit[Math.ceil(i)] - hit[lo]) * (i - lo));
    };
    const mean = hit.reduce((a, b) => a + b, 0) / (hit.length || 1);
    return {
      n: hit.length,
      p25: pct(25), p50: pct(50), p75: pct(75),
      mean,
      std: Math.sqrt(hit.reduce((a, b) => a + (b - mean) ** 2, 0) / (hit.length || 1)),
      rank_pct: ctc == null || !hit.length
        ? null
        : Math.round((hit.filter((x) => x < ctc).length / hit.length) * 100),
    };
  };
}

const pune = Array.from({ length: 7 }, (_, i) => ({ city: "Pune", years: 4, ctc: 1_000_000 + i * 10_000 }));
assert.ok(
  "insufficient" in (await marketRate("Design", "Pune", 4, 1e6, fakeDb([]))),
  "empty dataset gives no number",
);
assert.ok(
  "insufficient" in (await marketRate("Design", "Pune", 4, 1e6, fakeDb(pune))),
  `${MIN_SAMPLE - 1} submissions is not enough`,
);

const full = [...pune, { city: "Pune", years: 4, ctc: 1_070_000 }];
const exact = await marketRate("Design", "Pune", 4, 1_070_000, fakeDb(full));
assert.ok(!("insufficient" in exact), "exact bucket resolves at n=8");
assert.equal(!("insufficient" in exact) && exact.n, MIN_SAMPLE);
assert.equal(!("insufficient" in exact) && exact.widened, false);
assert.equal(!("insufficient" in exact) && exact.basis.city, "Pune");
assert.ok(!("insufficient" in exact) && exact.p25 < exact.p50 && exact.p50 < exact.p75, "percentiles ordered");
assert.equal(!("insufficient" in exact) && exact.rank_pct, 88, "rank comes back with the bucket");

// Mumbai has nothing of its own, but the all-India same-experience pool does.
const widened = await marketRate("Design", "Mumbai", 4, 1_070_000, fakeDb(full));
assert.ok(!("insufficient" in widened) && widened.widened, "falls back past city");
assert.equal(!("insufficient" in widened) && widened.basis.city, null, "city dropped first");
assert.equal(!("insufficient" in widened) && widened.basis.experience, "3-5 yrs", "experience granularity kept");
assert.ok(!("insufficient" in widened) && widened.note?.includes("Mumbai"), "the note names the city we couldn't serve");

// Only an all-levels pool exists: the ladder must reach the last rung, not give up.
const scattered = Array.from({ length: 10 }, (_, i) => ({ city: "Kochi", years: 12 + i, ctc: 2e6 + i * 1e5 }));
const widest = await marketRate("Design", "Mumbai", 1, 1e6, fakeDb(scattered));
assert.ok(!("insufficient" in widest) && widest.basis.experience === "all levels", "last rung reached");

// --- scraped-data extraction ---
// Every one of these is a shape a salary site actually publishes. A misparse here
// silently poisons a percentile, so the parser must return null rather than guess.
const money = (s: unknown) => parseMoney(s);
assert.equal(money("₹12,00,000")?.inr, 1_200_000, "Indian digit grouping");
assert.equal(money("12 LPA")?.inr, 1_200_000, "LPA shorthand");
assert.equal(money("₹8L - ₹12L")?.inr, 1_000_000, "range collapses to its midpoint");
assert.equal(money("8 - 12 LPA")?.inr, 1_000_000, "trailing unit applies to both ends of a range");
assert.equal(money("1.2 Cr")?.inr, 1_20_00_000, "crore");
assert.equal(money("₹12,00,000 - ₹18,00,000")?.inr, 1_500_000, "explicit range");
assert.equal(money(1_400_000)?.inr, 1_400_000, "plain number");
assert.equal(money("$150,000")?.currency, "USD", "dollar sign detected");
assert.equal(money("₹12L")?.currency, "INR", "rupee sign detected");
assert.equal(money("competitive"), null, "non-numeric string is not money");
assert.equal(money(""), null);
assert.equal(money(null), null);
assert.equal(money(-5), null, "negative is not a salary");

assert.equal(toAnnualInr(money("₹12,00,000")), 1_200_000);
assert.equal(toAnnualInr(money("₹45,000")), null, "a monthly figure is not an annual CTC");
assert.equal(toAnnualInr(money("$150,000")), null, "USD is dropped without an explicit rate");
assert.equal(toAnnualInr(money("$150,000"), 88), 13_200_000, "USD converts at the rate we're given");
assert.equal(toAnnualInr(money("₹99,00,00,000")), null, "absurd figure rejected");

assert.equal(matchCity("Bengaluru, Karnataka, India"), "Bangalore", "alias maps to the vocabulary");
assert.equal(matchCity("Gurugram"), "Gurgaon");
assert.equal(matchCity("Navi Mumbai"), "Mumbai", "longest alias wins");
assert.equal(matchCity("New Delhi"), "Delhi NCR");
assert.equal(matchCity("Remote - India"), "Remote (India)");
assert.equal(matchCity("London, UK"), null, "unknown city is dropped, not guessed");
assert.equal(matchCity(undefined), null);

assert.equal(matchRoleCategory("Senior UX Designer"), "Design");
assert.equal(matchRoleCategory("Engineering Manager"), "Management", "specific rule beats the generic engineer rule");
assert.equal(matchRoleCategory("Senior Software Engineer"), "Engineering");
assert.equal(matchRoleCategory("SDET II"), "QA");
assert.equal(matchRoleCategory("Data Scientist II"), "Data & AI");
assert.equal(matchRoleCategory("Site Reliability Engineer"), "DevOps & Infra");
assert.equal(matchRoleCategory("Head Chef"), null, "unmappable title is dropped");

assert.equal(matchYears("3-5 years"), 4);
assert.equal(matchYears("5+ yrs"), 5);
assert.equal(matchYears(7), 7);
assert.equal(matchYears("fresher"), null);

assert.equal(pickField({ Job_Title: "X" }, ["jobTitle"]), "X", "key lookup ignores case and punctuation");
assert.equal(pickField({ a: { salary: 100 } }, ["salary"]), 100, "looks into nested objects");
assert.equal(pickField({ salary: "" }, ["salary"]), undefined, "empty string is not a value");

const point = extractPoint({
  jobTitle: "Senior Backend Engineer",
  location: "Bengaluru, India",
  totalCompensation: "₹28,00,000",
  yearsOfExperience: "6-8 years",
});
assert.deepEqual(point, { role_category: "Engineering", city: "Bangalore", years: 7, ctc: 2_800_000 });
assert.equal(extractPoint({ jobTitle: "Engineer", salary: "competitive" }), null, "no salary, no point");
assert.equal(extractPoint({ title: "Head Chef", salary: "₹12,00,000" }), null, "no category, no point");

// Aggregation: company identity must not survive ingestion, since the coach is
// forbidden from claiming what a named employer pays.
const pts = Array.from({ length: 10 }, (_, i) => ({
  role_category: "Engineering" as const, city: "Bangalore", years: 7, ctc: 2_000_000 + i * 1_00_000,
}));
const [bucket] = aggregate(pts, 8);
assert.equal(bucket.sample_size, 10);
assert.equal(bucket.city, "Bangalore");
assert.deepEqual([bucket.min_years, bucket.max_years], [6, 9], "years land in a standard band");
assert.ok(bucket.p25 < bucket.p50 && bucket.p50 < bucket.p75, "percentiles ordered");
assert.ok(!("company" in bucket) && !("employer" in bucket), "no employer identity survives aggregation");
assert.deepEqual(aggregate(pts.slice(0, 7), 8), [], "a bucket under the minimum is not published");
// Currency guard: a row we cannot place in India could be in any currency, and
// levels.fyi returns US dollars as bare numbers with no marker at all.
assert.equal(
  extractPoint({ title: "Software Engineer", location: "Seattle, WA", totalCompensation: 300500 }),
  null,
  "a non-Indian location is dropped, never treated as rupees",
);
assert.equal(
  extractPoint({ title: "Software Engineer", location: "Bengaluru", totalCompensation: 2800000, market: "United States" }),
  null,
  "an explicit non-India market overrides a matching city name",
);
assert.equal(
  extractPoint({ title: "Software Engineer", location: "Bengaluru", salary: "$150,000" }),
  null,
  "an explicit USD figure is dropped without a conversion rate",
);
assert.ok(
  extractPoint({ title: "Software Engineer", location: "Bengaluru", totalCompensation: 2800000, market: "India" }),
  "an India-marked row still parses",
);
// AmbitionBox proves currency with a field and gives no location at all.
const ab = extractPoint({
  role: "Software Engineer", location: "", avg_salary: 1141155,
  salary_currency: "INR", salary_period: "yearly", experience_range: "3-9 years",
});
assert.ok(ab, "an explicit INR marker is proof enough without a city");
assert.equal(ab!.city, null, "no city means an all-India bucket");
assert.equal(ab!.ctc, 1141155);
assert.equal(
  extractPoint({ role: "Software Engineer", avg_salary: 95000, salary_currency: "INR", salary_period: "monthly" }),
  null,
  "a monthly figure is not annual CTC",
);
assert.equal(
  extractPoint({ title: "Software Engineer", salary: 300500 }),
  null,
  "no currency marker and no city: nothing proves this is rupees",
);

console.log("all checks passed");
