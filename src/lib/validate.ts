import { createHash } from "node:crypto";
import { z } from "zod";
import {
  CITY_SLUGS,
  COMPANY_TYPE_SLUGS,
  LEVEL_SLUGS,
  ROLE_SLUGS,
  levelForYears,
  levelBySlug,
} from "./data/taxonomy";
import type { CohortRow } from "./benchmark";

/** Nobody in this dataset legitimately earns outside these bounds, in INR/year. */
const MIN_BASE = 60_000;
const MAX_BASE = 100_000_000;
const MAX_TOTAL = 250_000_000;

const slugIn = (allowed: string[], field: string) =>
  z.string().refine((v) => allowed.includes(v), { message: `Unknown ${field}` });

export const submissionInputSchema = z
  .object({
    roleSlug: slugIn(ROLE_SLUGS, "role"),
    levelSlug: slugIn(LEVEL_SLUGS, "level"),
    citySlug: slugIn(CITY_SLUGS, "city"),
    companyType: slugIn(COMPANY_TYPE_SLUGS, "company type"),

    yearsExperience: z.number().min(0).max(50),
    yearsAtCompany: z.number().min(0).max(50),

    annualBaseInr: z.number().int().min(MIN_BASE).max(MAX_BASE),
    annualBonusInr: z.number().int().min(0).max(MAX_TOTAL).default(0),
    annualEquityInr: z.number().int().min(0).max(MAX_TOTAL).default(0),

    lastRaisePct: z.number().min(-50).max(300).nullable().optional(),
    monthsSinceRaise: z.number().int().min(0).max(600).nullable().optional(),

    shareable: z.boolean().default(true),
  })
  .refine((v) => v.yearsAtCompany <= v.yearsExperience + 0.5, {
    message: "Years at this company cannot exceed total years of experience",
    path: ["yearsAtCompany"],
  })
  .refine((v) => v.annualBaseInr + v.annualBonusInr + v.annualEquityInr <= MAX_TOTAL, {
    message: "Total compensation is implausibly high",
    path: ["annualBaseInr"],
  });

export type SubmissionInput = z.infer<typeof submissionInputSchema>;

export type ScreenResult = {
  status: "approved" | "pending" | "rejected";
  trustScore: number;
  flagReason: string | null;
  /** Human-readable notes, useful in the moderation queue and in tests. */
  notes: string[];
};

/**
 * Stable hash of the reported facts, used only to catch duplicate submissions.
 * It contains no identifying information and cannot be reversed into a person.
 */
export function fingerprint(input: SubmissionInput): string {
  const key = [
    input.roleSlug,
    input.citySlug,
    input.companyType,
    input.annualBaseInr,
    input.annualBonusInr,
    input.annualEquityInr,
    input.yearsExperience.toFixed(1),
  ].join("|");
  return createHash("sha256").update(key).digest("hex").slice(0, 32);
}

/** Median absolute deviation — an outlier measure that outliers cannot skew. */
function medianAbsoluteDeviation(values: number[]): { median: number; mad: number } {
  if (values.length === 0) return { median: 0, mad: 0 };
  const sorted = [...values].sort((a, b) => a - b);
  const median = pick(sorted, 0.5);
  const deviations = sorted.map((v) => Math.abs(v - median)).sort((a, b) => a - b);
  return { median, mad: pick(deviations, 0.5) };
}

function pick(sorted: number[], q: number): number {
  if (sorted.length === 0) return 0;
  const idx = (sorted.length - 1) * q;
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  return lo === hi ? sorted[lo] : sorted[lo] + (idx - lo) * (sorted[hi] - sorted[lo]);
}

/**
 * Rule-based screening of one submission before it can affect benchmarks.
 *
 * This is the first line of defence for data quality, and it is deliberately
 * deterministic: a submission is never rejected by a model. Suspicious rows go
 * to `pending` (excluded from benchmarks, kept for review) rather than being
 * thrown away, and merely unusual rows are down-weighted via `trustScore` so
 * one weird-but-real salary cannot move a median on its own.
 *
 * `cohort` should be existing approved rows for the same role, used for the
 * outlier test. An empty cohort simply means the outlier test is skipped.
 */
export function screenSubmission(
  input: SubmissionInput,
  cohort: CohortRow[],
  existingFingerprints: string[] = [],
): ScreenResult {
  const notes: string[] = [];
  let trust = 1;
  let status: ScreenResult["status"] = "approved";
  let flag: string | null = null;

  const total = input.annualBaseInr + input.annualBonusInr + input.annualEquityInr;

  // 1. Duplicate of an identical earlier report.
  if (existingFingerprints.includes(fingerprint(input))) {
    return {
      status: "rejected",
      trustScore: 0,
      flagReason: "duplicate-submission",
      notes: ["An identical report already exists."],
    };
  }

  // 2. Internal consistency of the components.
  if (input.annualBonusInr > input.annualBaseInr * 3) {
    status = "pending";
    flag = "bonus-exceeds-plausible-multiple-of-base";
    notes.push("Bonus is more than 3x base pay.");
  }
  if (input.annualEquityInr > input.annualBaseInr * 8) {
    status = "pending";
    flag = flag ?? "equity-exceeds-plausible-multiple-of-base";
    notes.push("Equity is more than 8x base pay.");
  }

  // 3. Seniority claimed vs experience reported.
  const expectedLevel = levelForYears(input.yearsExperience);
  const claimed = levelBySlug(input.levelSlug);
  if (claimed && input.levelSlug !== "manager" && claimed.slug !== expectedLevel) {
    const [lo, hi] = claimed.typicalYears;
    if (input.yearsExperience < lo - 2 || input.yearsExperience > hi + 4) {
      trust = Math.min(trust, 0.6);
      notes.push(
        `Claimed level (${claimed.label}) is unusual for ${input.yearsExperience} years of experience.`,
      );
    }
  }

  // 4. Outlier test against the role cohort, using MAD so existing outliers
  //    cannot widen the gate.
  const cohortValues = cohort
    .filter((r) => r.trustScore > 0)
    .map((r) => r.totalCompInr)
    .filter((v) => v > 0);

  if (cohortValues.length >= 12) {
    const { median, mad } = medianAbsoluteDeviation(cohortValues);
    // 1.4826 scales MAD to be comparable with a standard deviation.
    const scaled = mad * 1.4826;
    if (scaled > 0) {
      const z = Math.abs(total - median) / scaled;
      if (z > 6) {
        status = "rejected";
        flag = "extreme-outlier";
        notes.push(`Total pay is ${z.toFixed(1)} robust deviations from the role median.`);
      } else if (z > 3.5) {
        status = "pending";
        flag = flag ?? "outlier-needs-review";
        trust = Math.min(trust, 0.5);
        notes.push(`Total pay is ${z.toFixed(1)} robust deviations from the role median.`);
      } else if (z > 2.5) {
        trust = Math.min(trust, 0.8);
        notes.push("Total pay is on the edge of the role distribution.");
      }
    }
  } else {
    notes.push("Role cohort too small for an outlier check; accepted at reduced weight.");
    trust = Math.min(trust, 0.9);
  }

  // 5. Raise history internal consistency.
  if (input.lastRaisePct != null && input.monthsSinceRaise == null) {
    trust = Math.min(trust, 0.9);
    notes.push("Raise percentage given without a date; raise analysis will be skipped.");
  }
  if (input.monthsSinceRaise != null && input.yearsAtCompany * 12 + 1 < input.monthsSinceRaise) {
    trust = Math.min(trust, 0.7);
    notes.push("Last raise predates joining this company.");
  }

  return { status, trustScore: round2(trust), flagReason: flag, notes };
}

const round2 = (n: number) => Math.round(n * 100) / 100;
