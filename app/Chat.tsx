"use client";

import { useEffect, useRef, useState } from "react";

export type Profile = {
  role_title: string;
  city: string;
  years_experience: number;
  current_ctc_annual: number;
  last_raise_pct: number | null;
  last_raise_date: string | null;
  employment_type: string;
};

type Msg = { role: "user" | "assistant"; content: string };

const SUGGESTIONS = [
  "Am I underpaid?",
  "Should I negotiate or switch jobs?",
  "Draft my negotiation email",
];

function CopyButton({ text, label = "Copy" }: { text: string; label?: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
        } catch {
          return; // Clipboard is blocked in some in-app browsers; fail quietly.
        }
        setDone(true);
        setTimeout(() => setDone(false), 1600);
      }}
      className="mt-3 rounded-md border border-line px-2.5 py-1 text-xs text-muted"
    >
      {done ? "Copied" : label}
    </button>
  );
}

/**
 * The coach answers a negotiation request as "EMAIL ... TALKING POINTS ...".
 * Split it so each half gets its own copy button: the email goes into a mail
 * client, the points get read off a screen in a 1:1. One blob forces the user
 * to hand-separate them in the exact moment they're nervous.
 * Anything that isn't in that shape falls through as plain prose.
 */
function parseCoachReply(text: string) {
  const m = text.match(/^([\s\S]*?)\bTALKING POINTS\b:?\s*([\s\S]*)$/i);
  if (!m) return null;
  const email = m[1].replace(/^\s*EMAIL\s*:?\s*/i, "").trim();
  const points = m[2]
    .split(/\n+/)
    .map((l) => l.replace(/^\s*\d+[.)]\s*/, "").trim())
    .filter(Boolean);
  return email && points.length ? { email, points } : null;
}

function CoachAnswer({ text }: { text: string }) {
  const parsed = parseCoachReply(text);
  if (!parsed) {
    return (
      <>
        <div className="whitespace-pre-wrap text-[0.95rem] leading-relaxed">{text}</div>
        <CopyButton text={text} />
      </>
    );
  }
  return (
    <div className="space-y-5">
      <section>
        <h3 className="text-[0.7rem] font-medium uppercase tracking-[0.14em] text-muted">
          What to say
        </h3>
        <ol className="mt-2 space-y-2.5">
          {parsed.points.map((p, i) => (
            <li key={i} className="flex gap-2.5 text-[0.95rem] leading-relaxed">
              <span className="num shrink-0 text-muted">{i + 1}.</span>
              <span>{p}</span>
            </li>
          ))}
        </ol>
        <CopyButton text={parsed.points.map((p, i) => `${i + 1}. ${p}`).join("\n")} label="Copy points" />
      </section>

      <section className="border-t border-line pt-4">
        <h3 className="text-[0.7rem] font-medium uppercase tracking-[0.14em] text-muted">
          Email draft
        </h3>
        <div className="mt-2 whitespace-pre-wrap text-[0.95rem] leading-relaxed">{parsed.email}</div>
        <CopyButton text={parsed.email} label="Copy email" />
      </section>
    </div>
  );
}

export default function Chat({ profile }: { profile: Profile }) {
  const [open, setOpen] = useState(false);
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [msgs, busy]);

  // The page behind a full-screen chat shouldn't scroll under it.
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);

  async function send(text: string) {
    const q = text.trim();
    if (!q || busy) return;
    const next: Msg[] = [...msgs, { role: "user", content: q }];
    setMsgs(next);
    setDraft("");
    setOpen(true);
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ profile, messages: next }),
      });
      const json = await res.json();
      if (!res.ok) setError(json.error ?? "The coach couldn't answer that.");
      else setMsgs([...next, { role: "assistant", content: json.reply }]);
    } catch {
      setError("Couldn't reach the coach. Try again.");
    } finally {
      setBusy(false);
    }
  }

  if (!open)
    return (
      <div className="sticky bottom-0 -mx-5 mt-10 border-t border-line bg-paper/95 px-5 py-4 backdrop-blur">
        <div className="mx-auto max-w-xl">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              send(draft);
            }}
            className="flex gap-2"
          >
            <input
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder="Ask about your number…"
              className="min-w-0 flex-1 rounded-lg border border-line bg-card px-3 py-3 text-base"
              aria-label="Ask the coach a question"
            />
            <button type="submit" className="rounded-lg bg-ink px-4 py-3 text-sm font-medium text-paper">
              Ask
            </button>
          </form>
          <div className="mt-2 flex flex-wrap gap-2">
            {SUGGESTIONS.map((s) => (
              <button
                key={s}
                onClick={() => send(s)}
                className="rounded-full border border-line bg-card px-3 py-1.5 text-xs text-muted"
              >
                {s}
              </button>
            ))}
          </div>
        </div>
      </div>
    );

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-paper">
      <header className="flex items-center justify-between border-b border-line px-5 py-3">
        <div>
          <p className="num text-lg leading-tight">Negotiation coach</p>
          <p className="text-xs text-muted">Answers from your numbers only</p>
        </div>
        <button onClick={() => setOpen(false)} className="rounded-md border border-line px-3 py-1.5 text-sm">
          Close
        </button>
      </header>

      <div className="flex-1 overflow-y-auto px-5 py-5">
        <div className="mx-auto max-w-xl space-y-5">
          {msgs.map((m, i) =>
            m.role === "user" ? (
              <p key={i} className="ml-auto max-w-[85%] rounded-2xl rounded-br-sm bg-ink px-4 py-2.5 text-[0.95rem] text-paper">
                {m.content}
              </p>
            ) : (
              <div key={i} className="max-w-[92%] rounded-2xl rounded-bl-sm border border-line bg-card px-4 py-3.5">
                <CoachAnswer text={m.content} />
              </div>
            ),
          )}
          {busy && <p className="text-sm text-muted">Thinking…</p>}
          {error && (
            <p role="alert" className="rounded-lg border border-under/30 bg-under/5 px-4 py-3 text-sm text-under">
              {error}
            </p>
          )}
          <div ref={endRef} />
        </div>
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          send(draft);
        }}
        className="border-t border-line px-5 py-4"
      >
        <div className="mx-auto flex max-w-xl gap-2">
          <input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="Ask a follow-up…"
            autoFocus
            className="min-w-0 flex-1 rounded-lg border border-line bg-card px-3 py-3 text-base"
            aria-label="Ask a follow-up"
          />
          <button
            type="submit"
            disabled={busy}
            className="rounded-lg bg-ink px-4 py-3 text-sm font-medium text-paper disabled:opacity-40"
          >
            Send
          </button>
        </div>
      </form>
    </div>
  );
}
