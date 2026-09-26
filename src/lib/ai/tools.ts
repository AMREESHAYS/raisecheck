import type Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { assess, type AdviceRow } from "../advice";
import { computeBenchmark, predictFairRange } from "../benchmark";
import { realRaise } from "../data/inflation";
import {
  CITIES,
  COMPANY_TYPES,
  LEVELS,
  ROLES,
  CITY_SLUGS,
  COMPANY_TYPE_SLUGS,
  ROLE_SLUGS,
  type CompanyType,
} from "../data/taxonomy";

/**
 * The tools the chatbot is allowed to use.
 *
 * This is the whole trick behind "answers using the data": the model is given
 * no salary figures in its prompt and cannot produce one except by calling a
 * tool that reads the database. If a question cannot be answered by these
 * tools, the correct answer is "I don't have data for that".
 */

const queryShape = {
  role: z.string().describe("Role slug from list_options"),
  city: z.string().describe("City slug from list_options"),
  years_experience: z.number().min(0).max(50),
  company_type: z.string().nullable().optional(),
};

const lookupSchema = z.object(queryShape);

const assessSchema = z.object({
  ...queryShape,
  current_total_inr: z.number().min(0),
  last_raise_pct: z.number().nullable().optional(),
  months_since_raise: z.number().nullable().optional(),
});

const inflationSchema = z.object({
  current_salary_inr: z.number().min(0),
  raise_pct: z.number(),
  months_since_raise: z.number().min(0).max(600),
});

const optionsSchema = z.object({
  kind: z.enum(["roles", "cities", "company_types", "levels"]),
  search: z.string().nullable().optional(),
});

export const CHAT_TOOLS: Anthropic.Tool[] = [
  {
    name: "list_options",
    description:
      "List the valid role, city, company-type or level slugs this platform knows about. Call this first if you are unsure which slug matches what the user said — never guess a slug.",
    input_schema: {
      type: "object",
      properties: {
        kind: { type: "string", enum: ["roles", "cities", "company_types", "levels"] },
        search: {
          type: "string",
          description: "Optional case-insensitive filter on the label.",
        },
      },
      required: ["kind"],
      additionalProperties: false,
    },
  },
  {
    name: "lookup_market_rate",
    description:
      "Get the real market pay distribution (10th/25th/50th/75th/90th percentile of annual total compensation in INR) for a role, city and experience level, plus how much data it is based on. Use this for 'what should X earn' questions.",
    input_schema: {
      type: "object",
      properties: {
        role: { type: "string", description: "Role slug from list_options" },
        city: { type: "string", description: "City slug from list_options" },
        years_experience: { type: "number" },
        company_type: { type: "string", description: "Company-type slug from list_options" },
      },
      required: ["role", "city", "years_experience"],
      additionalProperties: false,
    },
  },
  {
    name: "assess_salary",
    description:
      "Assess one specific person's pay: their fair range, their percentile in the market, the gap in rupees, whether to ask for a raise or switch jobs, and (if raise history is given) whether their last raise beat inflation. Use this whenever the user asks about their own salary.",
    input_schema: {
      type: "object",
      properties: {
        role: { type: "string" },
        city: { type: "string" },
        years_experience: { type: "number" },
        company_type: { type: "string" },
        current_total_inr: {
          type: "number",
          description: "Annual base + bonus + equity in INR",
        },
        last_raise_pct: { type: "number", description: "Their most recent raise, in percent" },
        months_since_raise: { type: "number", description: "Months since that raise" },
      },
      required: ["role", "city", "years_experience", "current_total_inr"],
      additionalProperties: false,
    },
  },
  {
    name: "compare_with_inflation",
    description:
      "Compare a nominal raise against actual India CPI inflation over the same period, returning the real (inflation-adjusted) raise and the salary needed just to break even.",
    input_schema: {
      type: "object",
      properties: {
        current_salary_inr: { type: "number" },
        raise_pct: { type: "number" },
        months_since_raise: { type: "number" },
      },
      required: ["current_salary_inr", "raise_pct", "months_since_raise"],
      additionalProperties: false,
    },
  },
];

export type ToolContext = {
  /** Loads approved rows for one role. Injected so tools stay testable. */
  loadRoleRows: (roleSlug: string) => Promise<AdviceRow[]>;
};

export type ToolOutcome = { content: string; isError: boolean };

/**
 * Runs one tool call. Never throws: a bad call comes back as an error result so
 * the model can correct itself instead of the request failing.
 */
export async function runTool(
  name: string,
  rawInput: unknown,
  ctx: ToolContext,
): Promise<ToolOutcome> {
  try {
    switch (name) {
      case "list_options":
        return { content: JSON.stringify(listOptions(optionsSchema.parse(rawInput))), isError: false };

      case "lookup_market_rate": {
        const input = lookupSchema.parse(rawInput);
        const bad = checkSlugs(input.role, input.city, input.company_type);
        if (bad) return { content: bad, isError: true };
        const rows = await ctx.loadRoleRows(input.role);
        const q = {
          roleSlug: input.role,
          citySlug: input.city,
          yearsExperience: input.years_experience,
          companyType: input.company_type ?? undefined,
        };
        const benchmark = computeBenchmark(rows, q);
        const fair = predictFairRange(rows, q);
        if (benchmark.matchLevel === "none") {
          return {
            content: JSON.stringify({
              found: false,
              message:
                "No comparable reports exist for this role yet. Tell the user there is not enough data rather than estimating.",
            }),
            isError: false,
          };
        }
        return {
          content: JSON.stringify({
            found: true,
            currency: "INR per year, total compensation",
            cohort: benchmark.cohortLabel,
            percentiles: benchmark.percentiles,
            fair_range: { low: fair.low, midpoint: fair.point, high: fair.high },
            based_on_reports: benchmark.sampleSize,
            real_reports: benchmark.realSampleSize,
            seed_reference_reports: benchmark.seedSampleSize,
            confidence: benchmark.confidence,
            mostly_reference_data: benchmark.mostlySeedData,
          }),
          isError: false,
        };
      }

      case "assess_salary": {
        const input = assessSchema.parse(rawInput);
        const bad = checkSlugs(input.role, input.city, input.company_type);
        if (bad) return { content: bad, isError: true };
        const rows = await ctx.loadRoleRows(input.role);
        const result = assess(rows, {
          roleSlug: input.role,
          citySlug: input.city,
          yearsExperience: input.years_experience,
          companyType: (input.company_type ?? undefined) as CompanyType | undefined,
          currentTotalInr: input.current_total_inr,
          lastRaisePct: input.last_raise_pct ?? null,
          monthsSinceRaise: input.months_since_raise ?? null,
        });
        return { content: JSON.stringify(summariseAssessment(result)), isError: false };
      }

      case "compare_with_inflation": {
        const input = inflationSchema.parse(rawInput);
        return {
          content: JSON.stringify(
            realRaise(input.current_salary_inr, input.raise_pct, input.months_since_raise),
          ),
          isError: false,
        };
      }

      default:
        return { content: `Unknown tool: ${name}`, isError: true };
    }
  } catch (err) {
    const message = err instanceof z.ZodError ? err.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ") : String(err);
    return { content: `Invalid tool input — ${message}`, isError: true };
  }
}

function checkSlugs(role: string, city: string, companyType?: string | null): string | null {
  if (!ROLE_SLUGS.includes(role))
    return `Unknown role slug "${role}". Call list_options with kind="roles" to find the right one.`;
  if (!CITY_SLUGS.includes(city))
    return `Unknown city slug "${city}". Call list_options with kind="cities" to find the right one.`;
  if (companyType && !COMPANY_TYPE_SLUGS.includes(companyType))
    return `Unknown company type "${companyType}". Call list_options with kind="company_types".`;
  return null;
}

function listOptions(input: z.infer<typeof optionsSchema>) {
  const needle = input.search?.toLowerCase();
  const filter = <T extends { slug: string; label: string }>(items: T[]) =>
    (needle ? items.filter((i) => i.label.toLowerCase().includes(needle) || i.slug.includes(needle)) : items).map(
      (i) => ({ slug: i.slug, label: i.label }),
    );

  switch (input.kind) {
    case "roles":
      return filter(ROLES);
    case "cities":
      return filter(CITIES);
    case "company_types":
      return filter(COMPANY_TYPES);
    case "levels":
      return filter(LEVELS);
  }
}

/** Compact, model-friendly view of an assessment. */
export function summariseAssessment(a: ReturnType<typeof assess>) {
  return {
    currency: "INR per year, total compensation",
    current_pay: a.currentTotalInr,
    fair_range: { low: a.fairRange.low, midpoint: a.fairRange.point, high: a.fairRange.high },
    market_percentile: a.marketPercentile,
    gap_to_fair_midpoint_inr: a.gapInr,
    gap_pct: a.gapPct,
    verdict: a.verdict,
    recommended_action: a.action,
    internal_raise_ask: a.internalAskInr,
    realistic_switch_target: a.switchTargetInr,
    job_switch_premium_pct: a.switchPremium.premiumPct,
    switch_premium_measured_from_data: a.switchPremium.fromData,
    inflation_check: a.realRaise,
    cohort: a.fairRange.benchmark.cohortLabel,
    based_on_reports: a.fairRange.benchmark.sampleSize,
    real_reports: a.fairRange.benchmark.realSampleSize,
    confidence: a.fairRange.benchmark.confidence,
    reasons: a.reasons,
    caveats: a.caveats,
  };
}
