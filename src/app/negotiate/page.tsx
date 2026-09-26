import Link from "next/link";
import { isAiEnabled } from "@/lib/ai/client";
import { CITIES, COMPANY_TYPES, LEVELS, ROLES } from "@/lib/data/taxonomy";
import { CPI_SOURCE_NOTE, INDIA_CPI_INFLATION } from "@/lib/data/inflation";
import { datasetStats } from "@/lib/repo";
import { Negotiator } from "../components/Negotiator";
import type { Meta } from "../components/types";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Ask for a raise — Saltor",
  description:
    "Build the case for your raise: the market rate for your role, whether your last raise beat inflation, your talking points, and the message to send.",
};

export default async function NegotiatePage() {
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
      <h1>Ask for the raise. With the data behind you.</h1>
      <p className="lede">
        Tell us your role, city and current pay. You get the market rate, what this role pays as you
        grow, the exact lines to say, what to do when they push back — and a message ready to send.
      </p>
      <p className="hint" style={{ marginTop: 12 }}>
        No account. Nothing you type here is stored.{" "}
        <Link href="/">Want to check if you&apos;re underpaid first? →</Link>
      </p>

      <Negotiator meta={meta} />
    </main>
  );
}
