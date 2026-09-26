import { ImageResponse } from "next/og";
import { marketRate } from "@/lib/stats";
import { ROLES, CITIES, expBucket } from "@/lib/vocab";
import { inrShort } from "@/lib/format";

/** Satori ships no glyph for ₹ and its dynamic font fetch 400s, so spell it. */
const rs = (n: number) => inrShort(n).replace("₹", "Rs ");

export const dynamic = "force-dynamic";

/**
 * The social card for a shared link.
 *
 * It shows the market for a bucket, never the sharer's own pay. Someone posting
 * this to a WhatsApp group is telling their colleagues what the role pays — not
 * disclosing what they earn. Getting that backwards would turn the growth loop
 * into a privacy incident.
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const role = url.searchParams.get("role") ?? "";
  const city = url.searchParams.get("city") ?? "";
  const years = Number(url.searchParams.get("yrs") ?? NaN);

  const known = role in ROLES && (CITIES as readonly string[]).includes(city) && Number.isFinite(years);
  const market = known
    ? await marketRate(ROLES[role], city, years, 0).catch(() => null)
    : null;
  const band = known ? expBucket(years).label : "";
  const hasNumbers = market && !("insufficient" in market);

  const ink = "#1a1a18";
  const muted = "#6b6a64";

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          background: "#fbfaf8",
          padding: "64px 72px",
          fontFamily: "sans-serif",
          color: ink,
        }}
      >
        <div style={{ display: "flex", flexDirection: "column" }}>
          <div
            style={{ fontSize: 24, letterSpacing: 4, color: muted, textTransform: "uppercase", display: "flex" }}
          >
            RaiseCheck · India
          </div>
          <div style={{ fontSize: 56, marginTop: 28, lineHeight: 1.1, maxWidth: 900, display: "flex" }}>
            {known ? `${role} · ${band} · ${city}` : "What does your role actually pay?"}
          </div>
        </div>

        {hasNumbers ? (
          <div style={{ display: "flex", flexDirection: "column" }}>
            <div style={{ display: "flex", alignItems: "flex-end", gap: 56 }}>
              {(
                [
                  ["P25", market.p25],
                  ["MEDIAN", market.p50],
                  ["P75", market.p75],
                ] as const
              ).map(([label, value]) => (
                <div key={label} style={{ display: "flex", flexDirection: "column" }}>
                  <div style={{ fontSize: 22, letterSpacing: 3, color: muted, display: "flex" }}>
                    {label}
                  </div>
                  <div style={{ fontSize: 76, marginTop: 6, display: "flex" }}>{rs(value)}</div>
                </div>
              ))}
            </div>
            <div style={{ fontSize: 26, color: muted, marginTop: 28, display: "flex" }}>
              {`Based on ${market.n} verified submissions. No names, no emails, ever.`}
            </div>
          </div>
        ) : (
          <div style={{ fontSize: 30, color: muted, maxWidth: 900, display: "flex" }}>
            Anonymous salary benchmarking for India. See where you sit, and whether your last raise
            actually beat inflation.
          </div>
        )}
      </div>
    ),
    { width: 1200, height: 630 },
  );
}
