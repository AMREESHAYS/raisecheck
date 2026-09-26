import Check from "./Check";
import { verifiedCountThisMonth, isConfigured } from "@/lib/db";

export const dynamic = "force-dynamic";

export default async function Page() {
  // Without credentials every query fails and the page would quietly claim
  // "0 verified submissions" — which looks like an empty database, not a missing
  // key. Say which it is.
  if (!isConfigured()) return <Setup />;
  return <Check initialCount={await verifiedCountThisMonth()} />;
}

function Setup() {
  const missing = [
    ["SUPABASE_URL", process.env.SUPABASE_URL],
    ["SUPABASE_SERVICE_ROLE_KEY", process.env.SUPABASE_SERVICE_ROLE_KEY],
    ["GROQ_API_KEY", process.env.GROQ_API_KEY],
    ["IP_HASH_SALT", process.env.IP_HASH_SALT],
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
        {missing.map(([name, value]) => (
          <li key={name} className="flex items-center justify-between rounded-lg border border-line bg-card px-4 py-3 text-sm">
            <code>{name}</code>
            <span style={{ color: value ? "var(--color-ontrack)" : "var(--color-under)" }}>
              {value ? "set" : "missing"}
            </span>
          </li>
        ))}
      </ul>

      <p className="mt-6 text-sm leading-relaxed text-muted">
        The database also needs its schema:{" "}
        run <code className="rounded bg-card px-1.5 py-0.5 text-xs">supabase/migrations/0001_init.sql</code>{" "}
        in the Supabase SQL editor. Full steps are in the README.
      </p>
    </main>
  );
}
