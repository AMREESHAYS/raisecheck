import { isAiEnabled } from "@/lib/ai/client";
import { CITIES, COMPANY_TYPES, LEVELS, ROLES } from "@/lib/data/taxonomy";
import { CPI_SOURCE_NOTE, INDIA_CPI_INFLATION } from "@/lib/data/inflation";
import { datasetStats } from "@/lib/repo";
import { SaltorApp } from "./components/SaltorApp";
import type { Meta } from "./components/types";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const stats = await datasetStats().catch(() => null);

  const meta: Meta = {
    roles: ROLES.map((r) => ({ slug: r.slug, label: r.label, family: r.family })),
    cities: CITIES.map((c) => ({ slug: c.slug, label: c.label, tier: c.tier })),
    levels: LEVELS.map((l) => ({ slug: l.slug, label: l.label })),
    companyTypes: COMPANY_TYPES.map((c) => ({ slug: c.slug, label: c.label })),
    inflation: { series: INDIA_CPI_INFLATION, note: CPI_SOURCE_NOTE },
    stats,
    aiEnabled: isAiEnabled(),
  };

  return (
    <main className="wrap">
      <h1>Find out if you&apos;re being underpaid.</h1>
      <p className="lede">
        Most people never negotiate because they don&apos;t know what they&apos;re worth. Share your
        salary anonymously, see the real market rate for your role and city, find out whether your
        last raise actually beat inflation — and get the words to ask for more.
      </p>

      {stats && (
        <p className="hint" style={{ marginTop: 14 }}>
          {stats.realReports.toLocaleString("en-IN")} real{" "}
          {stats.realReports === 1 ? "report" : "reports"} and{" "}
          {stats.seedReports.toLocaleString("en-IN")} seeded reference rows across{" "}
          {stats.rolesCovered} roles and {stats.citiesCovered} cities.
          {stats.realReports < 200 &&
            " We're early — reference ranges still carry most of the weight, and we say so on every result."}
        </p>
      )}

      <SaltorApp meta={meta} />
    </main>
  );
}
