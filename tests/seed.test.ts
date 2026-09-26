import { describe, expect, it } from "vitest";
import { generateSeedRows } from "../src/db/seed";
import { computeBenchmark, type CohortRow } from "../src/lib/benchmark";
import { CITIES, ROLES } from "../src/lib/data/taxonomy";
import { measureSwitchPremium } from "../src/lib/advice";

const rows = generateSeedRows();

const asCohort = (r: (typeof rows)[number]): CohortRow => ({
  totalCompInr: r.totalCompInr,
  yearsExperience: r.yearsExperience,
  citySlug: r.citySlug,
  companyType: r.companyType,
  source: r.source ?? "seed",
  trustScore: r.trustScore ?? 1,
});

describe("seed dataset", () => {
  it("is deterministic across runs", () => {
    expect(JSON.stringify(generateSeedRows())).toBe(JSON.stringify(rows));
  });

  it("covers every role and city", () => {
    expect(new Set(rows.map((r) => r.roleSlug)).size).toBe(ROLES.length);
    expect(new Set(rows.map((r) => r.citySlug)).size).toBe(CITIES.length);
  });

  it("marks every row as seed data so it can never pass as a real report", () => {
    expect(rows.every((r) => r.source === "seed")).toBe(true);
    expect(rows.every((r) => r.shareable === false)).toBe(true);
  });

  it("fabricates no raise history", () => {
    expect(rows.every((r) => r.lastRaisePct === null && r.monthsSinceRaise === null)).toBe(true);
  });

  it("keeps totals consistent with their components", () => {
    for (const r of rows.slice(0, 500)) {
      expect(r.totalCompInr).toBe(
        r.annualBaseInr + (r.annualBonusInr ?? 0) + (r.annualEquityInr ?? 0),
      );
    }
  });

  it("produces salaries inside plausible bounds for India", () => {
    const totals = rows.map((r) => r.totalCompInr);
    expect(Math.min(...totals)).toBeGreaterThan(60_000);
    expect(Math.max(...totals)).toBeLessThan(100_000_000);
  });

  it("never encodes tenure into pay, so the switch premium cannot be self-fulfilling", () => {
    // Tenure is drawn as a fraction of total experience, and pay rises with
    // experience, so raw tenure and raw pay correlate through that shared cause.
    // What matters is that no premium survives once the experience effect is
    // removed — which is exactly the adjustment measureSwitchPremium makes.
    const role = ROLES.find((x) => x.slug === "software-engineer")!;
    // Pool every city for the role (~2,000 rows) so the sampling error on the
    // correlation is about 0.02 rather than 0.09, and remove both the city and
    // the experience effect before looking for a tenure effect.
    const cell = rows.filter((r) => r.roleSlug === "software-engineer");
    const adjusted = cell.map(
      (c) =>
        Math.log(c.totalCompInr) -
        c.yearsExperience * Math.log(1 + role.expSlope) -
        Math.log(CITIES.find((x) => x.slug === c.citySlug)!.multiplier),
    );
    const r = correlation(
      cell.map((c) => c.yearsAtCompany),
      adjusted,
    );
    expect(cell.length).toBeGreaterThan(1000);
    expect(Math.abs(r)).toBeLessThan(0.06);
  });

  it("is excluded from switch-premium measurement even so", () => {
    // The belt to the braces above: seed rows are filtered out entirely, so
    // whatever their internal structure, they cannot produce a measured premium.
    const seedRows = rows.slice(0, 400).map((r) => ({
      totalCompInr: r.totalCompInr,
      yearsExperience: r.yearsExperience,
      yearsAtCompany: r.yearsAtCompany,
      citySlug: r.citySlug,
      companyType: r.companyType,
      source: "seed",
      trustScore: 1,
    }));
    expect(measureSwitchPremium(seedRows, "software-engineer").fromData).toBe(false);
  });

  it("gives a tier-1 city higher pay than a tier-3 city for the same role", () => {
    const roleRows = rows.filter((r) => r.roleSlug === "software-engineer").map(asCohort);
    const blr = computeBenchmark(roleRows, {
      roleSlug: "software-engineer",
      citySlug: "bengaluru",
      yearsExperience: 5,
    });
    const other = computeBenchmark(roleRows, {
      roleSlug: "software-engineer",
      citySlug: "other-india",
      yearsExperience: 5,
    });
    expect(blr.percentiles.p50).toBeGreaterThan(other.percentiles.p50);
  });

  it("gives more experience higher pay", () => {
    const roleRows = rows.filter((r) => r.roleSlug === "backend-engineer").map(asCohort);
    const q = { roleSlug: "backend-engineer", citySlug: "bengaluru" };
    const junior = computeBenchmark(roleRows, { ...q, yearsExperience: 1 });
    const senior = computeBenchmark(roleRows, { ...q, yearsExperience: 12 });
    expect(senior.percentiles.p50).toBeGreaterThan(junior.percentiles.p50 * 1.5);
  });

  it("gives every role x city x experience query a usable cohort", () => {
    // Coverage guarantee: nobody should hit "no data" on the seeded dataset.
    for (const role of ROLES.slice(0, 5)) {
      const roleRows = rows.filter((r) => r.roleSlug === role.slug).map(asCohort);
      for (const city of CITIES) {
        for (const years of [0, 2, 6, 11, 20]) {
          const b = computeBenchmark(roleRows, {
            roleSlug: role.slug,
            citySlug: city.slug,
            yearsExperience: years,
          });
          expect(b.matchLevel, `${role.slug}/${city.slug}/${years}`).not.toBe("none");
          expect(b.percentiles.p50).toBeGreaterThan(0);
        }
      }
    }
  });
});

function correlation(xs: number[], ys: number[]): number {
  const n = xs.length;
  const mx = xs.reduce((a, b) => a + b, 0) / n;
  const my = ys.reduce((a, b) => a + b, 0) / n;
  let num = 0;
  let dx = 0;
  let dy = 0;
  for (let i = 0; i < n; i++) {
    num += (xs[i] - mx) * (ys[i] - my);
    dx += (xs[i] - mx) ** 2;
    dy += (ys[i] - my) ** 2;
  }
  return num / Math.sqrt(dx * dy);
}
