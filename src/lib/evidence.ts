import { predictFairRange, type CohortRow } from "./benchmark";
import type { Assessment } from "./advice";
import { formatInr } from "./format";
import { cityBySlug, roleBySlug } from "./data/taxonomy";

/**
 * The market evidence a person actually needs in a negotiation: not just "you
 * are underpaid", but the specific, quotable facts that make the ask land.
 */
export type Evidence = {
  /** What the role pays at your experience and at the next rungs up. */
  trajectory: { years: number; median: number; label: string; isYou: boolean }[];
  /** Short, quotable lines the user can say or paste into an email. */
  talkingPoints: string[];
  /** Counter-arguments they are likely to hear, and what to say back. */
  objections: { objection: string; response: string }[];
};

export function buildEvidence(
  rows: CohortRow[],
  a: Assessment,
  roleSlug: string,
  citySlug: string,
  yearsExperience: number,
): Evidence {
  const role = roleBySlug(roleSlug)?.label ?? roleSlug;
  const city = cityBySlug(citySlug)?.label ?? citySlug;
  const b = a.fairRange.benchmark;

  // Market trajectory: what this role pays as experience grows. This is the
  // "trend" a person is arguing against — it shows where their pay should be
  // heading, not just where it is.
  const points = [
    Math.max(0, yearsExperience - 3),
    yearsExperience,
    yearsExperience + 3,
    yearsExperience + 6,
  ];
  const trajectory = Array.from(new Set(points))
    .map((years) => {
      const fair = predictFairRange(rows, { roleSlug, citySlug, yearsExperience: years });
      return {
        years,
        median: fair.benchmark.percentiles.p50,
        label: `${years} yrs`,
        isYou: years === yearsExperience,
      };
    })
    .filter((p) => p.median > 0);

  const talkingPoints: string[] = [];

  if (a.gapPct > 5) {
    talkingPoints.push(
      `The market range for a ${role} in ${city} at my experience level is ${formatInr(a.fairRange.low)} to ${formatInr(a.fairRange.high)}. I'm at ${formatInr(a.currentTotalInr)}.`,
    );
    talkingPoints.push(
      `That puts me around the ${a.marketPercentile}th percentile — roughly ${formatInr(Math.abs(a.gapInr))} a year below the midpoint for this role.`,
    );
  } else {
    talkingPoints.push(
      `My pay is around the ${a.marketPercentile}th percentile for a ${role} in ${city}, so I'm asking based on scope and contribution rather than a market gap.`,
    );
  }

  if (a.realRaise?.losingGround) {
    talkingPoints.push(
      `My last revision of ${a.realRaise.nominalRaisePct}% was below the ${a.realRaise.inflationPct}% inflation over the same ${a.realRaise.months} months. In real terms my pay went down by ${Math.abs(a.realRaise.realRaisePct)}%.`,
    );
    talkingPoints.push(
      `To be where I was in real terms, I'd need ${formatInr(a.realRaise.breakEvenSalary)} — that's standing still, not a raise.`,
    );
  }

  const next = trajectory.find((t) => t.years === yearsExperience + 3);
  if (next && next.median > a.currentTotalInr) {
    talkingPoints.push(
      `In three years this role typically pays ${formatInr(next.median)}. I'd like my trajectory to track that rather than fall further behind it.`,
    );
  }

  talkingPoints.push(`I'd like to move to ${formatInr(a.internalAskInr)}.`);

  const objections: Evidence["objections"] = [
    {
      objection: "“There's no budget this cycle.”",
      response: `“I understand budgets are set. Can we agree the number now and a date it takes effect — and what specifically you'd need to see from me for it to happen?”`,
    },
    {
      objection: "“Where did you get that number?”",
      response: `“Aggregated salary reports for this role, city and experience level — ${b.sampleSize} comparable reports. I'm happy to walk through it.”`,
    },
    {
      objection: "“Everyone got the same standard hike.”",
      response: `“I'm not asking for a different process, I'm asking about the level. A standard percentage on a below-market base keeps me below market.”`,
    },
    {
      objection: "“Let's revisit at the next review.”",
      response: `“Happy to. Can we put the target number in writing now so the next review is about whether I hit the bar, not about what the number is?”`,
    },
  ];

  if (a.action === "switch" || a.action === "negotiate-then-switch") {
    objections.push({
      objection: "If they say no outright",
      response: `The gap is ${Math.round(a.gapPct)}%, which is more than internal raises usually clear. A move could realistically land ${formatInr(a.switchTargetInr)} — worth starting conversations in parallel.`,
    });
  }

  return { trajectory, talkingPoints, objections };
}
