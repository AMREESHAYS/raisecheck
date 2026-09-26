import { NextResponse } from "next/server";
import { CITIES, COMPANY_TYPES, LEVELS, ROLES } from "@/lib/data/taxonomy";
import { CPI_SOURCE_NOTE, INDIA_CPI_INFLATION } from "@/lib/data/inflation";
import { datasetStats } from "@/lib/repo";
import { isAiEnabled } from "@/lib/ai/client";

export const dynamic = "force-dynamic";

/** Everything the client needs to render the forms and be honest about coverage. */
export async function GET() {
  const stats = await datasetStats().catch(() => null);
  return NextResponse.json({
    roles: ROLES.map((r) => ({ slug: r.slug, label: r.label, family: r.family })),
    cities: CITIES.map((c) => ({ slug: c.slug, label: c.label, tier: c.tier })),
    levels: LEVELS.map((l) => ({ slug: l.slug, label: l.label })),
    companyTypes: COMPANY_TYPES.map((c) => ({ slug: c.slug, label: c.label })),
    inflation: { series: INDIA_CPI_INFLATION, note: CPI_SOURCE_NOTE },
    stats,
    aiEnabled: isAiEnabled(),
  });
}
