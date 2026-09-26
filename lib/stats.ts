import { EXP_BUCKETS, expBucket } from "./vocab";
import { bucketStats, type BucketStats } from "./db";

export const MIN_SAMPLE = 8;
export const OUTLIER_SIGMA = 3;

/**
 * Outlier gate, run against the peers a submission would join.
 * A bucket below MIN_SAMPLE cannot reject anything: with n<8 there is nothing
 * to compare against and every early submission looks extreme.
 */
export function isOutlier(ctc: number, peers: Pick<BucketStats, "n" | "mean" | "std">) {
  if (peers.n < MIN_SAMPLE) return false;
  if (peers.std === 0) return ctc !== peers.mean;
  return Math.abs(ctc - peers.mean) / peers.std > OUTLIER_SIGMA;
}

export type MarketRate = {
  n: number;
  p25: number;
  p50: number;
  p75: number;
  rank_pct: number | null;
  /** What the numbers actually describe, after any widening. */
  basis: { role_category: string; city: string | null; experience: string };
  widened: boolean;
  note: string | null;
};

export type InsufficientData = { insufficient: true; n: number };

export type BucketFetcher = (args: {
  role_category: string;
  city: string | null;
  minYears: number;
  maxYears: number;
  ctc?: number;
}) => Promise<BucketStats>;

/**
 * City specificity is dropped before experience granularity: pay tracks
 * experience harder than it tracks city, so a city-wide number for the right
 * experience level stays more useful than an all-levels number for the right city.
 */
export async function marketRate(
  role_category: string,
  city: string,
  years: number,
  ctc: number,
  fetchBucket: BucketFetcher = bucketStats,
): Promise<MarketRate | InsufficientData> {
  const b = expBucket(years);
  const widest = EXP_BUCKETS[EXP_BUCKETS.length - 1].max;
  const attempts: { city: string | null; min: number; max: number; note: string | null }[] = [
    { city, min: b.min, max: b.max, note: null },
    {
      city: null,
      min: b.min,
      max: b.max,
      note: `Not enough data for ${city} yet — this is all-India for the same role and experience.`,
    },
    {
      city: null,
      min: Math.max(0, b.min - 3),
      max: b.max + 5,
      note: "Not enough data for this exact combination — widened to a broader experience range across India.",
    },
    {
      city: null,
      min: 0,
      max: widest,
      note: "Not enough data for this experience level — this is every experience level for the same role category across India.",
    },
  ];

  let best = 0;
  for (const [i, a] of attempts.entries()) {
    const s = await fetchBucket({
      role_category,
      city: a.city,
      minYears: a.min,
      maxYears: a.max,
      ctc,
    });
    best = Math.max(best, s.n);
    if (s.n >= MIN_SAMPLE) {
      return {
        n: s.n,
        p25: s.p25,
        p50: s.p50,
        p75: s.p75,
        rank_pct: s.rank_pct,
        basis: {
          role_category,
          city: a.city,
          experience: a.min === 0 && a.max >= widest ? "all levels" : `${a.min}-${a.max} yrs`,
        },
        widened: i > 0,
        note: a.note,
      };
    }
  }
  return { insufficient: true, n: best };
}
