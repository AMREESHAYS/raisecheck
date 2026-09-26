/**
 * Generates the seed benchmark dataset.
 *
 * WHY THIS EXISTS: a salary platform is worthless on day one, because there is
 * no data to compare anyone against. These rows give the product something to
 * reason about immediately. They are GENERATED FROM DOCUMENTED ASSUMPTIONS —
 * role reference medians, city multipliers and company-type multipliers in
 * src/lib/data/taxonomy.ts — and are not observations of real salaries.
 *
 * Three things keep them honest:
 *   - every row is marked source='seed' and shown to users as reference data;
 *   - seed rows carry SEED_WEIGHT (0.35) in every percentile calculation, so
 *     real reports outvote them quickly;
 *   - the job-switch premium is never measured from seed rows, so the platform
 *     cannot read its own assumptions back out as if they were findings.
 *
 * Deterministic: the same command always produces the same dataset.
 *
 * Usage: npm run db:seed        (add --reset to clear existing seed rows first)
 */
import { eq } from "drizzle-orm";
import { getDb } from "./index";
import { submissions, type NewSubmission } from "./schema";
import { CITIES, COMPANY_TYPES, ROLES, levelForYears, type CompanyType } from "../lib/data/taxonomy";

/** Experience anchors, chosen so the +-2.5yr benchmark band always has neighbours. */
const EXPERIENCE_ANCHORS = [1, 3, 5, 8, 12, 18];

/** Rows per role x city x anchor cell. 20 x 0.35 = 7 units of seed weight per cell. */
const ROWS_PER_CELL = 20;

/** Reference median is quoted at this many years of experience. */
const REFERENCE_YEARS = 3;

/** Deterministic PRNG (mulberry32) so a rerun reproduces the dataset exactly. */
function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hashString(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** Box-Muller, for log-normal salary spread. */
function normal(next: () => number): number {
  let u = 0;
  let v = 0;
  while (u === 0) u = next();
  while (v === 0) v = next();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

/** Company-type mix, which differs sharply by city tier. */
function companyMixFor(tier: number): { slug: CompanyType; share: number }[] {
  if (tier === 1) {
    return [
      { slug: "indian-it-services", share: 0.26 },
      { slug: "funded-startup", share: 0.2 },
      { slug: "gcc-captive", share: 0.18 },
      { slug: "global-product-mnc", share: 0.08 },
      { slug: "domestic-enterprise", share: 0.14 },
      { slug: "bootstrapped-startup", share: 0.09 },
      { slug: "psu-government", share: 0.03 },
      { slug: "ngo-academia", share: 0.02 },
    ];
  }
  if (tier === 2) {
    return [
      { slug: "indian-it-services", share: 0.34 },
      { slug: "domestic-enterprise", share: 0.22 },
      { slug: "bootstrapped-startup", share: 0.14 },
      { slug: "funded-startup", share: 0.1 },
      { slug: "gcc-captive", share: 0.08 },
      { slug: "psu-government", share: 0.08 },
      { slug: "ngo-academia", share: 0.03 },
      { slug: "global-product-mnc", share: 0.01 },
    ];
  }
  return [
    { slug: "domestic-enterprise", share: 0.3 },
    { slug: "indian-it-services", share: 0.24 },
    { slug: "bootstrapped-startup", share: 0.16 },
    { slug: "psu-government", share: 0.14 },
    { slug: "ngo-academia", share: 0.08 },
    { slug: "funded-startup", share: 0.06 },
    { slug: "gcc-captive", share: 0.02 },
  ];
}

function pickWeighted<T extends { share: number }>(items: T[], next: () => number): T {
  const total = items.reduce((s, i) => s + i.share, 0);
  let r = next() * total;
  for (const item of items) {
    r -= item.share;
    if (r <= 0) return item;
  }
  return items[items.length - 1];
}

/** Typical cash bonus as a fraction of base, by company type. */
const BONUS_RATE: Record<string, number> = {
  "global-product-mnc": 0.15,
  "gcc-captive": 0.12,
  "funded-startup": 0.08,
  "indian-it-services": 0.07,
  "domestic-enterprise": 0.1,
  "bootstrapped-startup": 0.04,
  "psu-government": 0.05,
  "ngo-academia": 0.02,
  other: 0.06,
};

/** Share of people who get equity at all, and its typical size vs base. */
const EQUITY: Record<string, { probability: number; rate: number }> = {
  "global-product-mnc": { probability: 0.9, rate: 0.35 },
  "funded-startup": { probability: 0.6, rate: 0.18 },
  "gcc-captive": { probability: 0.35, rate: 0.12 },
  "bootstrapped-startup": { probability: 0.15, rate: 0.06 },
  "indian-it-services": { probability: 0.08, rate: 0.04 },
  "domestic-enterprise": { probability: 0.1, rate: 0.05 },
  "psu-government": { probability: 0, rate: 0 },
  "ngo-academia": { probability: 0, rate: 0 },
  other: { probability: 0.1, rate: 0.08 },
};

export function generateSeedRows(): NewSubmission[] {
  const rows: NewSubmission[] = [];

  for (const role of ROLES) {
    for (const city of CITIES) {
      const mix = companyMixFor(city.tier);
      for (const anchor of EXPERIENCE_ANCHORS) {
        const next = rng(hashString(`${role.slug}|${city.slug}|${anchor}`));

        for (let i = 0; i < ROWS_PER_CELL; i++) {
          const company = pickWeighted(mix, next);
          const companyDef = COMPANY_TYPES.find((c) => c.slug === company.slug)!;

          // Spread experience inside the cell so cohorts are not spiky.
          const years = Math.max(0, round1(anchor + (next() - 0.5) * 2));

          const expected =
            role.baseP50 *
            city.multiplier *
            companyDef.multiplier *
            Math.pow(1 + role.expSlope, years - REFERENCE_YEARS);

          // Company type already explains part of the variance, so the residual
          // spread is narrower than the role's overall spread.
          const sigma = role.spread * 0.6;
          const totalTarget = expected * Math.exp(normal(next) * sigma - (sigma * sigma) / 2);

          const bonusRate = BONUS_RATE[company.slug] ?? 0.06;
          const equityCfg = EQUITY[company.slug] ?? { probability: 0.1, rate: 0.08 };
          const hasEquity = next() < equityCfg.probability;
          const equityRate = hasEquity ? equityCfg.rate * (0.5 + next()) : 0;

          // totalTarget = base * (1 + bonusRate + equityRate)
          const base = Math.round(totalTarget / (1 + bonusRate + equityRate) / 1000) * 1000;
          const bonus = Math.round((base * bonusRate) / 1000) * 1000;
          const equity = Math.round((base * equityRate) / 1000) * 1000;

          // Tenure is drawn independently of pay: encoding a switch premium here
          // would make the platform "discover" an assumption we put in ourselves.
          const yearsAtCompany = round1(Math.min(years, next() * Math.min(years, 6)));

          rows.push({
            roleSlug: role.slug,
            levelSlug: levelForYears(years),
            citySlug: city.slug,
            companyType: company.slug,
            yearsExperience: years,
            yearsAtCompany,
            annualBaseInr: base,
            annualBonusInr: bonus,
            annualEquityInr: equity,
            totalCompInr: base + bonus + equity,
            lastRaisePct: null,
            monthsSinceRaise: null,
            source: "seed",
            status: "approved",
            trustScore: 1,
            fingerprint: null,
            shareable: false,
          });
        }
      }
    }
  }

  return rows;
}

const round1 = (n: number) => Math.round(n * 10) / 10;

async function main() {
  const reset = process.argv.includes("--reset");
  const db = await getDb();

  if (reset) {
    await db.delete(submissions).where(eq(submissions.source, "seed"));
    console.log("Cleared existing seed rows.");
  }

  const existing = await db.select({ id: submissions.id }).from(submissions).limit(1);
  const alreadySeeded = await db
    .select({ id: submissions.id })
    .from(submissions)
    .where(eq(submissions.source, "seed"))
    .limit(1);

  if (alreadySeeded.length > 0) {
    console.log("Seed rows already present. Re-run with --reset to regenerate.");
    return;
  }

  const rows = generateSeedRows();
  console.log(`Inserting ${rows.length} seed rows...`);

  const chunk = 500;
  for (let i = 0; i < rows.length; i += chunk) {
    await db.insert(submissions).values(rows.slice(i, i + chunk));
    if ((i / chunk) % 20 === 0) process.stdout.write(`  ${i}/${rows.length}\r`);
  }

  console.log(`\nDone. ${rows.length} seed rows inserted (existing rows kept: ${existing.length > 0}).`);
  process.exit(0);
}

// Run only when executed directly, not when imported by tests.
if (process.argv[1] && /(^|[\\/])seed\.(ts|js)$/.test(process.argv[1])) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
