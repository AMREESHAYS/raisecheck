import { describe, expect, it } from "vitest";
import {
  MIN_EFFECTIVE_SAMPLE,
  SEED_WEIGHT,
  computeBenchmark,
  percentileRank,
  predictFairRange,
  weightedPercentile,
  type CohortRow,
} from "../src/lib/benchmark";

const row = (over: Partial<CohortRow> = {}): CohortRow => ({
  totalCompInr: 1_500_000,
  yearsExperience: 4,
  citySlug: "bengaluru",
  companyType: "funded-startup",
  source: "user",
  trustScore: 1,
  ...over,
});

function many(n: number, over: Partial<CohortRow> = {}, step = 50_000): CohortRow[] {
  const base = over.totalCompInr ?? 1_000_000;
  return Array.from({ length: n }, (_, i) => row({ ...over, totalCompInr: base + i * step }));
}

describe("weightedPercentile", () => {
  it("returns the only value for a single point", () => {
    expect(weightedPercentile([{ value: 500, weight: 1 }], 0.5)).toBe(500);
  });

  it("returns a median between the two central values of an even set", () => {
    const pairs = [100, 200, 300, 400].map((value) => ({ value, weight: 1 }));
    expect(weightedPercentile(pairs, 0.5)).toBeCloseTo(250, 6);
  });

  it("is monotonic in the requested quantile", () => {
    const pairs = many(20).map((r) => ({ value: r.totalCompInr, weight: 1 }));
    const qs = [0.1, 0.25, 0.5, 0.75, 0.9].map((q) => weightedPercentile(pairs, q));
    for (let i = 1; i < qs.length; i++) expect(qs[i]).toBeGreaterThanOrEqual(qs[i - 1]);
  });

  it("lets weight move the median", () => {
    const pairs = [
      { value: 100, weight: 1 },
      { value: 900, weight: 20 },
    ];
    expect(weightedPercentile(pairs, 0.5)).toBeGreaterThan(500);
  });
});

describe("percentileRank", () => {
  it("places a salary in the distribution", () => {
    const pairs = [100, 200, 300, 400].map((value) => ({ value, weight: 1 }));
    expect(percentileRank(pairs, 50)).toBe(0);
    expect(percentileRank(pairs, 500)).toBe(100);
    expect(percentileRank(pairs, 250)).toBe(50);
  });
});

describe("computeBenchmark cohort widening", () => {
  const query = {
    roleSlug: "software-engineer",
    citySlug: "bengaluru",
    yearsExperience: 4,
  };

  it("reports 'none' with an empty dataset instead of inventing numbers", () => {
    const b = computeBenchmark([], query);
    expect(b.matchLevel).toBe("none");
    expect(b.percentiles.p50).toBe(0);
    expect(b.confidence).toBe("low");
  });

  it("uses the tightest cohort when the exact segment has enough data", () => {
    const b = computeBenchmark(many(20, { citySlug: "bengaluru", yearsExperience: 4 }), query);
    expect(b.matchLevel).toBe("role-city-experience");
    expect(b.effectiveSample).toBeGreaterThanOrEqual(MIN_EFFECTIVE_SAMPLE);
  });

  it("widens beyond the city when the exact segment is thin", () => {
    // Only 3 rows in Bengaluru, but plenty in another tier-1 city.
    const rows = [
      ...many(3, { citySlug: "bengaluru", yearsExperience: 4 }),
      ...many(20, { citySlug: "pune", yearsExperience: 4 }),
    ];
    const b = computeBenchmark(rows, query);
    expect(b.matchLevel).not.toBe("role-city-experience");
    expect(b.matchLevel).not.toBe("none");
  });

  it("scales pay up when rescuing a cohort from a cheaper city", () => {
    // Pune pays ~0.90 of Bengaluru; a Bengaluru query should be adjusted upward.
    const rows = many(20, { citySlug: "pune", yearsExperience: 4 }, 0);
    const b = computeBenchmark(rows, query);
    expect(b.percentiles.p50).toBeGreaterThan(1_000_000);
    expect(b.adjustments.some((a) => /adjustment to Bengaluru/i.test(a.label))).toBe(true);
  });

  it("weights seed rows below real reports", () => {
    const seeded = many(20, { source: "seed" }, 0);
    const b = computeBenchmark(seeded, query);
    expect(b.effectiveSample).toBeCloseTo(20 * SEED_WEIGHT, 5);
    expect(b.mostlySeedData).toBe(true);
    expect(b.seedSampleSize).toBe(20);
    expect(b.realSampleSize).toBe(0);
  });

  it("lets real reports outvote seed rows once there are enough of them", () => {
    const rows = [
      ...many(20, { source: "seed", totalCompInr: 800_000 }, 0),
      ...many(20, { source: "user", totalCompInr: 2_000_000 }, 0),
    ];
    const b = computeBenchmark(rows, { ...query, yearsExperience: 4 });
    expect(b.mostlySeedData).toBe(false);
    // Real rows carry ~2.9x the weight, so the median sits near them.
    expect(b.percentiles.p50).toBeGreaterThan(1_600_000);
  });

  it("ignores rows whose trust score is zero", () => {
    const rows = [...many(20, { trustScore: 0, totalCompInr: 50_000_000 }, 0), ...many(20)];
    const b = computeBenchmark(rows, query);
    expect(b.percentiles.p90).toBeLessThan(10_000_000);
  });

  it("normalises experience so a senior query is not dragged down by juniors", () => {
    const juniors = many(20, { yearsExperience: 2 }, 0);
    const low = computeBenchmark(juniors, { ...query, yearsExperience: 2 });
    const high = computeBenchmark(juniors, { ...query, yearsExperience: 4.5 });
    expect(high.percentiles.p50).toBeGreaterThan(low.percentiles.p50);
  });
});

describe("predictFairRange", () => {
  const query = {
    roleSlug: "software-engineer",
    citySlug: "bengaluru",
    yearsExperience: 4,
  };

  it("returns an ordered low/point/high band", () => {
    const f = predictFairRange(many(30), query);
    expect(f.low).toBeLessThanOrEqual(f.point);
    expect(f.point).toBeLessThanOrEqual(f.high);
  });

  it("predicts more for a global product company than for IT services", () => {
    const rows = many(30);
    const mnc = predictFairRange(rows, { ...query, companyType: "global-product-mnc" });
    const services = predictFairRange(rows, { ...query, companyType: "indian-it-services" });
    expect(mnc.point).toBeGreaterThan(services.point);
  });

  it("lists every adjustment it applied so the number can be explained", () => {
    const f = predictFairRange(many(30), { ...query, companyType: "gcc-captive" });
    expect(f.adjustments.length).toBeGreaterThan(0);
    expect(f.adjustments.some((a) => /Company type/.test(a.label))).toBe(true);
    expect(f.method).toContain("percentile");
  });

  it("does not fabricate a range from no data", () => {
    const f = predictFairRange([], query);
    expect(f.point).toBe(0);
    expect(f.benchmark.matchLevel).toBe("none");
  });
});
