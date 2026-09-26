import { NextResponse } from "next/server";
import { assess } from "@/lib/advice";
import { clientKey, rateLimit } from "@/lib/ratelimit";
import { saveSubmission } from "@/lib/repo";
import { submissionInputSchema } from "@/lib/validate";

export const dynamic = "force-dynamic";

/**
 * Accepts one anonymous salary report and answers with that person's own
 * assessment — the whole exchange the platform is built around: you give data,
 * you immediately get back what it means for you.
 */
export async function POST(request: Request) {
  const limit = rateLimit(`submit:${clientKey(request)}`, 10, 60 * 60 * 1000);
  if (!limit.ok) {
    return NextResponse.json(
      { error: "Too many submissions from this network. Try again later." },
      { status: 429, headers: { "Retry-After": String(limit.retryAfterSec) } },
    );
  }

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ error: "Body must be JSON" }, { status: 400 });
  }

  const parsed = submissionInputSchema.safeParse(payload);
  if (!parsed.success) {
    return NextResponse.json(
      {
        error: "Some answers need fixing",
        issues: parsed.error.issues.map((i) => ({ field: i.path.join("."), message: i.message })),
      },
      { status: 400 },
    );
  }

  const input = parsed.data;
  const saved = await saveSubmission(input);

  if (!saved.accepted) {
    return NextResponse.json(
      {
        accepted: false,
        reason: saved.flagReason,
        notes: saved.notes,
        message:
          saved.flagReason === "duplicate-submission"
            ? "We already have an identical report, so this one wasn't added again."
            : "This report looked implausible against the rest of the data, so it wasn't added. If it's genuine, that usually means your role or city is under-represented — nothing was recorded.",
      },
      { status: 202 },
    );
  }

  // Assess against the cohort as it stood before this row, so the person is not
  // compared against themselves.
  const assessment = assess(saved.cohort, {
    roleSlug: input.roleSlug,
    citySlug: input.citySlug,
    yearsExperience: input.yearsExperience,
    companyType: input.companyType,
    currentTotalInr: input.annualBaseInr + input.annualBonusInr + input.annualEquityInr,
    lastRaisePct: input.lastRaisePct ?? null,
    monthsSinceRaise: input.monthsSinceRaise ?? null,
  });

  return NextResponse.json({
    accepted: true,
    status: saved.status,
    notes: saved.notes,
    heldForReview: saved.status === "pending",
    assessment,
  });
}
