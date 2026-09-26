"use client";

import { useRef, useState } from "react";

type Turn = { role: "user" | "assistant"; content: string; grounding?: string[] };

export type ChatProfile = {
  roleSlug: string;
  citySlug: string;
  yearsExperience: number;
  companyType?: string;
  currentTotalInr?: number;
  lastRaisePct?: number | null;
  monthsSinceRaise?: number | null;
};

const STARTERS = [
  "Am I underpaid?",
  "Should I ask for a raise or switch jobs?",
  "What would I earn in Bengaluru instead?",
  "Did my last raise beat inflation?",
];

export function ChatPanel({
  profile,
  aiEnabled,
}: {
  profile: ChatProfile | null;
  aiEnabled: boolean;
}) {
  const [turns, setTurns] = useState<Turn[]>([]);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const logEnd = useRef<HTMLDivElement>(null);

  async function ask(question: string) {
    const text = question.trim();
    if (text === "" || busy) return;

    const history: Turn[] = [...turns, { role: "user", content: text }];
    setTurns(history);
    setDraft("");
    setBusy(true);
    setError(null);

    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: history.map(({ role, content }) => ({ role, content })),
          profile,
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "Request failed");

      setTurns([
        ...history,
        {
          role: "assistant",
          content: data.reply,
          grounding: (data.toolCalls ?? []).map((c: { name: string }) => c.name),
        },
      ]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
      setTurns(history);
    } finally {
      setBusy(false);
      requestAnimationFrame(() => logEnd.current?.scrollIntoView({ behavior: "smooth" }));
    }
  }

  return (
    <div className="card">
      <h2 style={{ marginTop: 0 }}>Ask about your pay</h2>
      <p className="hint" style={{ marginBottom: 14 }}>
        {aiEnabled
          ? "Answers are built from the dataset — if there's no data, it will say so rather than guess."
          : "No AI key is configured on this deployment, so answers come from the data engine directly, in a fixed format."}
      </p>

      {turns.length > 0 && (
        <div className="chat-log">
          {turns.map((turn, i) => (
            <div key={i} className={`bubble ${turn.role === "user" ? "user" : "bot"}`}>
              {turn.content}
              {turn.grounding && turn.grounding.length > 0 && (
                <div className="grounding">
                  grounded in: {Array.from(new Set(turn.grounding)).join(", ")}
                </div>
              )}
            </div>
          ))}
          {busy && <div className="bubble bot pending">Checking the data…</div>}
          <div ref={logEnd} />
        </div>
      )}

      {turns.length === 0 && (
        <div className="suggestions">
          {STARTERS.map((s) => (
            <button key={s} type="button" className="secondary tiny" onClick={() => ask(s)} disabled={busy}>
              {s}
            </button>
          ))}
        </div>
      )}

      <form
        className="row"
        onSubmit={(e) => {
          e.preventDefault();
          ask(draft);
        }}
      >
        <label htmlFor="chat-input" className="sr">
          Your question
        </label>
        <input
          id="chat-input"
          value={draft}
          placeholder="Ask anything about your pay…"
          onChange={(e) => setDraft(e.target.value)}
          style={{ flex: 1, minWidth: 200 }}
          disabled={busy}
        />
        <button type="submit" disabled={busy || draft.trim() === ""}>
          Ask
        </button>
      </form>

      {error && <p className="error">{error}</p>}
      {!profile && (
        <p className="hint" style={{ marginTop: 10 }}>
          Fill in your details above first and the answers become specific to you.
        </p>
      )}
    </div>
  );
}
