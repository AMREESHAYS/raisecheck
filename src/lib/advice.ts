import { computeBenchmark, weightedPercentile, type CohortRow } from "./benchmark";
import { predictFairRange, type FairRange, type BenchmarkQuery } from "./benchmark";
import { realRaise, type RealRaiseResult } from "./data/inflation";
import { roleBySlug } from "./data/taxonomy";

/** Internal raises are approved by a manager with a budget; they rarely clear this. */
const REALISTIC_INTERNAL_RAISE_CEILING = 0.25;

/** Used when the dataset cannot yet measure the job-switch premium itself. */
const DEFAULT_SWITCH_PREMIUM = 0.2;

export type AdviceRow = CohortRow & { yearsAtCompany: number };

export type SwitchPremium = {
  premiumPct: number;
  /** True when measured from the dataset, false when it is the documented default. */
  fromData: boolean;
  recentJoinerSample: number;
  tenuredSample: number;
};

/**
 * Measures the job-switch premium directly from the data: within one role, how
 * much more do people who joined in the last ~18 months earn than people who
 * have been at the same kind of company for 3+ years?
 *
 * This is the number that decides "ask for a raise" versus "switch jobs", so we
 * would rather measure it than assume it — but we say which one happened.
 */
export function measureSwitchPremium(rows: AdviceRow[], roleSlug: string): SwitchPremium {
  const role = roleBySlug(roleSlug);
  const slope = role?.expSlope ?? 0.1;

  // Seed rows are excluded on purpose. They are generated from assumptions, so
  // measuring a premium from them would just be reading our own assumption back
  // out and labelling it evidence.
  rows = rows.filter((r) => r.source !== "seed");

  // Strip out the experience effect first, otherwise we would just be measuring
  // that long-tenured people are also more experienced.
  const atFiveYears = (r: AdviceRow) =>
    r.totalCompInr * Math.pow(1 + slope, 5 - r.yearsExperience);

  const recent = rows.filter((r) => r.yearsAtCompany <= 1.5).map((r) => ({ value: atFiveYears(r), weight: 1 }));
  const tenured = rows.filter((r) => r.yearsAtCompany >= 3).map((r) => ({ value: atFiveYears(r), weight: 1 }));

  if (recent.length >= 5 && tenured.length >= 5) {
    recent.sort((a, b) => a.value - b.value);
    tenured.sort((a, b) => a.value - b.value);
    const recentMedian = weightedPercentile(recent, 0.5);
    const tenuredMedian = weightedPercentile(tenured, 0.5);
    if (tenuredMedian > 0) {
      const premium = recentMedian / tenuredMedian - 1;
      // Guard against a thin cohort producing a nonsense number.
      if (premium > -0.1 && premium < 0.9) {
        return {
          premiumPct: round1(premium * 100),
          fromData: true,
          recentJoinerSample: recent.length,
          tenuredSample: tenured.length,
        };
      }
    }
  }

  return {
    premiumPct: DEFAULT_SWITCH_PREMIUM * 100,
    fromData: false,
    recentJoinerSample: recent.length,
    tenuredSample: tenured.length,
  };
}

export type Verdict = "underpaid" | "fairly-paid" | "above-market";
export type Action = "hold" | "negotiate" | "negotiate-then-switch" | "switch";

export type Assessment = {
  currentTotalInr: number;
  fairRange: FairRange;
  /** Where the user sits in the market distribution, 0-100. */
  marketPercentile: number;
  /** Positive means underpaid: how far below the fair point estimate, in percent. */
  gapPct: number;
  gapInr: number;
  verdict: Verdict;
  action: Action;
  /** What to ask for in an internal raise conversation, INR. */
  internalAskInr: number;
  /** What a switch could realistically land, INR. */
  switchTargetInr: number;
  switchPremium: SwitchPremium;
  realRaise: RealRaiseResult | null;
  reasons: string[];
  caveats: string[];
};

export type AssessmentInput = BenchmarkQuery & {
  currentTotalInr: number;
  lastRaisePct?: number | null;
  monthsSinceRaise?: number | null;
};

/**
 * Turns a salary plus the dataset into a decision: hold, negotiate, or switch.
 *
 * The thresholds here are judgement calls, documented inline, not measurements.
 * They exist so the advice is consistent and reviewable rather than vibes.
 */
export function assess(rows: AdviceRow[], input: AssessmentInput): Assessment {
  const fairRange = predictFairRange(rows, input);
  const benchmark = fairRange.benchmark;

  const pairs = rows
    .filter((r) => r.trustScore > 0)
    .map((r) => ({ value: r.totalCompInr, weight: r.source === "seed" ? 0.35 : 1 }))
    .sort((a, b) => a.value - b.value);

  const marketPercentile = percentileAgainst(fairRange, input.currentTotalInr);
  const gapInr = fairRange.point - input.currentTotalInr;
  const gapPct = input.currentTotalInr > 0 ? (gapInr / input.currentTotalInr) * 100 : 0;

  const switchPremium = measureSwitchPremium(rows, input.roleSlug);

  const rr =
    input.lastRaisePct != null && input.monthsSinceRaise != null
      ? realRaise(input.currentTotalInr, input.lastRaisePct, input.monthsSinceRaise)
      : null;

  const reasons: string[] = [];
  const caveats: string[] = [];

  // --- Verdict: is this person underpaid? -----------------------------------
  // Within 5% of the fair point is noise, not unfairness.
  let verdict: Verdict;
  if (gapPct > 5) verdict = "underpaid";
  else if (gapPct < -8) verdict = "above-market";
  else verdict = "fairly-paid";

  // --- Action: raise or switch? --------------------------------------------
  let action: Action;
  if (gapPct <= 5) {
    action = "hold";
    reasons.push(
      `Your total pay is at roughly the ${marketPercentile}th percentile for ${benchmark.cohortLabel.toLowerCase()}, so there is no clear gap to argue from.`,
    );
  } else if (gapPct <= 15) {
    action = "negotiate";
    reasons.push(
      `The gap to the market median is about ${Math.round(gapPct)}%, which a single well-argued raise can realistically close.`,
    );
  } else if (gapPct <= REALISTIC_INTERNAL_RAISE_CEILING * 100 || switchPremium.premiumPct < 12) {
    action = "negotiate-then-switch";
    reasons.push(
      `A ${Math.round(gapPct)}% gap is at the edge of what an internal raise usually clears (about ${Math.round(REALISTIC_INTERNAL_RAISE_CEILING * 100)}%). Ask first, and start interviewing in parallel.`,
    );
  } else {
    action = "switch";
    reasons.push(
      `A ${Math.round(gapPct)}% gap is more than internal raises usually clear, and people who switched into this role recently earn about ${Math.round(switchPremium.premiumPct)}% more than those who stayed.`,
    );
  }

  // Stale salary escalates urgency regardless of the gap.
  if (input.monthsSinceRaise != null && input.monthsSinceRaise >= 24 && action === "hold") {
    reasons.push(
      `You have not had a raise in ${input.monthsSinceRaise} months, so even at market rate your pay is being eroded by inflation.`,
    );
    action = "negotiate";
  }

  if (rr?.losingGround) {
    reasons.push(
      `Your last raise of ${rr.nominalRaisePct}% did not keep up with ${rr.inflationPct}% inflation over the same ${rr.months} months — in real terms you took a ${Math.abs(rr.realRaisePct)}% pay cut.`,
    );
    if (action === "hold") action = "negotiate";
  }

  // --- Targets --------------------------------------------------------------
  // An internal ask is capped at what a manager can plausibly approve; anchor at
  // the top of the fair band when that is lower.
  const internalAskInr = Math.round(
    Math.min(fairRange.high, input.currentTotalInr * (1 + REALISTIC_INTERNAL_RAISE_CEILING)),
  );
  const switchTargetInr = Math.round(fairRange.point * (1 + switchPremium.premiumPct / 100));

  // --- Caveats --------------------------------------------------------------
  if (benchmark.mostlySeedData) {
    caveats.push(
      "This comparison still rests mostly on seeded reference ranges rather than real reports from people in your exact segment. Treat it as an indication, not a measurement.",
    );
  }
  if (benchmark.confidence === "low") {
    caveats.push(
      `Only ${benchmark.sampleSize} comparable reports were available (${benchmark.realSampleSize} of them real), so the range is wide.`,
    );
  }
  if (benchmark.matchLevel !== "role-city-experience" && benchmark.matchLevel !== "none") {
    caveats.push(
      `There was not enough data for your exact city and experience level, so the cohort was widened: ${benchmark.cohortLabel}.`,
    );
  }
  if (!switchPremium.fromData) {
    caveats.push(
      `The job-switch premium of ${Math.round(switchPremium.premiumPct)}% is a documented default, not yet measured from this dataset.`,
    );
  }

  return {
    currentTotalInr: input.currentTotalInr,
    fairRange,
    marketPercentile,
    gapPct: round1(gapPct),
    gapInr: Math.round(gapInr),
    verdict,
    action,
    internalAskInr,
    switchTargetInr,
    switchPremium,
    realRaise: rr,
    reasons,
    caveats,
  };
}

/**
 * Percentile of a salary against the fair-range distribution, interpolated from
 * the published percentile points so it lines up with what the user is shown.
 */
function percentileAgainst(fair: FairRange, value: number): number {
  const p = fair.benchmark.percentiles;
  const points: [number, number][] = [
    [p.p10, 10],
    [p.p25, 25],
    [p.p50, 50],
    [p.p75, 75],
    [p.p90, 90],
  ];
  if (p.p50 === 0) return 50;
  if (value <= points[0][0]) return Math.max(1, Math.round((value / Math.max(points[0][0], 1)) * 10));
  if (value >= points[4][0]) return Math.min(99, 90 + Math.round(((value - points[4][0]) / Math.max(points[4][0], 1)) * 10));
  for (let i = 1; i < points.length; i++) {
    const [v1, q1] = points[i - 1];
    const [v2, q2] = points[i];
    if (value <= v2) {
      const span = v2 - v1;
      const t = span === 0 ? 0 : (value - v1) / span;
      return Math.round(q1 + t * (q2 - q1));
    }
  }
  return 50;
}

export { computeBenchmark };

const round1 = (n: number) => Math.round(n * 10) / 10;
