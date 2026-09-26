import { NextResponse } from "next/server";
import { z } from "zod";
import { answerQuestion, type ChatTurn } from "@/lib/ai/chat";
import { isAiEnabled } from "@/lib/ai/client";
import { CITY_SLUGS, COMPANY_TYPE_SLUGS, ROLE_SLUGS } from "@/lib/data/taxonomy";
import { clientKey, rateLimit } from "@/lib/ratelimit";
import { loadRoleRows } from "@/lib/repo";

export const dynamic = "force-dynamic";
/** Tool loops plus a thinking model need more than the default budget. */
export const maxDuration = 120;

const bodySchema = z.object({
  messages: z
    .array(
      z.object({
        role: z.enum(["user", "assistant"]),
        content: z.string().min(1).max(4000),
      }),
    )
    .min(1)
    .max(24),
  profile: z
    .object({
      roleSlug: z.string().refine((v) => ROLE_SLUGS.includes(v)),
      citySlug: z.string().refine((v) => CITY_SLUGS.includes(v)),
      yearsExperience: z.number().min(0).max(50),
      companyType: z.string().refine((v) => COMPANY_TYPE_SLUGS.includes(v)).optional(),
      currentTotalInr: z.number().min(0).max(250_000_000).optional(),
      lastRaisePct: z.number().min(-50).max(300).nullable().optional(),
      monthsSinceRaise: z.number().min(0).max(600).nullable().optional(),
    })
    .nullable()
    .optional(),
});

export async function POST(request: Request) {
  // AI calls cost money per request, so this limit is much tighter than the rest.
  const limit = rateLimit(`chat:${clientKey(request)}`, isAiEnabled() ? 20 : 60, 10 * 60 * 1000);
  if (!limit.ok) {
    return NextResponse.json(
      { error: "You've hit the question limit for now. Try again shortly." },
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
      { error: "Invalid request", issues: parsed.error.issues.map((i) => i.message) },
      { status: 400 },
    );
  }

  try {
    const result = await answerQuestion(
      parsed.data.messages as ChatTurn[],
      parsed.data.profile ?? null,
      { loadRoleRows },
    );
    return NextResponse.json(result);
  } catch (err) {
    console.error("chat failed", err);
    return NextResponse.json(
      { error: "Something went wrong answering that. Please try again." },
      { status: 500 },
    );
  }
}
