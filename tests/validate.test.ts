import { describe, expect, it } from "vitest";
import {
  fingerprint,
  screenSubmission,
  submissionInputSchema,
  type SubmissionInput,
} from "../src/lib/validate";
import type { CohortRow } from "../src/lib/benchmark";

const valid = {
  roleSlug: "software-engineer",
  levelSlug: "mid",
  citySlug: "bengaluru",
  companyType: "funded-startup",
  yearsExperience: 4,
  yearsAtCompany: 2,
  annualBaseInr: 1_600_000,
  annualBonusInr: 150_000,
  annualEquityInr: 0,
  shareable: true,
};

const parse = (over: Record<string, unknown> = {}): SubmissionInput =>
  submissionInputSchema.parse({ ...valid, ...over });

function cohort(n: number, centre = 1_800_000): CohortRow[] {
  return Array.from({ length: n }, (_, i) => ({
    totalCompInr: centre + (i - n / 2) * 40_000,
    yearsExperience: 4,
    citySlug: "bengaluru",
    companyType: "funded-startup",
    source: "user",
    trustScore: 1,
  }));
}

describe("submissionInputSchema", () => {
  it("accepts a well-formed submission", () => {
    expect(() => parse()).not.toThrow();
  });

  it("rejects unknown taxonomy slugs", () => {
    expect(() => parse({ roleSlug: "astronaut" })).toThrow(/Unknown role/);
    expect(() => parse({ citySlug: "atlantis" })).toThrow(/Unknown city/);
  });

  it("rejects tenure longer than total experience", () => {
    expect(() => parse({ yearsExperience: 2, yearsAtCompany: 5 })).toThrow(/cannot exceed/);
  });

  it("rejects implausible base pay at both ends", () => {
    expect(() => parse({ annualBaseInr: 1_000 })).toThrow();
    expect(() => parse({ annualBaseInr: 500_000_000 })).toThrow();
  });

  it("defaults bonus and equity to zero", () => {
    const parsed = submissionInputSchema.parse({
      roleSlug: "qa-engineer",
      levelSlug: "junior",
      citySlug: "pune",
      companyType: "indian-it-services",
      yearsExperience: 1,
      yearsAtCompany: 1,
      annualBaseInr: 600_000,
    });
    expect(parsed.annualBonusInr).toBe(0);
    expect(parsed.annualEquityInr).toBe(0);
  });
});

describe("fingerprint", () => {
  it("is stable for identical facts and differs otherwise", () => {
    expect(fingerprint(parse())).toBe(fingerprint(parse()));
    expect(fingerprint(parse())).not.toBe(fingerprint(parse({ annualBaseInr: 1_600_001 })));
  });

  it("does not leak the input values", () => {
    const fp = fingerprint(parse());
    expect(fp).toMatch(/^[0-9a-f]{32}$/);
    expect(fp).not.toContain("1600000");
  });
});

describe("screenSubmission", () => {
  it("approves an ordinary submission that sits inside its cohort", () => {
    const result = screenSubmission(parse({ annualBaseInr: 1_700_000 }), cohort(20));
    expect(result.status).toBe("approved");
    expect(result.trustScore).toBeGreaterThan(0.7);
  });

  it("rejects an exact duplicate outright", () => {
    const input = parse();
    const result = screenSubmission(input, cohort(20), [fingerprint(input)]);
    expect(result.status).toBe("rejected");
    expect(result.flagReason).toBe("duplicate-submission");
  });

  it("holds an extreme outlier back from the benchmarks", () => {
    const result = screenSubmission(parse({ annualBaseInr: 60_000_000 }), cohort(30));
    expect(result.status).toBe("rejected");
    expect(result.flagReason).toBe("extreme-outlier");
  });

  it("sends a moderate outlier for review at reduced weight", () => {
    // Cohort centred on 18L with ~4L spread; 40L is far out but not absurd.
    const result = screenSubmission(parse({ annualBaseInr: 4_000_000 }), cohort(30));
    expect(result.status).toBe("pending");
    expect(result.trustScore).toBeLessThanOrEqual(0.5);
  });

  it("flags a bonus that dwarfs base pay", () => {
    // Total lands inside the cohort, so only the component rule can fire.
    const result = screenSubmission(
      parse({ annualBaseInr: 400_000, annualBonusInr: 1_400_000 }),
      cohort(20),
    );
    expect(result.status).toBe("pending");
    expect(result.flagReason).toMatch(/bonus/);
  });

  it("lets an outright rejection override a softer flag", () => {
    // Bonus rule flags it first; the extreme-outlier rule must still win.
    const result = screenSubmission(
      parse({ annualBaseInr: 1_000_000, annualBonusInr: 9_000_000 }),
      cohort(30),
    );
    expect(result.status).toBe("rejected");
    expect(result.flagReason).toBe("extreme-outlier");
  });

  it("down-weights a seniority claim that does not fit the experience", () => {
    const result = screenSubmission(
      parse({ levelSlug: "staff", yearsExperience: 1, yearsAtCompany: 1 }),
      cohort(20),
    );
    expect(result.trustScore).toBeLessThan(1);
  });

  it("accepts at reduced weight when the cohort is too small to test against", () => {
    const result = screenSubmission(parse(), cohort(3));
    expect(result.status).toBe("approved");
    expect(result.trustScore).toBeLessThan(1);
    expect(result.notes.join(" ")).toMatch(/cohort too small/i);
  });

  it("notices a raise dated before the person joined", () => {
    const result = screenSubmission(
      parse({ yearsAtCompany: 1, monthsSinceRaise: 40, lastRaisePct: 8 }),
      cohort(20),
    );
    expect(result.trustScore).toBeLessThan(1);
    expect(result.notes.join(" ")).toMatch(/predates joining/i);
  });

  it("never rejects on a model's opinion — only on deterministic rules", () => {
    // Regression guard: screening must stay pure and synchronous.
    expect(screenSubmission(parse(), cohort(20))).not.toBeInstanceOf(Promise);
  });
});
