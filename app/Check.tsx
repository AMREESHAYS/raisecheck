"use client";

import { useMemo, useState } from "react";
import { ROLE_TITLES, CITIES, EMPLOYMENT_TYPES, COMPANY_SIZES } from "@/lib/vocab";
import { inrShort, inrFull } from "@/lib/format";
import Chat, { type Profile } from "./Chat";

type Market =
  | {
      n: number;
      p25: number;
      p50: number;
      p75: number;
      rank_pct: number | null;
      basis: { role_category: string; city: string | null; experience: string };
      widened: boolean;
      note: string | null;
    }
  | { insufficient: true; n: number };

type ExternalBench = {
  source: string;
  source_url: string | null;
  license_note: string;
  p25: number | null;
  p50: number;
  p75: number | null;
  sample_size: number | null;
  as_of: string;
};

type Result = {
  is_sample?: boolean;
  you: Profile & { role_category: string; experience_bucket: string };
  held_for_review: boolean;
  market: Market;
  external: ExternalBench[];
  inflation: {
    raisePct: number;
    inflationPct: number;
    realPct: number;
    rupeeDelta: number;
    provisional: boolean;
    verdict: "behind" | "flat" | "ahead";
    sentence: string;
  } | null;
  cpi: { source: string; geography: string; verifiedThrough: number };
  min_sample: number;
  verified_this_month: number;
};

/** Coarse, non-identifying signal to make IP-only rate limiting harder to trivially dodge. */
function fingerprint() {
  const bits = [
    screen.width,
    screen.height,
    new Date().getTimezoneOffset(),
    navigator.language,
    navigator.hardwareConcurrency ?? 0,
  ].join("|");
  let h = 0;
  for (const c of bits) h = (Math.imul(31, h) + c.charCodeAt(0)) | 0;
  return String(h);
}

const NoPii = () => (
  <p className="text-sm leading-relaxed text-muted">
    <span className="font-medium text-ink">We don&apos;t ask for your name or email. Ever.</span>{" "}
    There are no fields for them anywhere in our database. Nothing here can be traced back to you.
  </p>
);

export default function Check({
  initialCount,
  prefill,
}: {
  initialCount: number;
  prefill?: { role_title: string; city: string; years_experience: string };
}) {
  const [form, setForm] = useState({
    role_title: prefill?.role_title ?? "",
    years_experience: prefill?.years_experience ?? "",
    city: prefill?.city ?? "",
    current_ctc_annual: "",
    last_raise_pct: "",
    last_raise_date: "",
    employment_type: "full-time",
    company_size_bucket: "",
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<Result | null>(null);
  const set = (k: keyof typeof form) => (e: { target: { value: string } }) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));

  // Read-only: shows live percentiles for a worked example without writing a row.
  async function showSample() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/sample");
      const json = await res.json();
      if (!res.ok) setError(json.error ?? "Couldn't load the sample.");
      else setResult(json);
    } catch {
      setError("Couldn't reach the server. Try again.");
    } finally {
      setBusy(false);
    }
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/submit", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...form, fp: fingerprint() }),
      });
      const json = await res.json();
      if (!res.ok) setError(json.error ?? "Something went wrong.");
      else setResult(json);
    } catch {
      setError("Couldn't reach the server. Try again.");
    } finally {
      setBusy(false);
    }
  }

  if (result) return <Results result={result} onReset={() => setResult(null)} />;

  const field = "w-full rounded-lg border border-line bg-card px-3 py-3 text-base";
  const label = "mb-1.5 block text-sm font-medium";

  return (
    <main className="mx-auto max-w-xl px-5 pb-24 pt-10 sm:pt-16">
      <p className="text-xs font-medium uppercase tracking-[0.14em] text-muted">RaiseCheck · India</p>
      <h1 className="num mt-4 text-[2.5rem] leading-[1.05] sm:text-5xl">
        Find out what you&apos;re actually worth.
      </h1>
      <p className="mt-4 text-[1.05rem] leading-relaxed text-muted">
        Five fields. See where your CTC sits against real submissions from people in your role and
        city, whether your last raise actually beat inflation, and what to say to your manager about it.
      </p>

      <form onSubmit={submit} className="mt-9 space-y-5">
        <div>
          <label className={label} htmlFor="role">Your role</label>
          <input
            id="role" list="roles" className={field} value={form.role_title}
            onChange={set("role_title")} placeholder="Start typing — e.g. UX Designer"
            autoComplete="off" required
          />
          <datalist id="roles">
            {ROLE_TITLES.map((r) => <option key={r} value={r} />)}
          </datalist>
          <p className="mt-1.5 text-xs text-muted">Pick from the list — we normalise titles so the numbers stay comparable.</p>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className={label} htmlFor="yoe">Years of experience</label>
            <input
              id="yoe" className={field} type="number" inputMode="numeric" min={0} max={50}
              value={form.years_experience} onChange={set("years_experience")} placeholder="3" required
            />
          </div>
          <div>
            <label className={label} htmlFor="city">City</label>
            <select id="city" className={field} value={form.city} onChange={set("city")} required>
              <option value="" disabled>Select</option>
              {CITIES.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
        </div>

        <div>
          <label className={label} htmlFor="ctc">Current annual CTC (₹)</label>
          <input
            id="ctc" className={field} type="number" inputMode="numeric" min={0}
            value={form.current_ctc_annual} onChange={set("current_ctc_annual")} placeholder="1400000" required
          />
          {form.current_ctc_annual && Number(form.current_ctc_annual) > 0 && (
            <p className="num mt-1.5 text-sm text-muted">{inrShort(Number(form.current_ctc_annual))} per year</p>
          )}
        </div>

        <fieldset className="rounded-xl border border-line bg-card p-4">
          <legend className="px-1.5 text-sm font-medium">Your last raise <span className="text-muted">(optional)</span></legend>
          <p className="mb-3 text-xs leading-relaxed text-muted">Needed for the inflation comparison. Skip it and you&apos;ll still get your market range.</p>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className={label} htmlFor="raise">Raise %</label>
              <input id="raise" className={field} type="number" step="0.1" value={form.last_raise_pct}
                onChange={set("last_raise_pct")} placeholder="8" />
            </div>
            <div>
              <label className={label} htmlFor="raisedate">When</label>
              <input id="raisedate" className={field} type="date" value={form.last_raise_date}
                onChange={set("last_raise_date")} max={new Date().toISOString().slice(0, 10)} />
            </div>
          </div>
        </fieldset>

        <details className="text-sm">
          <summary className="cursor-pointer text-muted underline decoration-line underline-offset-4">
            Add employment type and company size
          </summary>
          <div className="mt-4 grid grid-cols-2 gap-4">
            <div>
              <label className={label} htmlFor="etype">Employment</label>
              <select id="etype" className={field} value={form.employment_type} onChange={set("employment_type")}>
                {EMPLOYMENT_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>
            <div>
              <label className={label} htmlFor="size">Company size</label>
              <select id="size" className={field} value={form.company_size_bucket} onChange={set("company_size_bucket")}>
                <option value="">Prefer not to say</option>
                {COMPANY_SIZES.map((t) => <option key={t} value={t}>{t} people</option>)}
              </select>
            </div>
          </div>
        </details>

        {error && (
          <p role="alert" className="rounded-lg border border-under/30 bg-under/5 px-4 py-3 text-sm text-under">
            {error}
          </p>
        )}

        <button
          type="submit" disabled={busy}
          className="w-full rounded-lg bg-ink px-5 py-4 text-base font-medium text-paper disabled:opacity-50"
        >
          {busy ? "Checking…" : "Check my salary"}
        </button>

        <button
          type="button" onClick={showSample} disabled={busy}
          className="w-full rounded-lg border border-line bg-card px-5 py-3.5 text-sm font-medium disabled:opacity-50"
        >
          Or see a sample result first
        </button>

        <div className="rounded-xl border border-line bg-card p-4">
          <NoPii />
        </div>
        <p className="text-center text-xs text-muted">
          {initialCount.toLocaleString("en-IN")} verified submission{initialCount === 1 ? "" : "s"} this month
        </p>
      </form>
    </main>
  );
}

function Results({ result, onReset }: { result: Result; onReset: () => void }) {
  const { you, market, external, inflation } = result;
  const enough = !("insufficient" in market);

  return (
    <main className="mx-auto max-w-xl px-5 pb-6 pt-10">
      <button onClick={onReset} className="text-sm text-muted underline decoration-line underline-offset-4">
        ← Start over
      </button>

      {result.is_sample && (
        <p className="mt-5 rounded-lg border border-line bg-card px-4 py-3 text-sm leading-relaxed">
          <span className="font-medium">This is a sample profile.</span>{" "}
          <span className="text-muted">
            The percentiles and inflation figures below are live — only the person is made up. Nothing
            was saved.
          </span>{" "}
          <button onClick={onReset} className="underline decoration-line underline-offset-4">
            Check your own
          </button>
        </p>
      )}

      <h1 className="num mt-6 text-3xl leading-tight">
        {you.role_title} · {you.experience_bucket} · {you.city}
      </h1>
      <p className="num mt-2 text-[2.75rem] leading-none">{inrShort(you.current_ctc_annual)}</p>
      <p className="mt-1 text-sm text-muted">{inrFull(you.current_ctc_annual)} annual CTC — the figure you gave us</p>

      {result.held_for_review && (
        <p className="mt-6 rounded-lg border border-line bg-card px-4 py-3 text-sm leading-relaxed text-muted">
          Your submission is far from everything else in this bucket, so it&apos;s held for review before it
          counts toward public numbers. You still get your comparison below.
        </p>
      )}

      {enough ? (
        <Verdict market={market} ctc={you.current_ctc_annual} />
      ) : (
        <section className="mt-9 rounded-xl border border-line bg-card p-5">
          <h2 className="num text-xl">Not enough data yet</h2>
          <p className="mt-2 text-sm leading-relaxed text-muted">
            Only {market.n} verified submission{market.n === 1 ? "" : "s"} match. We need at least{" "}
            {result.min_sample} before we&apos;ll put a number on a bucket — a range built on three people
            isn&apos;t a market rate, it&apos;s a rumour. Yours is in. Share this with people in your role
            and check back.
          </p>
        </section>
      )}

      {external.length > 0 && <ExternalRates rows={external} />}

      {inflation ? (
        <section className="mt-9">
          <h2 className="text-xs font-medium uppercase tracking-[0.14em] text-muted">Against inflation</h2>
          <p
            className="num mt-3 text-[1.6rem] leading-snug"
            style={{
              color:
                inflation.verdict === "behind"
                  ? "var(--color-under)"
                  : inflation.verdict === "ahead"
                    ? "var(--color-ontrack)"
                    : undefined,
            }}
          >
            {inflation.sentence}
          </p>
          <p className="mt-3 text-xs leading-relaxed text-muted">
            Compared against all-India CPI (Combined) from MOSPI. City-level CPI is not wired in yet.
            {inflation.provisional && " Part of this period uses a provisional figure."}
          </p>
        </section>
      ) : (
        <section className="mt-9 rounded-xl border border-line bg-card p-5">
          <h2 className="num text-xl">Add your last raise</h2>
          <p className="mt-2 text-sm leading-relaxed text-muted">
            Tell us your last raise % and when you got it, and we&apos;ll show you what it was worth after
            inflation ate its share.
          </p>
        </section>
      )}

      {enough && <ShareRange you={you} market={market} />}

      <div className="mt-9 rounded-xl border border-line bg-card p-4">
        <NoPii />
      </div>

      <Chat
        profile={{
          role_title: you.role_title,
          city: you.city,
          years_experience: you.years_experience,
          current_ctc_annual: you.current_ctc_annual,
          last_raise_pct: you.last_raise_pct,
          last_raise_date: you.last_raise_date,
          employment_type: you.employment_type,
        }}
      />
    </main>
  );
}

/**
 * Sharing spreads the market rate, never the sharer's pay. The link carries only
 * role, city and experience band — the three things that make the number useful
 * to a colleague — and the number in the text is the median, not yours. A share
 * feature on a salary site that leaks the sharer's salary is worse than none.
 */
function ShareRange({
  you,
  market,
}: {
  you: Result["you"] & { experience_bucket: string };
  market: Extract<Market, { p50: number }>;
}) {
  const [done, setDone] = useState(false);

  const link =
    typeof window === "undefined"
      ? ""
      : `${window.location.origin}/?role=${encodeURIComponent(you.role_title)}` +
        `&city=${encodeURIComponent(you.city)}&yrs=${you.years_experience}`;
  const text =
    `${you.role_title}s with ${you.experience_bucket} in ${you.city}: ` +
    `${inrShort(market.p25)}–${inrShort(market.p75)}, median ${inrShort(market.p50)}. ` +
    `From ${market.n} anonymous submissions.`;

  async function share() {
    if (navigator.share) {
      try {
        await navigator.share({ title: "RaiseCheck", text, url: link });
        return;
      } catch {
        // Cancelled, or unavailable in this context — fall through to copying.
      }
    }
    try {
      await navigator.clipboard.writeText(`${text}\n${link}`);
      setDone(true);
      setTimeout(() => setDone(false), 1800);
    } catch {
      /* Clipboard blocked in some in-app browsers. */
    }
  }

  return (
    <section className="mt-9 rounded-xl border border-line bg-card p-5">
      <h2 className="num text-xl">Send this to your team</h2>
      <p className="mt-2 text-sm leading-relaxed text-muted">
        Shares the range for {you.role_title}s in {you.city} — never your own number. More
        submissions is how this bucket stops being {market.n} people.
      </p>
      <p className="mt-3 rounded-lg border border-line bg-paper px-3.5 py-3 text-sm leading-relaxed">
        {text}
      </p>
      <button
        onClick={share}
        className="mt-3 w-full rounded-lg bg-ink px-4 py-3 text-sm font-medium text-paper"
      >
        {done ? "Copied" : "Share the range"}
      </button>
    </section>
  );
}

/**
 * Third-party figures sit in their own block, attributed by name. They are never
 * folded into the percentiles above — two datasets with different methodologies
 * averaged into one number is how a benchmark stops meaning anything.
 */
function ExternalRates({ rows }: { rows: ExternalBench[] }) {
  return (
    <section className="mt-9">
      <h2 className="text-xs font-medium uppercase tracking-[0.14em] text-muted">Other published benchmarks</h2>
      <ul className="mt-3 space-y-3">
        {rows.map((r, i) => (
          <li key={i} className="rounded-xl border border-line bg-card p-4">
            <div className="flex items-baseline justify-between gap-3">
              <span className="text-sm font-medium">
                {r.source_url ? (
                  <a href={r.source_url} target="_blank" rel="noreferrer noopener" className="underline decoration-line underline-offset-4">
                    {r.source}
                  </a>
                ) : (
                  r.source
                )}
              </span>
              <span className="num text-lg">{inrShort(r.p50)}</span>
            </div>
            <p className="mt-1 text-xs text-muted">
              Median{r.p25 != null && r.p75 != null ? ` · ${inrShort(r.p25)}–${inrShort(r.p75)} range` : ""}
              {r.sample_size ? ` · ${r.sample_size} data points` : ""} · as of {r.as_of}
            </p>
            <p className="mt-1 text-xs text-muted">{r.license_note}</p>
          </li>
        ))}
      </ul>
    </section>
  );
}

function Verdict({ market, ctc }: { market: Extract<Market, { p50: number }>; ctc: number }) {
  const rank = market.rank_pct;
  const { lo, hi } = useMemo(
    () => ({ lo: Math.min(market.p25, ctc) * 0.92, hi: Math.max(market.p75, ctc) * 1.08 }),
    [market, ctc],
  );
  const pos = (v: number) => `${((v - lo) / (hi - lo)) * 100}%`;
  const under = ctc < market.p50;
  const accent = under ? "var(--color-under)" : "var(--color-ontrack)";

  return (
    <section className="mt-9">
      <h2 className="text-xs font-medium uppercase tracking-[0.14em] text-muted">Market range</h2>

      <p className="num mt-3 text-[1.6rem] leading-snug" style={{ color: accent }}>
        {rank != null &&
          (rank === 0
            ? "Everyone else in this group is paid more than you. "
            : `You're paid more than ${rank}% of people in this group. `)}
        {under
          ? `The median is ${inrShort(market.p50)} — ${inrShort(market.p50 - ctc)} above you.`
          : `You're at or above the median of ${inrShort(market.p50)}.`}
      </p>

      <div className="mt-8">
        <div className="relative h-14">
          <div
            className="absolute top-6 h-2.5 rounded-full bg-line"
            style={{ left: pos(market.p25), right: `calc(100% - ${pos(market.p75)})` }}
          />
          <div className="absolute top-4 h-6.5 w-px bg-ink" style={{ left: pos(market.p50) }} />
          <div className="absolute top-3 h-8 w-[3px] rounded" style={{ left: pos(ctc), background: accent }} />
          <span
            className="num absolute top-0 -translate-x-1/2 whitespace-nowrap text-xs font-medium"
            style={{ left: `clamp(1.25rem, ${pos(ctc)}, calc(100% - 1.25rem))`, color: accent }}
          >
            you · {inrShort(ctc)}
          </span>
        </div>

        {/* Legend sits in its own row: on a phone, positioned labels collide. */}
        <dl className="mt-1 grid grid-cols-3 border-t border-line pt-3 text-center">
          {([["P25", market.p25], ["Median", market.p50], ["P75", market.p75]] as const).map(([k, v], i) => (
            <div key={k} className={i === 0 ? "text-left" : i === 2 ? "text-right" : ""}>
              <dt className="text-[0.7rem] uppercase tracking-wider text-muted">{k}</dt>
              <dd className="num mt-0.5 text-lg">{inrShort(v)}</dd>
            </div>
          ))}
        </dl>
      </div>

      <p className="mt-6 text-sm leading-relaxed text-muted">
        Based on <span className="font-medium text-ink">{market.n} verified submissions</span> for{" "}
        {market.basis.role_category} roles, {market.basis.experience}
        {market.basis.city ? `, in ${market.basis.city}` : ", across India"}. Percentiles, not an average —
        one outlier shouldn&apos;t move your benchmark.
      </p>
      {market.note && (
        <p className="mt-3 rounded-lg border border-line bg-card px-4 py-3 text-sm leading-relaxed text-muted">
          {market.note}
        </p>
      )}
    </section>
  );
}
