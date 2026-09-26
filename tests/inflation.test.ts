import { describe, expect, it } from "vitest";
import {
  INDIA_CPI_INFLATION,
  cumulativeInflationFactor,
  realRaise,
} from "../src/lib/data/inflation";

describe("cumulativeInflationFactor", () => {
  it("is 1 for a zero-length window", () => {
    expect(cumulativeInflationFactor(0, 2024)).toBe(1);
  });

  it("matches the single-year CPI figure over 12 months", () => {
    const cpi2024 = INDIA_CPI_INFLATION.find((y) => y.year === 2024)!.cpiInflationPct;
    expect(cumulativeInflationFactor(12, 2024)).toBeCloseTo(1 + cpi2024 / 100, 6);
  });

  it("compounds across years rather than adding", () => {
    const twoYears = cumulativeInflationFactor(24, 2024);
    const a = 1 + INDIA_CPI_INFLATION.find((y) => y.year === 2024)!.cpiInflationPct / 100;
    const b = 1 + INDIA_CPI_INFLATION.find((y) => y.year === 2023)!.cpiInflationPct / 100;
    expect(twoYears).toBeCloseTo(a * b, 6);
    expect(twoYears).toBeGreaterThan(a + b - 1); // strictly more than simple addition
  });

  it("holds the nearest known year outside the series instead of extrapolating", () => {
    const earliest = Math.min(...INDIA_CPI_INFLATION.map((y) => y.year));
    expect(cumulativeInflationFactor(12, earliest - 5)).toBeCloseTo(
      1 + INDIA_CPI_INFLATION.find((y) => y.year === earliest)!.cpiInflationPct / 100,
      6,
    );
  });
});

describe("realRaise", () => {
  it("reports a real pay cut when a raise trails inflation", () => {
    const cpi = INDIA_CPI_INFLATION.find((y) => y.year === 2024)!.cpiInflationPct;
    const result = realRaise(1_000_000, cpi - 2, 12, 2024);
    expect(result.losingGround).toBe(true);
    expect(result.realRaisePct).toBeLessThan(0);
  });

  it("reports real gains when a raise beats inflation", () => {
    const result = realRaise(1_000_000, 20, 12, 2024);
    expect(result.losingGround).toBe(false);
    expect(result.realRaisePct).toBeGreaterThan(10);
  });

  it("computes the break-even salary needed just to stand still", () => {
    const result = realRaise(1_050_000, 5, 12, 2024);
    // Previous salary was 1,000,000; break-even is that grown by inflation.
    const expected = 1_000_000 * cumulativeInflationFactor(12, 2024);
    expect(result.breakEvenSalary).toBeCloseTo(Math.round(expected), -2);
  });

  it("uses the exact (1+n)/(1+i)-1 identity, not subtraction", () => {
    const result = realRaise(1_100_000, 10, 12, 2024);
    const factor = cumulativeInflationFactor(12, 2024);
    expect(result.realRaisePct).toBeCloseTo((1.1 / factor - 1) * 100, 2);
  });
});
