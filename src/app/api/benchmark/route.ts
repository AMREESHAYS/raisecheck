import { NextResponse } from "next/server";
import { z } from "zod";
import { assess } from "@/lib/advice";
import { predictFairRange } from "@/lib/benchmark";
import { CITY_SLUGS, COMPANY_TYPE_SLUGS, ROLE_SLUGS } from "@/lib/data/taxonomy";
import { loadRoleRows, realReportCount } from "@/lib/repo";

export const dynamic = "force-dynamic";

const querySchema = z.object({
  role: z.string().refine((v) => ROLE_SLUGS.includes(v), "Unknown role"),
  city: z.string().refine((v) => CITY_SLUGS.includes(v), "Unknown city"),
  years: z.coerce.number().min(0).max(50),
  companyType: z
    .string()
    .refine((v) => COMPANY_TYPE_SLUGS.includes(v), "Unknown company type")
    .optional(),
  /** Optional: include it and you get a full assessment rather than just the range. */
  currentTotal: z.coerce.number().min(0).optional(),
  lastRaisePct: z.coerce.number().min(-50).max(300).optional(),
  monthsSinceRaise: z.coerce.number().min(0).max(600).optional(),
});

export async function GET(request: Request) {
  const url = new URL(request.url);
  const parsed = querySchema.safeParse(Object.fromEntries(url.searchParams));
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid query", issues: parsed.data ?? parsed.error.issues },
      { status: 400 },
    );
  }

  const q = parsed.data;
  const rows = await loadRoleRows(q.role);
  const query = {
    roleSlug: q.role,
    citySlug: q.city,
    yearsExperience: q.years,
    companyType: q.companyType,
  };

  if (q.currentTotal != null) {
    const assessment = assess(rows, {
      ...query,
      currentTotalInr: q.currentTotal,
      lastRaisePct: q.lastRaisePct ?? null,
      monthsSinceRaise: q.monthsSinceRaise ?? null,
    });
    return NextResponse.json({
      assessment,
      realReportsForRole: await realReportCount(q.role),
    });
  }

  const fairRange = predictFairRange(rows, query);
  return NextResponse.json({
    fairRange,
    realReportsForRole: await realReportCount(q.role),
  });
}
