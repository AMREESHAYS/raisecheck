import cpi from "../data/cpi.json";

export const CPI_META = {
  source: cpi.source,
  geography: cpi.geography,
  verifiedThrough: cpi.verified_through,
};

const RATES = cpi.rates as Record<string, { pct: number; provisional: boolean }>;

function yearRate(year: number) {
  const hit = RATES[String(year)];
  if (hit) return hit;
  // Before/after the series: fall back to the nearest year we actually have.
  const years = Object.keys(RATES).map(Number).sort((a, b) => a - b);
  const nearest = year < years[0] ? years[0] : years[years.length - 1];
  return { pct: RATES[String(nearest)].pct, provisional: true };
}

const DAY = 86400_000;

/** Compounded CPI inflation between two dates, prorating each calendar year. */
export function inflationBetween(from: Date, to: Date) {
  if (to <= from) return { pct: 0, provisional: false, years: 0 };
  let factor = 1;
  let provisional = false;
  for (let y = from.getUTCFullYear(); y <= to.getUTCFullYear(); y++) {
    const yStart = Date.UTC(y, 0, 1);
    const yEnd = Date.UTC(y + 1, 0, 1);
    const overlapStart = Math.max(yStart, from.getTime());
    const overlapEnd = Math.min(yEnd, to.getTime());
    if (overlapEnd <= overlapStart) continue;
    const share = (overlapEnd - overlapStart) / (yEnd - yStart);
    const r = yearRate(y);
    if (r.provisional) provisional = true;
    factor *= (1 + r.pct / 100) ** share;
  }
  return {
    pct: (factor - 1) * 100,
    provisional,
    years: (to.getTime() - from.getTime()) / (365.25 * DAY),
  };
}

export type RealChange = {
  raisePct: number;
  inflationPct: number;
  realPct: number;
  /** Rupees of annual purchasing power lost (negative) or gained, vs. the pre-raise CTC. */
  rupeeDelta: number;
  provisional: boolean;
  verdict: "behind" | "flat" | "ahead";
  sentence: string;
};

export function realChange(
  currentCtc: number,
  raisePct: number,
  raiseDate: Date,
  now = new Date(),
): RealChange {
  const inf = inflationBetween(raiseDate, now);
  const realPct = ((1 + raisePct / 100) / (1 + inf.pct / 100) - 1) * 100;
  const preRaiseCtc = currentCtc / (1 + raisePct / 100);
  const rupeeDelta = preRaiseCtc * (realPct / 100);
  const verdict = realPct < -0.75 ? "behind" : realPct > 0.75 ? "ahead" : "flat";
  const inr = (n: number) =>
    "₹" + Math.abs(Math.round(n)).toLocaleString("en-IN");

  const sentence =
    verdict === "behind"
      ? `Your pay rose ${raisePct.toFixed(1)}%, but prices rose ${inf.pct.toFixed(1)}% over the same period. In real terms you gave up ${inr(rupeeDelta)} a year.`
      : verdict === "ahead"
        ? `Your pay rose ${raisePct.toFixed(1)}% against ${inf.pct.toFixed(1)}% inflation — your raise beat inflation by ${realPct.toFixed(1)}%, worth ${inr(rupeeDelta)} a year.`
        : `Your pay rose ${raisePct.toFixed(1)}% and prices rose ${inf.pct.toFixed(1)}% — you're basically flat.`;

  return { raisePct, inflationPct: inf.pct, realPct, rupeeDelta, provisional: inf.provisional, verdict, sentence };
}
