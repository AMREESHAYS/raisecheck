"use client";

import { useState } from "react";
import type { Assessment } from "@/lib/advice";
import type { Evidence } from "@/lib/evidence";
import { formatInr, formatInrShort, parseInr } from "@/lib/format";
import type { Meta } from "./types";

type Draft = {
  subject: string | null;
  body: string;
  aiGenerated: boolean;
  figures: { currentPay: string; askFor: string; marketMidpoint: string; percentile: number };
};

type Result = { draft: Draft; assessment: Assessment; evidence: Evidence };

/**
 * The standalone negotiation builder.
 *
 * Deliberately does not require a salary submission first: someone about to walk
 * into a pay conversation needs the words now, not a data-donation gate.
 */
export function Negotiator({ meta }: { meta: Meta }) {
  const [roleSlug, setRole] = useState("software-engineer");
  const [citySlug, setCity] = useState("bengaluru");
  const [companyType, setCompanyType] = useState("indian-it-services");
  const [years, setYears] = useState("4");
  const [pay, setPay] = useState("");
  const [raise, setRaise] = useState("");
  const [months, setMonths] = useState("");
  const [format, setFormat] = useState<"email" | "script" | "message">("email");
  const [tone, setTone] = useState<"collaborative" | "direct" | "formal">("collaborative");
  const [achievements, setAchievements] = useState("");
  const [recipient, setRecipient] = useState("");
  const [mentionOutside, setMentionOutside] = useState(false);

  const [result, setResult] = useState<Result | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const parsedPay = parseInr(pay);

  async function build(event?: React.FormEvent) {
    event?.preventDefault();
    setError(null);
    setCopied(false);

    const total = parseInr(pay);
    const yearsNum = Number.parseFloat(years);
    if (total == null || total <= 0) return setError("Enter your current total annual pay.");
    if (!Number.isFinite(yearsNum)) return setError("Enter your years of experience.");

    setBusy(true);
    try {
      const response = await fetch("/api/negotiate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          roleSlug,
          citySlug,
          companyType,
          yearsExperience: yearsNum,
          currentTotalInr: total,
          lastRaisePct: raise.trim() === "" ? null : Number.parseFloat(raise),
          monthsSinceRaise: months.trim() === "" ? null : Math.round(Number.parseFloat(months)),
          format,
          tone,
          achievements: achievements.trim() || undefined,
          recipient: recipient.trim() || undefined,
          mentionOutsideInterest: mentionOutside,
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "Couldn't build your case");
      setResult(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setBusy(false);
    }
  }

  async function copy() {
    if (!result) return;
    const d = result.draft;
    try {
      await navigator.clipboard.writeText(d.subject ? `Subject: ${d.subject}\n\n${d.body}` : d.body);
      setCopied(true);
    } catch {
      setError("Couldn't copy automatically — select the text and copy it.");
    }
  }

  const maxMedian = result
    ? Math.max(...result.evidence.trajectory.map((t) => t.median), result.assessment.currentTotalInr)
    : 0;

  return (
    <>
      <form className="card" onSubmit={build}>
        <h2 style={{ marginTop: 0 }}>Your situation</h2>
        <div className="grid2">
          <div>
            <label htmlFor="n-role">Role</label>
            <select id="n-role" value={roleSlug} onChange={(e) => setRole(e.target.value)}>
              {meta.roles.map((r) => (
                <option key={r.slug} value={r.slug}>{r.label}</option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="n-city">City</label>
            <select id="n-city" value={citySlug} onChange={(e) => setCity(e.target.value)}>
              {meta.cities.map((c) => (
                <option key={c.slug} value={c.slug}>{c.label}</option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="n-company">Company type</label>
            <select id="n-company" value={companyType} onChange={(e) => setCompanyType(e.target.value)}>
              {meta.companyTypes.map((c) => (
                <option key={c.slug} value={c.slug}>{c.label}</option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="n-years">Years of experience</label>
            <input id="n-years" inputMode="decimal" value={years} onChange={(e) => setYears(e.target.value)} />
          </div>
          <div>
            <label htmlFor="n-pay">Current total annual pay</label>
            <input
              id="n-pay"
              inputMode="decimal"
              placeholder="e.g. 12L or 1200000"
              value={pay}
              onChange={(e) => setPay(e.target.value)}
            />
            <div className="hint">
              {pay.trim() !== "" && parsedPay == null
                ? "Couldn't read that — try 12L or 1200000."
                : parsedPay != null
                  ? `Read as ${formatInr(parsedPay)} per year (base + bonus + equity).`
                  : "Base + bonus + equity."}
            </div>
          </div>
        </div>

        <h3>Your last raise (optional)</h3>
        <p className="hint" style={{ marginTop: -4, marginBottom: 12 }}>
          Add this and your case gains its strongest line: whether your raise actually beat inflation.
        </p>
        <div className="grid2">
          <div>
            <label htmlFor="n-raise">Last raise (%)</label>
            <input id="n-raise" inputMode="decimal" placeholder="e.g. 8" value={raise} onChange={(e) => setRaise(e.target.value)} />
          </div>
          <div>
            <label htmlFor="n-months">Months since then</label>
            <input id="n-months" inputMode="numeric" placeholder="e.g. 18" value={months} onChange={(e) => setMonths(e.target.value)} />
          </div>
        </div>

        <h3>The message</h3>
        <div className="grid2">
          <div>
            <label htmlFor="n-format">Format</label>
            <select id="n-format" value={format} onChange={(e) => setFormat(e.target.value as typeof format)}>
              <option value="email">Email to my manager</option>
              <option value="script">Script for the conversation</option>
              <option value="message">Short chat message</option>
            </select>
          </div>
          <div>
            <label htmlFor="n-tone">Tone</label>
            <select id="n-tone" value={tone} onChange={(e) => setTone(e.target.value as typeof tone)}>
              <option value="collaborative">Collaborative</option>
              <option value="direct">Direct</option>
              <option value="formal">Formal</option>
            </select>
          </div>
          <div>
            <label htmlFor="n-to">Their first name (optional)</label>
            <input id="n-to" value={recipient} placeholder="e.g. Priya" onChange={(e) => setRecipient(e.target.value)} />
          </div>
        </div>

        <div style={{ marginTop: 14 }}>
          <label htmlFor="n-ach">What have you delivered this year?</label>
          <textarea
            id="n-ach"
            value={achievements}
            placeholder="e.g. Led the payments migration, cut checkout errors by 40%, took over on-call for two teams"
            onChange={(e) => setAchievements(e.target.value)}
          />
          <div className="hint">Leave it blank and the draft marks a placeholder rather than inventing anything.</div>
        </div>

        <div className="checkline" style={{ marginTop: 14 }}>
          <input id="n-out" type="checkbox" checked={mentionOutside} onChange={(e) => setMentionOutside(e.target.checked)} />
          <label htmlFor="n-out" style={{ fontWeight: 400 }}>
            I&apos;m comfortable mentioning that I&apos;m interviewing elsewhere
          </label>
        </div>

        {error && <p className="error">{error}</p>}

        <div className="row" style={{ marginTop: 18 }}>
          <button type="submit" disabled={busy}>
            {busy ? "Building your case…" : result ? "Rebuild my case" : "Build my case"}
          </button>
        </div>
      </form>

      {result && (
        <>
          <div className="card">
            <h2 style={{ marginTop: 0 }}>What the market says</h2>
            <div className="stats">
              <div className="stat">
                <div className="k">You&apos;re on</div>
                <div className="v">{formatInr(result.assessment.currentTotalInr)}</div>
              </div>
              <div className="stat">
                <div className="k">Market midpoint</div>
                <div className="v">{formatInr(result.assessment.fairRange.point)}</div>
              </div>
              <div className="stat">
                <div className="k">Your percentile</div>
                <div className="v">{result.assessment.marketPercentile}th</div>
              </div>
              <div className="stat">
                <div className="k">Ask for</div>
                <div className="v" style={{ color: "var(--accent)" }}>
                  {formatInr(result.assessment.internalAskInr)}
                </div>
              </div>
            </div>

            <h3>How this role pays as you grow</h3>
            <table className="dist-table">
              <thead>
                <tr>
                  <th>Experience</th>
                  <th>Market median</th>
                  <th style={{ width: "45%" }}></th>
                </tr>
              </thead>
              <tbody>
                {result.evidence.trajectory.map((t) => (
                  <tr key={t.years}>
                    <td style={{ fontWeight: t.isYou ? 620 : 400 }}>
                      {t.label}
                      {t.isYou ? " (you)" : ""}
                    </td>
                    <td style={{ fontWeight: t.isYou ? 620 : 400 }}>{formatInrShort(t.median)}</td>
                    <td>
                      <div
                        style={{
                          height: 10,
                          borderRadius: 5,
                          width: `${(t.median / maxMedian) * 100}%`,
                          background: t.isYou ? "var(--accent)" : "var(--border-strong)",
                        }}
                        aria-hidden
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="hint">
              Based on {result.assessment.fairRange.benchmark.sampleSize} comparable reports (
              {result.assessment.fairRange.benchmark.realSampleSize} real){" "}
              <span className={`badge ${result.assessment.fairRange.benchmark.confidence}`}>
                {result.assessment.fairRange.benchmark.confidence} confidence
              </span>
            </p>
            {result.assessment.caveats.map((c, i) => (
              <div className="note warn" key={i}>{c}</div>
            ))}
          </div>

          <div className="card">
            <h2 style={{ marginTop: 0 }}>Your talking points</h2>
            <p className="hint" style={{ marginBottom: 12 }}>
              Say these, in this order. Every number comes from the data above.
            </p>
            <ul className="reasons">
              {result.evidence.talkingPoints.map((t, i) => (
                <li key={i}>{t}</li>
              ))}
            </ul>
          </div>

          <div className="card">
            <h2 style={{ marginTop: 0 }}>When they push back</h2>
            {result.evidence.objections.map((o, i) => (
              <div key={i} style={{ marginBottom: 16 }}>
                <p style={{ margin: "0 0 4px", fontWeight: 600, fontSize: "0.93rem" }}>{o.objection}</p>
                <div className="note">{o.response}</div>
              </div>
            ))}
          </div>

          <div className="card">
            <div className="row spread">
              <h2 style={{ margin: 0 }}>Your message</h2>
              <button type="button" className="secondary tiny" onClick={copy}>
                {copied ? "Copied" : "Copy"}
              </button>
            </div>
            <div className="draft" style={{ marginTop: 14 }}>
              {result.draft.subject && <div className="draft-subject">Subject: {result.draft.subject}</div>}
              {result.draft.body}
            </div>
            <p className="hint" style={{ marginTop: 10 }}>
              Asking for {result.draft.figures.askFor} · currently {result.draft.figures.currentPay} ·
              market midpoint {result.draft.figures.marketMidpoint}
              {result.draft.aiGenerated ? "" : " · written from a template (no AI key configured)"}
            </p>
          </div>
        </>
      )}
    </>
  );
}
