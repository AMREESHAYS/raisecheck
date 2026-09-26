import type { Metadata } from "next";
import Check from "./Check";
import { verifiedCountThisMonth, isConfigured, missingConfig } from "@/lib/db";
import { ROLES, CITIES, expBucket } from "@/lib/vocab";

export const dynamic = "force-dynamic";

type Search = Promise<{ role?: string; city?: string; yrs?: string }>;

/**
 * A shared link carries the bucket, never a person. The card shows what the role
 * pays; it never shows what the sharer earns.
 */
export async function generateMetadata({ searchParams }: { searchParams: Search }): Promise<Metadata> {
  const { role = "", city = "", yrs = "" } = await searchParams;
  const known =
    role in ROLES && (CITIES as readonly string[]).includes(city) && Number.isFinite(Number(yrs));

  const title = known
    ? `${role} · ${expBucket(Number(yrs)).label} · ${city} — what it pays`
    : "RaiseCheck — is your salary fair?";
  const description = known
    ? `Real salary percentiles for ${role}s in ${city}, from anonymous submissions. No names, no emails, ever.`
    : "Anonymous salary benchmarking for India. See where your CTC sits against real submissions, and whether your last raise actually beat inflation.";

  const og = known
    ? `/api/og?role=${encodeURIComponent(role)}&city=${encodeURIComponent(city)}&yrs=${encodeURIComponent(yrs)}`
    : "/api/og";

  return {
    title,
    description,
    openGraph: { title, description, images: [og], type: "website" },
    twitter: { card: "summary_large_image", title, description, images: [og] },
  };
}

export default async function Page({ searchParams }: { searchParams: Search }) {
  // Without credentials every query fails and the page would quietly claim
  // "0 verified submissions" — which looks like an empty database, not a missing
  // key. Say which it is.
  if (!isConfigured()) return <Setup />;
  const { role = "", city = "", yrs = "" } = await searchParams;
  return (
    <Check
      initialCount={await verifiedCountThisMonth()}
      prefill={{ role_title: role in ROLES ? role : "", city, years_experience: yrs }}
    />
  );
}

function Setup() {
  const required = new Set(missingConfig());
  const vars = [
    ["SUPABASE_URL", process.env.SUPABASE_URL],
    ["SUPABASE_SERVICE_ROLE_KEY", process.env.SUPABASE_SERVICE_ROLE_KEY],
    ["IP_HASH_SALT", process.env.IP_HASH_SALT],
    ["GROQ_API_KEY", process.env.GROQ_API_KEY],
  ] as const;

  return (
    <main className="mx-auto max-w-xl px-5 py-16">
      <p className="text-xs font-medium uppercase tracking-[0.14em] text-muted">Setup</p>
      <h1 className="num mt-4 text-4xl leading-tight">RaiseCheck isn&apos;t configured yet.</h1>
      <p className="mt-4 leading-relaxed text-muted">
        Copy <code className="rounded bg-card px-1.5 py-0.5 text-sm">.env.local.example</code> to{" "}
        <code className="rounded bg-card px-1.5 py-0.5 text-sm">.env.local</code>, fill it in, and
        restart the dev server — Next.js only reads env files at startup.
      </p>

      <ul className="mt-6 space-y-2">
        {vars.map(([name, value]) => (
          <li
            key={name}
            className="flex items-center justify-between rounded-lg border border-line bg-card px-4 py-3 text-sm"
          >
            <code>{name}</code>
            <span style={{ color: value ? "var(--color-ontrack)" : "var(--color-under)" }}>
              {value ? "set" : required.has(name) ? "missing — required" : "missing"}
            </span>
          </li>
        ))}
      </ul>

      <p className="mt-6 text-sm leading-relaxed text-muted">
        The database also needs its schema: run{" "}
        <code className="rounded bg-card px-1.5 py-0.5 text-xs">supabase/migrations/0001_init.sql</code>{" "}
        in the Supabase SQL editor. Full steps are in the README.
      </p>
    </main>
  );
}
