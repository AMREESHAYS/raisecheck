import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { validate } from "@/lib/validate";
import {
  hashClient, hasRecentSubmission, insertSubmission, bucketStats,
  verifiedCountThisMonth, externalBenchmarks, missingConfig,
} from "@/lib/db";
import { isOutlier, marketRate, MIN_SAMPLE } from "@/lib/stats";
import { expBucket } from "@/lib/vocab";
import { realChange, CPI_META } from "@/lib/inflation";
import { clientIp } from "@/lib/request";

export async function POST(req: Request) {
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Bad request." }, { status: 400 });
  }

  const v = validate(body);
  if (!v.ok) return NextResponse.json({ error: v.error }, { status: 400 });
  const s = v.value;

  try {
    const ipHash = hashClient(clientIp(req), String(body.fp ?? ""));
    if (await hasRecentSubmission(ipHash, s.role_title))
      return NextResponse.json(
        { error: "You already submitted this role today. One submission per role per 24 hours." },
        { status: 429 },
      );

    // Outlier check runs against the peers this row would join, before it joins them.
    const b = expBucket(s.years_experience);
    const peers = await bucketStats({
      role_category: s.role_category,
      city: s.city,
      minYears: b.min,
      maxYears: b.max,
    });
    const flagged = s.needsReview || isOutlier(s.current_ctc_annual, peers);

    await insertSubmission({
      id: randomUUID(),
      role_title: s.role_title,
      role_category: s.role_category,
      years_experience: s.years_experience,
      city: s.city,
      current_ctc_annual: s.current_ctc_annual,
      last_raise_pct: s.last_raise_pct,
      last_raise_date: s.last_raise_date,
      employment_type: s.employment_type,
      company_size_bucket: s.company_size_bucket,
      employer_segment: s.employer_segment,
      submitted_at: new Date().toISOString(),
      ip_hash: ipHash,
      status: flagged ? "pending" : "verified",
    });

    const market = await marketRate(s.role_category, s.city, s.years_experience, s.current_ctc_annual);
    const external = await externalBenchmarks({
      role_category: s.role_category,
      city: s.city,
      years: s.years_experience,
      segment: s.employer_segment,
    });

    const inflation =
      s.last_raise_pct != null && s.last_raise_date != null
        ? realChange(s.current_ctc_annual, s.last_raise_pct, new Date(s.last_raise_date))
        : null;

    return NextResponse.json({
      you: {
        role_title: s.role_title,
        role_category: s.role_category,
        city: s.city,
        years_experience: s.years_experience,
        experience_bucket: b.label,
        current_ctc_annual: s.current_ctc_annual,
        last_raise_pct: s.last_raise_pct,
        last_raise_date: s.last_raise_date,
        employment_type: s.employment_type,
        employer_segment: s.employer_segment,
      },
      held_for_review: flagged,
      market,
      external,
      inflation,
      cpi: CPI_META,
      min_sample: MIN_SAMPLE,
      verified_this_month: await verifiedCountThisMonth(),
    });
  } catch (e) {
    console.error("submit failed", e);
    // "Try again in a moment" is a lie when the server is misconfigured — no
    // amount of retrying fixes a missing environment variable. Say which it is.
    const missing = missingConfig();
    return NextResponse.json(
      {
        error: missing.length
          ? `Server isn't configured: ${missing.join(", ")} missing. Add it and redeploy.`
          : "We couldn't save that right now. Try again in a moment.",
      },
      { status: 503 },
    );
  }
}
