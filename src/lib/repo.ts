import { and, count, desc, eq, sql } from "drizzle-orm";
import { getDb } from "../db";
import { submissions, type NewSubmission } from "../db/schema";
import type { AdviceRow } from "./advice";
import { fingerprint, screenSubmission, type SubmissionInput } from "./validate";

/**
 * Loads the approved rows for one role.
 *
 * Benchmarks are always computed over a whole role and then narrowed in memory,
 * because the cohort-widening ladder needs to see rows outside the queried city
 * to fall back to. A role is a few thousand rows at most, so this is cheap; if a
 * role ever gets large enough for this to hurt, push the widening into SQL.
 */
export async function loadRoleRows(roleSlug: string): Promise<AdviceRow[]> {
  const db = await getDb();
  const rows = await db
    .select({
      totalCompInr: submissions.totalCompInr,
      yearsExperience: submissions.yearsExperience,
      yearsAtCompany: submissions.yearsAtCompany,
      citySlug: submissions.citySlug,
      companyType: submissions.companyType,
      source: submissions.source,
      trustScore: submissions.trustScore,
    })
    .from(submissions)
    .where(and(eq(submissions.roleSlug, roleSlug), eq(submissions.status, "approved")));
  return rows;
}

/** Fingerprints of recent rows for the same role, for duplicate detection. */
async function recentFingerprints(roleSlug: string): Promise<string[]> {
  const db = await getDb();
  const rows = await db
    .select({ fingerprint: submissions.fingerprint })
    .from(submissions)
    .where(eq(submissions.roleSlug, roleSlug))
    .orderBy(desc(submissions.id))
    .limit(2000);
  return rows.map((r) => r.fingerprint).filter((f): f is string => f !== null);
}

export type SaveResult = {
  accepted: boolean;
  status: "approved" | "pending" | "rejected";
  flagReason: string | null;
  notes: string[];
  /** Rows used for the assessment returned alongside — loaded before the insert. */
  cohort: AdviceRow[];
};

/**
 * Screens and stores one submission.
 *
 * Screening runs against the cohort as it was *before* this row, so a
 * submission can never be validated against itself.
 */
export async function saveSubmission(input: SubmissionInput): Promise<SaveResult> {
  const db = await getDb();
  const cohort = await loadRoleRows(input.roleSlug);
  const screen = screenSubmission(input, cohort, await recentFingerprints(input.roleSlug));

  if (screen.status !== "rejected") {
    const total = input.annualBaseInr + input.annualBonusInr + input.annualEquityInr;
    const row: NewSubmission = {
      roleSlug: input.roleSlug,
      levelSlug: input.levelSlug,
      citySlug: input.citySlug,
      companyType: input.companyType,
      yearsExperience: input.yearsExperience,
      yearsAtCompany: input.yearsAtCompany,
      annualBaseInr: input.annualBaseInr,
      annualBonusInr: input.annualBonusInr,
      annualEquityInr: input.annualEquityInr,
      totalCompInr: total,
      lastRaisePct: input.lastRaisePct ?? null,
      monthsSinceRaise: input.monthsSinceRaise ?? null,
      source: "user",
      status: screen.status,
      trustScore: screen.trustScore,
      flagReason: screen.flagReason,
      fingerprint: fingerprint(input),
      shareable: input.shareable,
    };
    await db.insert(submissions).values(row);
  }

  return {
    accepted: screen.status !== "rejected",
    status: screen.status,
    flagReason: screen.flagReason,
    notes: screen.notes,
    cohort,
  };
}

export type DatasetStats = {
  totalReports: number;
  realReports: number;
  seedReports: number;
  pendingReview: number;
  rolesCovered: number;
  citiesCovered: number;
};

export async function datasetStats(): Promise<DatasetStats> {
  const db = await getDb();
  const [totals] = await db
    .select({
      total: count(),
      real: sql<number>`sum(case when ${submissions.source} <> 'seed' then 1 else 0 end)`,
      seed: sql<number>`sum(case when ${submissions.source} = 'seed' then 1 else 0 end)`,
      pending: sql<number>`sum(case when ${submissions.status} = 'pending' then 1 else 0 end)`,
      roles: sql<number>`count(distinct ${submissions.roleSlug})`,
      cities: sql<number>`count(distinct ${submissions.citySlug})`,
    })
    .from(submissions);

  return {
    totalReports: Number(totals?.total ?? 0),
    realReports: Number(totals?.real ?? 0),
    seedReports: Number(totals?.seed ?? 0),
    pendingReview: Number(totals?.pending ?? 0),
    rolesCovered: Number(totals?.roles ?? 0),
    citiesCovered: Number(totals?.cities ?? 0),
  };
}

/** How many real reports exist for one role, used to show coverage honestly. */
export async function realReportCount(roleSlug: string): Promise<number> {
  const db = await getDb();
  const [row] = await db
    .select({ n: count() })
    .from(submissions)
    .where(
      and(
        eq(submissions.roleSlug, roleSlug),
        eq(submissions.status, "approved"),
        sql`${submissions.source} <> 'seed'`,
      ),
    );
  return Number(row?.n ?? 0);
}
