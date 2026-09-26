import {
  CITIES,
  NATIONAL_CITY_MULTIPLIER,
  cityBySlug,
  companyTypeBySlug,
  roleBySlug,
  type CompanyType,
} from "./data/taxonomy";

/**
 * Seed rows count for less than real reports. There are ~24 seed rows per
 * role x city x experience band, so a cohort starts with ~8 units of effective
 * weight from seed data; about ten real submissions are enough to outvote it.
 * Lower this as the real dataset grows.
 */
export const SEED_WEIGHT = 0.35;

/** Minimum effective (weight-summed) sample before a cohort is trusted. */
export const MIN_EFFECTIVE_SAMPLE = 8;

/** Experience band half-width, in years, for the tightest cohort. */
const EXP_BAND = 2.5;

/** Cap on how far a row is extrapolated along the experience curve. */
const MAX_EXP_SHIFT = 3;

export type CohortRow = {
  totalCompInr: number;
  yearsExperience: number;
  citySlug: string;
  companyType: string;
  source: string;
  trustScore: number;
};

export type BenchmarkQuery = {
  roleSlug: string;
  citySlug: string;
  yearsExperience: number;
  companyType?: CompanyType | string;
};

export type MatchLevel =
  | "role-city-experience"
  | "role-city"
  | "role-tier-experience"
  | "role-national-experience"
  | "role-national"
  | "none";

export type Percentiles = { p10: number; p25: number; p50: number; p75: number; p90: number };

export type Adjustment = { label: string; factor: number };

export type Benchmark = {
  matchLevel: MatchLevel;
  cohortLabel: string;
  /** Rows in the cohort, before weighting. */
  sampleSize: number;
  realSampleSize: number;
  seedSampleSize: number;
  /** Sum of weights — what the percentiles are actually based on. */
  effectiveSample: number;
  percentiles: Percentiles;
  confidence: "high" | "medium" | "low";
  adjustments: Adjustment[];
  /** True when the numbers rest mostly on generated reference data. */
  mostlySeedData: boolean;
};

const MATCH_ORDER: MatchLevel[] = [
  "role-city-experience",
  "role-city",
  "role-tier-experience",
  "role-national-experience",
  "role-national",
];

function weightOf(row: CohortRow): number {
  const trust = Number.isFinite(row.trustScore) ? Math.min(Math.max(row.trustScore, 0), 1) : 1;
  return (row.source === "seed" ? SEED_WEIGHT : 1) * trust;
}

function matches(row: CohortRow, q: BenchmarkQuery, level: MatchLevel): boolean {
  const city = cityBySlug(q.citySlug);
  const rowCity = cityBySlug(row.citySlug);
  const inBand = Math.abs(row.yearsExperience - q.yearsExperience) <= EXP_BAND;
  switch (level) {
    case "role-city-experience":
      return row.citySlug === q.citySlug && inBand;
    case "role-city":
      return row.citySlug === q.citySlug;
    case "role-tier-experience":
      return !!city && !!rowCity && rowCity.tier === city.tier && inBand;
    case "role-national-experience":
      return inBand;
    case "role-national":
      return true;
    default:
      return false;
  }
}

/**
 * Restates one row as "what this person would earn with the query's city and
 * years of experience", so a cohort assembled from nearby segments is actually
 * comparable instead of just being averaged together.
 */
function normalise(row: CohortRow, q: BenchmarkQuery, level: MatchLevel): number {
  const role = roleBySlug(q.roleSlug);
  let comp = row.totalCompInr;

  // City: only when the cohort reached beyond the queried city.
  if (level !== "role-city-experience" && level !== "role-city") {
    const from = cityBySlug(row.citySlug)?.multiplier ?? NATIONAL_CITY_MULTIPLIER;
    const to = cityBySlug(q.citySlug)?.multiplier ?? NATIONAL_CITY_MULTIPLIER;
    comp *= to / from;
  }

  // Experience: slide the row along the role's experience curve, but never far.
  if (role) {
    const rawShift = q.yearsExperience - row.yearsExperience;
    const shift = Math.min(Math.max(rawShift, -MAX_EXP_SHIFT), MAX_EXP_SHIFT);
    comp *= Math.pow(1 + role.expSlope, shift);
  }

  return comp;
}

/**
 * Weighted percentile with linear interpolation between neighbouring points.
 * `pairs` must be sorted ascending by value.
 */
export function weightedPercentile(pairs: { value: number; weight: number }[], q: number): number {
  if (pairs.length === 0) return 0;
  if (pairs.length === 1) return pairs[0].value;
  const total = pairs.reduce((s, p) => s + p.weight, 0);
  if (total <= 0) return pairs[Math.floor(pairs.length / 2)].value;

  const target = q * total;
  let cumulative = 0;
  for (let i = 0; i < pairs.length; i++) {
    const next = cumulative + pairs[i].weight;
    // Position each point at the midpoint of the weight it occupies.
    const mid = cumulative + pairs[i].weight / 2;
    if (target <= mid) {
      if (i === 0) return pairs[0].value;
      const prevMid = cumulative - pairs[i - 1].weight / 2;
      const span = mid - prevMid;
      const t = span === 0 ? 0 : (target - prevMid) / span;
      return pairs[i - 1].value + t * (pairs[i].value - pairs[i - 1].value);
    }
    cumulative = next;
  }
  return pairs[pairs.length - 1].value;
}

/** Where a salary sits in the cohort distribution, as a 0-100 percentile. */
export function percentileRank(pairs: { value: number; weight: number }[], value: number): number {
  const total = pairs.reduce((s, p) => s + p.weight, 0);
  if (total <= 0) return 50;
  let below = 0;
  for (const p of pairs) {
    if (p.value < value) below += p.weight;
    else if (p.value === value) below += p.weight / 2;
  }
  return Math.round((below / total) * 100);
}

function cohortLabelFor(level: MatchLevel, q: BenchmarkQuery): string {
  const role = roleBySlug(q.roleSlug)?.label ?? q.roleSlug;
  const city = cityBySlug(q.citySlug);
  const yrs = `${Math.max(0, q.yearsExperience - EXP_BAND).toFixed(0)}-${(q.yearsExperience + EXP_BAND).toFixed(0)} yrs`;
  switch (level) {
    case "role-city-experience":
      return `${role} in ${city?.label ?? q.citySlug}, ${yrs}`;
    case "role-city":
      return `${role} in ${city?.label ?? q.citySlug}, all experience levels`;
    case "role-tier-experience":
      return `${role} in tier-${city?.tier ?? "?"} cities, ${yrs} (adjusted to ${city?.label})`;
    case "role-national-experience":
      return `${role} across India, ${yrs} (adjusted to ${city?.label})`;
    case "role-national":
      return `${role} across India, all experience levels (adjusted to ${city?.label})`;
    default:
      return `${role} — not enough data`;
  }
}

const EMPTY_PERCENTILES: Percentiles = { p10: 0, p25: 0, p50: 0, p75: 0, p90: 0 };

/**
 * Builds the market benchmark for one query.
 *
 * Cohorts are widened step by step — exact city+experience first, then the city
 * tier, then national — until there is enough effective sample. The level that
 * was actually used is reported so the UI can be honest about it rather than
 * presenting a thin cohort as fact.
 */
export function computeBenchmark(rows: CohortRow[], q: BenchmarkQuery): Benchmark {
  const roleRows = rows.filter((r) => r.trustScore > 0);

  for (const level of MATCH_ORDER) {
    const cohort = roleRows.filter((r) => matches(r, q, level));
    const pairs = cohort
      .map((r) => ({ value: normalise(r, q, level), weight: weightOf(r) }))
      .sort((a, b) => a.value - b.value);
    const effective = pairs.reduce((s, p) => s + p.weight, 0);
    if (effective < MIN_EFFECTIVE_SAMPLE && level !== "role-national") continue;
    if (cohort.length === 0) continue;

    const realCount = cohort.filter((r) => r.source !== "seed").length;
    const seedCount = cohort.length - realCount;
    const realWeight = cohort
      .filter((r) => r.source !== "seed")
      .reduce((s, r) => s + weightOf(r), 0);

    const adjustments: Adjustment[] = [];
    if (level !== "role-city-experience" && level !== "role-city") {
      adjustments.push({
        label: `Cost-of-market adjustment to ${cityBySlug(q.citySlug)?.label ?? q.citySlug}`,
        factor: (cityBySlug(q.citySlug)?.multiplier ?? NATIONAL_CITY_MULTIPLIER) / NATIONAL_CITY_MULTIPLIER,
      });
    }
    adjustments.push({
      label: `Normalised to ${q.yearsExperience} years of experience`,
      factor: 1,
    });

    return {
      matchLevel: level,
      cohortLabel: cohortLabelFor(level, q),
      sampleSize: cohort.length,
      realSampleSize: realCount,
      seedSampleSize: seedCount,
      effectiveSample: round1(effective),
      percentiles: {
        p10: Math.round(weightedPercentile(pairs, 0.1)),
        p25: Math.round(weightedPercentile(pairs, 0.25)),
        p50: Math.round(weightedPercentile(pairs, 0.5)),
        p75: Math.round(weightedPercentile(pairs, 0.75)),
        p90: Math.round(weightedPercentile(pairs, 0.9)),
      },
      confidence: confidenceFor(level, effective, realWeight),
      adjustments,
      mostlySeedData: realWeight < effective / 2,
    };
  }

  return {
    matchLevel: "none",
    cohortLabel: cohortLabelFor("none", q),
    sampleSize: 0,
    realSampleSize: 0,
    seedSampleSize: 0,
    effectiveSample: 0,
    percentiles: EMPTY_PERCENTILES,
    confidence: "low",
    adjustments: [],
    mostlySeedData: true,
  };
}

function confidenceFor(level: MatchLevel, effective: number, realWeight: number): "high" | "medium" | "low" {
  const tight = level === "role-city-experience";
  if (tight && effective >= 25 && realWeight >= 12) return "high";
  if (effective >= 15 && realWeight >= 5) return "medium";
  if (tight && effective >= 20) return "medium";
  return "low";
}

export type FairRange = {
  /** Single best estimate for this specific person, INR. */
  point: number;
  /** Defensible ask range: the band a recruiter would not blink at. */
  low: number;
  high: number;
  /** The market distribution the range was derived from. */
  benchmark: Benchmark;
  adjustments: Adjustment[];
  method: string;
};

/**
 * Predicts a fair range for one individual rather than quoting a cohort average.
 *
 * On top of the cohort percentiles (already normalised for city and experience)
 * this applies the company-type multiplier, because the same role pays very
 * differently at an IT services firm and at a global product company. Every
 * factor applied is returned in `adjustments` so the number can be explained
 * to a user — or argued with.
 */
export function predictFairRange(rows: CohortRow[], q: BenchmarkQuery): FairRange {
  const benchmark = computeBenchmark(rows, q);
  const adjustments: Adjustment[] = [...benchmark.adjustments];

  let factor = 1;
  if (q.companyType) {
    const target = companyTypeBySlug(q.companyType as CompanyType);
    const cohort = rows.filter((r) => r.trustScore > 0);
    // Mean multiplier of the cohort, so we shift *relative* to its mix rather
    // than applying the target multiplier twice.
    const cohortMean =
      cohort.length > 0
        ? cohort.reduce((s, r) => s + (companyTypeBySlug(r.companyType as CompanyType)?.multiplier ?? 1), 0) /
          cohort.length
        : 1;
    if (target && cohortMean > 0) {
      // Damped: company type explains a lot but not everything, and a raw
      // 1.55x on top of a thin cohort produces numbers nobody will believe.
      const raw = target.multiplier / cohortMean;
      factor = 1 + (raw - 1) * 0.6;
      adjustments.push({ label: `Company type: ${target.label}`, factor: round3(factor) });
    }
  }

  const point = Math.round(benchmark.percentiles.p50 * factor);
  const low = Math.round(benchmark.percentiles.p25 * factor);
  const high = Math.round(benchmark.percentiles.p75 * factor);

  return {
    point,
    low,
    high,
    benchmark,
    adjustments,
    method:
      "Weighted percentiles of comparable reports, normalised to your city and years of experience, then adjusted for company type. Seed reference rows are weighted at " +
      SEED_WEIGHT +
      " against real reports.",
  };
}

/** Cohort pairs for percentile-rank queries, using the same normalisation. */
export function cohortPairs(rows: CohortRow[], q: BenchmarkQuery, level: MatchLevel) {
  return rows
    .filter((r) => r.trustScore > 0 && matches(r, q, level))
    .map((r) => ({ value: normalise(r, q, level), weight: weightOf(r) }))
    .sort((a, b) => a.value - b.value);
}

export const ALL_CITY_SLUGS = CITIES.map((c) => c.slug);

const round1 = (n: number) => Math.round(n * 10) / 10;
const round3 = (n: number) => Math.round(n * 1000) / 1000;
