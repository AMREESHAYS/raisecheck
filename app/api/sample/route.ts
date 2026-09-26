import { NextResponse } from "next/server";
import { marketRate, MIN_SAMPLE } from "@/lib/stats";
import { externalBenchmarks, verifiedCountThisMonth } from "@/lib/db";
import { expBucket, ROLES } from "@/lib/vocab";
import { realChange, CPI_META } from "@/lib/inflation";

export const dynamic = "force-dynamic";

/**
 * A worked example, for someone who wants to see the output before handing over
 * their own salary. Read-only on purpose: it computes against live percentiles
 * but writes nothing, so browsing the demo can never pad the submission counts
 * the whole product's credibility rests on.
 */
const SAMPLE = {
  role_title: "Backend Engineer",
  city: "Bangalore",
  years_experience: 4,
  current_ctc_annual: 1_100_000,
  last_raise_pct: 7,
  last_raise_date: "2024-08-01",
  employment_type: "full-time",
};

export async function GET() {
  try {
    const role_category = ROLES[SAMPLE.role_title];
    const b = expBucket(SAMPLE.years_experience);

    const [market, external, verified] = await Promise.all([
      marketRate(role_category, SAMPLE.city, SAMPLE.years_experience, SAMPLE.current_ctc_annual),
      externalBenchmarks({ role_category, city: SAMPLE.city, years: SAMPLE.years_experience }),
      verifiedCountThisMonth(),
    ]);

    return NextResponse.json({
      is_sample: true,
      you: { ...SAMPLE, role_category, experience_bucket: b.label },
      held_for_review: false,
      market,
      external,
      inflation: realChange(
        SAMPLE.current_ctc_annual,
        SAMPLE.last_raise_pct,
        new Date(SAMPLE.last_raise_date),
      ),
      cpi: CPI_META,
      min_sample: MIN_SAMPLE,
      verified_this_month: verified,
    });
  } catch (e) {
    console.error("sample failed", e);
    return NextResponse.json({ error: "Couldn't load the sample right now." }, { status: 503 });
  }
}
