/**
 * India CPI (Combined) annual average inflation, in percent.
 *
 * SOURCE: Ministry of Statistics and Programme Implementation (MoSPI) CPI
 * releases, as also published by the RBI and the World Bank. These are
 * REFERENCE VALUES committed to the repo so the product works offline and so
 * every calculation is auditable — they are not fetched live.
 *
 * Values marked `provisional: true` are estimates for years that were not yet
 * closed out when this file was written. Before you rely on this in production,
 * verify the last two entries against the current MoSPI release and update them.
 * Nothing else in the codebase hardcodes an inflation number.
 */
export type InflationYear = {
  year: number;
  cpiInflationPct: number;
  provisional?: boolean;
};

export const INDIA_CPI_INFLATION: InflationYear[] = [
  { year: 2015, cpiInflationPct: 4.9 },
  { year: 2016, cpiInflationPct: 4.5 },
  { year: 2017, cpiInflationPct: 3.6 },
  { year: 2018, cpiInflationPct: 3.4 },
  { year: 2019, cpiInflationPct: 4.8 },
  { year: 2020, cpiInflationPct: 6.2 },
  { year: 2021, cpiInflationPct: 5.5 },
  { year: 2022, cpiInflationPct: 6.7 },
  { year: 2023, cpiInflationPct: 5.4 },
  { year: 2024, cpiInflationPct: 4.9 },
  { year: 2025, cpiInflationPct: 3.7, provisional: true },
  { year: 2026, cpiInflationPct: 4.2, provisional: true },
];

export const CPI_SOURCE_NOTE =
  "India CPI (Combined) annual average inflation, MoSPI/RBI reference series. The two most recent years are provisional estimates.";

function inflationForYear(year: number): number {
  const exact = INDIA_CPI_INFLATION.find((y) => y.year === year);
  if (exact) return exact.cpiInflationPct;
  const years = INDIA_CPI_INFLATION.map((y) => y.year);
  const min = Math.min(...years);
  const max = Math.max(...years);
  // Outside the series, hold the nearest known year rather than extrapolating.
  const clamped = Math.min(Math.max(year, min), max);
  return INDIA_CPI_INFLATION.find((y) => y.year === clamped)!.cpiInflationPct;
}

/**
 * Cumulative inflation factor over a fractional number of years ending at
 * `endYear`. A factor of 1.12 means prices rose 12% over the window.
 */
export function cumulativeInflationFactor(months: number, endYear: number): number {
  if (months <= 0) return 1;
  let factor = 1;
  let remaining = months;
  let year = endYear;
  while (remaining > 0) {
    const slice = Math.min(12, remaining) / 12;
    factor *= Math.pow(1 + inflationForYear(year) / 100, slice);
    remaining -= 12;
    year -= 1;
  }
  return factor;
}

export type RealRaiseResult = {
  nominalRaisePct: number;
  inflationPct: number;
  /** Raise after inflation: (1+nominal)/(1+inflation) - 1, as a percentage. */
  realRaisePct: number;
  months: number;
  /** What the salary would need to be just to stand still, in INR. */
  breakEvenSalary: number;
  losingGround: boolean;
  note: string;
};

/**
 * Compares a nominal raise against realised inflation over the same window.
 *
 * `currentSalary` is post-raise annual total; `months` is how long ago the
 * raise happened (or how long the salary has been flat, if there was no raise).
 */
export function realRaise(
  currentSalary: number,
  nominalRaisePct: number,
  months: number,
  endYear = new Date().getUTCFullYear(),
): RealRaiseResult {
  const window = Math.max(1, months);
  const factor = cumulativeInflationFactor(window, endYear);
  const inflationPct = (factor - 1) * 100;
  const realRaisePct = ((1 + nominalRaisePct / 100) / factor - 1) * 100;
  const previousSalary = currentSalary / (1 + nominalRaisePct / 100);
  const breakEvenSalary = previousSalary * factor;
  return {
    nominalRaisePct,
    inflationPct: round2(inflationPct),
    realRaisePct: round2(realRaisePct),
    months: window,
    breakEvenSalary: Math.round(breakEvenSalary),
    losingGround: realRaisePct < 0,
    note: CPI_SOURCE_NOTE,
  };
}

const round2 = (n: number) => Math.round(n * 100) / 100;
