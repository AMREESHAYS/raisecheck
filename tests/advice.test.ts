import { describe, expect, it } from "vitest";
import { assess, measureSwitchPremium, type AdviceRow } from "../src/lib/advice";

const mkRow = (over: Partial<AdviceRow> = {}): AdviceRow => ({
  totalCompInr: 2_000_000,
  yearsExperience: 5,
  yearsAtCompany: 2,
  citySlug: "bengaluru",
  companyType: "funded-startup",
  source: "user",
  trustScore: 1,
  ...over,
});

/** A realistic cohort: 40 reports spread around 20L for a 5-year engineer. */
function market(centre = 2_000_000, n = 40): AdviceRow[] {
  return Array.from({ length: n }, (_, i) =>
    mkRow({ totalCompInr: Math.round(centre * (0.7 + (i / n) * 0.7)) }),
  );
}

const query = {
  roleSlug: "software-engineer",
  citySlug: "bengaluru",
  yearsExperience: 5,
  companyType: "funded-startup",
};

describe("measureSwitchPremium", () => {
  it("falls back to the documented default when data is thin", () => {
    const p = measureSwitchPremium(market().slice(0, 4), "software-engineer");
    expect(p.fromData).toBe(false);
    expect(p.premiumPct).toBe(20);
  });

  it("never measures a premium from seed rows", () => {
    const seeded = market().map((r) => ({
      ...r,
      source: "seed",
      yearsAtCompany: r.totalCompInr > 2_000_000 ? 0.5 : 5,
    }));
    const p = measureSwitchPremium(seeded, "software-engineer");
    expect(p.fromData).toBe(false);
  });

  it("measures the premium when recent joiners really do earn more", () => {
    const rows: AdviceRow[] = [
      ...Array.from({ length: 10 }, () => mkRow({ yearsAtCompany: 0.5, totalCompInr: 2_400_000 })),
      ...Array.from({ length: 10 }, () => mkRow({ yearsAtCompany: 5, totalCompInr: 2_000_000 })),
    ];
    const p = measureSwitchPremium(rows, "software-engineer");
    expect(p.fromData).toBe(true);
    expect(p.premiumPct).toBeGreaterThan(15);
    expect(p.premiumPct).toBeLessThan(25);
  });
});

describe("assess", () => {
  it("tells a well-paid person to hold rather than manufacturing a grievance", () => {
    const a = assess(market(), { ...query, currentTotalInr: 2_600_000 });
    expect(a.verdict).not.toBe("underpaid");
    expect(a.action).toBe("hold");
    expect(a.gapPct).toBeLessThanOrEqual(5);
  });

  it("recommends negotiating for a modest gap", () => {
    const a = assess(market(), { ...query, currentTotalInr: 1_800_000 });
    expect(a.verdict).toBe("underpaid");
    expect(["negotiate", "negotiate-then-switch"]).toContain(a.action);
  });

  it("recommends switching when the gap exceeds what a raise can clear", () => {
    const a = assess(market(), { ...query, currentTotalInr: 1_000_000 });
    expect(a.verdict).toBe("underpaid");
    expect(["switch", "negotiate-then-switch"]).toContain(a.action);
    expect(a.gapPct).toBeGreaterThan(25);
  });

  it("caps the internal ask at what a manager can plausibly approve", () => {
    const a = assess(market(), { ...query, currentTotalInr: 800_000 });
    expect(a.internalAskInr).toBeLessThanOrEqual(Math.round(800_000 * 1.25));
    expect(a.switchTargetInr).toBeGreaterThan(a.internalAskInr);
  });

  it("escalates a fairly-paid person whose salary has gone stale", () => {
    const a = assess(market(), {
      ...query,
      currentTotalInr: 2_600_000,
      lastRaisePct: 0,
      monthsSinceRaise: 30,
    });
    expect(a.action).not.toBe("hold");
    expect(a.reasons.join(" ")).toMatch(/inflation|raise/i);
  });

  it("surfaces a real-terms pay cut when a raise trailed inflation", () => {
    const a = assess(market(), {
      ...query,
      currentTotalInr: 2_000_000,
      lastRaisePct: 2,
      monthsSinceRaise: 12,
    });
    expect(a.realRaise?.losingGround).toBe(true);
    expect(a.reasons.join(" ")).toMatch(/real terms/i);
  });

  it("warns loudly when the comparison rests on seed data", () => {
    const seeded = market().map((r) => ({ ...r, source: "seed" }));
    const a = assess(seeded, { ...query, currentTotalInr: 1_500_000 });
    expect(a.fairRange.benchmark.mostlySeedData).toBe(true);
    expect(a.caveats.join(" ")).toMatch(/reference ranges|indication/i);
  });

  it("reports the user's percentile in the market", () => {
    const low = assess(market(), { ...query, currentTotalInr: 1_500_000 });
    const high = assess(market(), { ...query, currentTotalInr: 2_700_000 });
    expect(low.marketPercentile).toBeLessThan(high.marketPercentile);
    expect(low.marketPercentile).toBeGreaterThanOrEqual(0);
    expect(high.marketPercentile).toBeLessThanOrEqual(100);
  });

  it("does not claim a verdict when there is no data at all", () => {
    const a = assess([], { ...query, currentTotalInr: 1_500_000 });
    expect(a.fairRange.benchmark.matchLevel).toBe("none");
    expect(a.fairRange.point).toBe(0);
  });
});
