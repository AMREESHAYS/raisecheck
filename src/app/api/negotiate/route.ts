import { NextResponse } from "next/server";
import { z } from "zod";
import { assess } from "@/lib/advice";
import { draftNegotiation } from "@/lib/ai/negotiation";
import { isAiEnabled } from "@/lib/ai/client";
import { CITY_SLUGS, COMPANY_TYPE_SLUGS, ROLE_SLUGS } from "@/lib/data/taxonomy";
import { clientKey, rateLimit } from "@/lib/ratelimit";
import { loadRoleRows } from "@/lib/repo";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

const bodySchema = z.object({
  roleSlug: z.string().refine((v) => ROLE_SLUGS.includes(v), "Unknown role"),
  citySlug: z.string().refine((v) => CITY_SLUGS.includes(v), "Unknown city"),
  companyType: z.string().refine((v) => COMPANY_TYPE_SLUGS.includes(v), "Unknown company type").optional(),
  yearsExperience: z.number().min(0).max(50),
  currentTotalInr: z.number().min(0).max(250_000_000),
  lastRaisePct: z.number().min(-50).max(300).nullable().optional(),
  monthsSinceRaise: z.number().min(0).max(600).nullable().optional(),

  format: z.enum(["email", "script", "message"]).default("email"),
  tone: z.enum(["collaborative", "direct", "formal"]).default("collaborative"),
  achievements: z.string().max(2000).optional(),
  recipient: z.string().max(80).optional(),
  mentionOutsideInterest: z.boolean().default(false),
});

export async function POST(request: Request) {
  const limit = rateLimit(`negotiate:${clientKey(request)}`, isAiEnabled() ? 10 : 40, 10 * 60 * 1000);
  if (!limit.ok) {
    return NextResponse.json(
      { error: "You've hit the draft limit for now. Try again shortly." },
      { status: 429, headers: { "Retry-After": String(limit.retryAfterSec) } },
    );
  }

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ error: "Body must be JSON" }, { status: 400 });
  }

  const parsed = bodySchema.safeParse(payload);
  if (!parsed.success) {
    return NextResponse.json(
      {
        error: "Invalid request",
        issues: parsed.error.issues.map((i) => ({ field: i.path.join("."), message: i.message })),
      },
      { status: 400 },
    );
  }

  const input = parsed.data;
  const rows = await loadRoleRows(input.roleSlug);
  const assessment = assess(rows, {
    roleSlug: input.roleSlug,
    citySlug: input.citySlug,
    yearsExperience: input.yearsExperience,
    companyType: input.companyType,
    currentTotalInr: input.currentTotalInr,
    lastRaisePct: input.lastRaisePct ?? null,
    monthsSinceRaise: input.monthsSinceRaise ?? null,
  });

  if (assessment.fairRange.benchmark.matchLevel === "none") {
    return NextResponse.json(
      {
        error:
          "There isn't enough data for your role yet to build a negotiation case on. Submitting your own salary helps the next person.",
      },
      { status: 422 },
    );
  }

  try {
    const draft = await draftNegotiation({
      assessment,
      roleSlug: input.roleSlug,
      citySlug: input.citySlug,
      format: input.format,
      tone: input.tone,
      achievements: input.achievements,
      recipient: input.recipient,
      mentionOutsideInterest: input.mentionOutsideInterest,
    });
    return NextResponse.json({ draft, assessment });
  } catch (err) {
    console.error("negotiation draft failed", err);
    return NextResponse.json({ error: "Couldn't produce a draft. Please try again." }, { status: 500 });
  }
}
