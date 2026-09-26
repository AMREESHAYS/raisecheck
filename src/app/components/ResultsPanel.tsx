"use client";

import type { Assessment } from "@/lib/advice";
import { formatInr } from "@/lib/format";
import { PercentileBar } from "./PercentileBar";

const VERDICT_CLASS: Record<Assessment["verdict"], string> = {
  underpaid: "under",
  "fairly-paid": "fair",
  "above-market": "over",
};

function headline(a: Assessment): string {
  if (a.verdict === "underpaid") {
    return `You're underpaid by about ${formatInr(Math.abs(a.gapInr))} a year.`;
  }
  if (a.verdict === "above-market") return "You're paid above the market for your profile.";
  return "You're roughly at market for your profile.";
}

const ACTION_HEADING: Record<Assessment["action"], string> = {
  hold: "Nothing urgent to do",
  negotiate: "Ask for a raise",
  "negotiate-then-switch": "Ask now, and start interviewing",
  switch: "Start looking",
};

export function ResultsPanel({ assessment: a }: { assessment: Assessment }) {
  const b = a.fairRange.benchmark;

  if (b.matchLevel === "none") {
    return (
      <div className="card">
        <h2 style={{ marginTop: 0 }}>Not enough data yet</h2>
        <p>
          We don&apos;t have enough comparable reports for your role to say anything honest about
          it. Rather than show you a guess, we&apos;re showing you nothing.
        </p>
        <p className="hint">
          Your submission was recorded, which makes this better for the next person in your role.
        </p>
      </div>
    );
  }

  return (
    <>
      <div className="card">
        <p className={`verdict ${VERDICT_CLASS[a.verdict]}`}>{headline(a)}</p>
        <p className="hint" style={{ fontSize: "0.88rem" }}>
          Compared against: {b.cohortLabel} · {b.sampleSize}{" "}
          {b.sampleSize === 1 ? "report" : "reports"} ({b.realSampleSize} real){" "}
          <span className={`badge ${b.confidence}`}>{b.confidence} confidence</span>
        </p>

        <div className="stats">
          <div className="stat">
            <div className="k">Your total pay</div>
            <div className="v">{formatInr(a.currentTotalInr)}</div>
          </div>
          <div className="stat">
            <div className="k">Fair range</div>
            <div className="v" style={{ fontSize: "0.98rem" }}>
              {formatInr(a.fairRange.low)} – {formatInr(a.fairRange.high)}
            </div>
          </div>
          <div className="stat">
            <div className="k">Fair midpoint</div>
            <div className="v">{formatInr(a.fairRange.point)}</div>
          </div>
          <div className="stat">
            <div className="k">Your percentile</div>
            <div className="v">{a.marketPercentile}th</div>
          </div>
        </div>

        <PercentileBar
          percentiles={b.percentiles}
          you={a.currentTotalInr}
          youPercentile={a.marketPercentile}
        />
      </div>

      {a.realRaise && (
        <div className="card">
          <h2 style={{ marginTop: 0 }}>Your raise vs. real inflation</h2>
          <div className="stats">
            <div className="stat">
              <div className="k">Your last raise</div>
              <div className="v">{a.realRaise.nominalRaisePct}%</div>
            </div>
            <div className="stat">
              <div className="k">Inflation, same period</div>
              <div className="v">{a.realRaise.inflationPct}%</div>
            </div>
            <div className="stat">
              <div className="k">Real raise</div>
              <div className="v" style={{ color: a.realRaise.losingGround ? "var(--danger)" : "var(--good)" }}>
                {a.realRaise.realRaisePct > 0 ? "+" : ""}
                {a.realRaise.realRaisePct}%
              </div>
            </div>
            <div className="stat">
              <div className="k">Break-even pay</div>
              <div className="v">{formatInr(a.realRaise.breakEvenSalary)}</div>
            </div>
          </div>
          <div className={`note ${a.realRaise.losingGround ? "bad" : "good"}`}>
            {a.realRaise.losingGround ? (
              <>
                Over {a.realRaise.months} months, prices rose {a.realRaise.inflationPct}% while your
                pay rose {a.realRaise.nominalRaisePct}%. In real terms that is a{" "}
                {Math.abs(a.realRaise.realRaisePct)}% pay cut. You would need{" "}
                {formatInr(a.realRaise.breakEvenSalary)} just to be where you were.
              </>
            ) : (
              <>
                Your {a.realRaise.nominalRaisePct}% raise beat {a.realRaise.inflationPct}% inflation
                over the same {a.realRaise.months} months — a real gain of{" "}
                {a.realRaise.realRaisePct}%.
              </>
            )}
          </div>
          <p className="hint">{a.realRaise.note}</p>
        </div>
      )}

      <div className="card">
        <h2 style={{ marginTop: 0 }}>{ACTION_HEADING[a.action]}</h2>
        <ul className="reasons">
          {a.reasons.map((r, i) => (
            <li key={i}>{r}</li>
          ))}
        </ul>

        {a.action !== "hold" && (
          <div className="stats">
            <div className="stat">
              <div className="k">Ask for (internal)</div>
              <div className="v">{formatInr(a.internalAskInr)}</div>
            </div>
            <div className="stat">
              <div className="k">A switch could land</div>
              <div className="v">{formatInr(a.switchTargetInr)}</div>
            </div>
            <div className="stat">
              <div className="k">Job-switch premium</div>
              <div className="v">{Math.round(a.switchPremium.premiumPct)}%</div>
            </div>
          </div>
        )}

        {a.caveats.length > 0 && (
          <>
            <h3>What to keep in mind</h3>
            {a.caveats.map((c, i) => (
              <div className="note warn" key={i}>
                {c}
              </div>
            ))}
          </>
        )}

        <details style={{ marginTop: 14 }}>
          <summary className="hint" style={{ cursor: "pointer" }}>
            How this number was calculated
          </summary>
          <p className="hint" style={{ marginTop: 8 }}>
            {a.fairRange.method}
          </p>
          <table className="dist-table">
            <thead>
              <tr>
                <th>Adjustment applied</th>
                <th>Factor</th>
              </tr>
            </thead>
            <tbody>
              {a.fairRange.adjustments.map((adj, i) => (
                <tr key={i}>
                  <td>{adj.label}</td>
                  <td>{adj.factor === 1 ? "—" : `×${adj.factor}`}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </details>
      </div>
    </>
  );
}
