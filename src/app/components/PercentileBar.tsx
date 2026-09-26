"use client";

import { formatInrShort } from "@/lib/format";
import type { Percentiles } from "@/lib/benchmark";

/**
 * Shows the market distribution with the user's own pay marked on it.
 *
 * Positions are scaled linearly between p10 and p90, so the bar reads as
 * "where you sit" rather than as an accurate density plot — the percentile
 * labels underneath carry the precision.
 */
export function PercentileBar({
  percentiles,
  you,
  youPercentile,
}: {
  percentiles: Percentiles;
  you?: number;
  youPercentile?: number;
}) {
  const { p10, p25, p50, p75, p90 } = percentiles;
  if (p90 <= p10) return null;

  const span = p90 - p10;
  const pos = (v: number) => Math.min(100, Math.max(0, ((v - p10) / span) * 100));

  return (
    <div className="dist">
      <div className="dist-track">
        <div
          className="dist-band"
          style={{ left: `${pos(p25)}%`, right: `${100 - pos(p75)}%` }}
          aria-hidden
        />
        <div className="dist-median" style={{ left: `${pos(p50)}%` }} aria-hidden />
        {you != null && (
          <div
            className="dist-you"
            style={{ left: `${pos(you)}%` }}
            aria-label={`Your pay, ${formatInrShort(you)}`}
          />
        )}
      </div>
      <div className="dist-labels">
        <span>{formatInrShort(p10)} (10th)</span>
        <span>{formatInrShort(p50)} (median)</span>
        <span>{formatInrShort(p90)} (90th)</span>
      </div>
      {you != null && youPercentile != null && (
        <div className="dist-you-label">
          You: {formatInrShort(you)} — about the {youPercentile}th percentile
        </div>
      )}
      <p className="hint">
        Shaded band is the 25th–75th percentile: the range most people in this cohort sit in.
      </p>
    </div>
  );
}
