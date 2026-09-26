"use client";

import { useState } from "react";
import type { FormValues } from "./SalaryForm";

type Draft = {
  subject: string | null;
  body: string;
  aiGenerated: boolean;
  figures: { currentPay: string; askFor: string; marketMidpoint: string; percentile: number };
};

export function NegotiatePanel({ values }: { values: FormValues }) {
  const [format, setFormat] = useState<"email" | "script" | "message">("email");
  const [tone, setTone] = useState<"collaborative" | "direct" | "formal">("collaborative");
  const [achievements, setAchievements] = useState("");
  const [recipient, setRecipient] = useState("");
  const [mentionOutside, setMentionOutside] = useState(false);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  async function generate() {
    setBusy(true);
    setError(null);
    setCopied(false);
    try {
      const response = await fetch("/api/negotiate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          roleSlug: values.roleSlug,
          citySlug: values.citySlug,
          companyType: values.companyType,
          yearsExperience: values.yearsExperience,
          currentTotalInr:
            values.annualBaseInr + values.annualBonusInr + values.annualEquityInr,
          lastRaisePct: values.lastRaisePct,
          monthsSinceRaise: values.monthsSinceRaise,
          format,
          tone,
          achievements: achievements.trim() || undefined,
          recipient: recipient.trim() || undefined,
          mentionOutsideInterest: mentionOutside,
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "Couldn't produce a draft");
      setDraft(data.draft);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setBusy(false);
    }
  }

  async function copy() {
    if (!draft) return;
    const text = draft.subject ? `Subject: ${draft.subject}\n\n${draft.body}` : draft.body;
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
    } catch {
      setError("Couldn't copy automatically — select the text and copy it manually.");
    }
  }

  return (
    <div className="card">
      <h2 style={{ marginTop: 0 }}>Get the words</h2>
      <p className="hint" style={{ marginBottom: 16 }}>
        A message you can actually send, using your own numbers. Every figure in it comes from your
        assessment — nothing is invented.
      </p>

      <div className="grid2">
        <div>
          <label htmlFor="format">Format</label>
          <select id="format" value={format} onChange={(e) => setFormat(e.target.value as typeof format)}>
            <option value="email">Email to my manager</option>
            <option value="script">Script for a conversation</option>
            <option value="message">Short chat message</option>
          </select>
        </div>
        <div>
          <label htmlFor="tone">Tone</label>
          <select id="tone" value={tone} onChange={(e) => setTone(e.target.value as typeof tone)}>
            <option value="collaborative">Collaborative</option>
            <option value="direct">Direct</option>
            <option value="formal">Formal</option>
          </select>
        </div>
        <div>
          <label htmlFor="recipient">Their first name (optional)</label>
          <input
            id="recipient"
            value={recipient}
            placeholder="e.g. Priya"
            onChange={(e) => setRecipient(e.target.value)}
          />
        </div>
      </div>

      <div style={{ marginTop: 14 }}>
        <label htmlFor="achievements">What have you delivered this year?</label>
        <textarea
          id="achievements"
          value={achievements}
          placeholder="e.g. Led the payments migration, cut checkout errors by 40%, took over on-call for two teams"
          onChange={(e) => setAchievements(e.target.value)}
        />
        <div className="hint">
          Specifics make the difference. Leave it blank and the draft will mark a placeholder rather
          than make something up.
        </div>
      </div>

      <div className="checkline" style={{ marginTop: 14 }}>
        <input
          id="outside"
          type="checkbox"
          checked={mentionOutside}
          onChange={(e) => setMentionOutside(e.target.checked)}
        />
        <label htmlFor="outside" style={{ fontWeight: 400 }}>
          I&apos;m comfortable mentioning that I&apos;m interviewing elsewhere
        </label>
      </div>

      <div className="row" style={{ marginTop: 18 }}>
        <button type="button" onClick={generate} disabled={busy}>
          {busy ? "Writing…" : draft ? "Rewrite it" : "Write my message"}
        </button>
        {draft && (
          <button type="button" className="secondary" onClick={copy}>
            {copied ? "Copied" : "Copy"}
          </button>
        )}
      </div>

      {error && <p className="error">{error}</p>}

      {draft && (
        <>
          <div className="draft" style={{ marginTop: 18 }}>
            {draft.subject && <div className="draft-subject">Subject: {draft.subject}</div>}
            {draft.body}
          </div>
          <p className="hint" style={{ marginTop: 10 }}>
            Asking for {draft.figures.askFor} · currently {draft.figures.currentPay} · market
            midpoint {draft.figures.marketMidpoint}
            {draft.aiGenerated ? "" : " · written from a template (no AI key configured)"}
          </p>
        </>
      )}
    </div>
  );
}
