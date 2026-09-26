/** Formats rupees the way people in India actually read them. */
export function formatInr(amount: number): string {
  if (!Number.isFinite(amount)) return "—";
  const abs = Math.abs(amount);
  const sign = amount < 0 ? "-" : "";
  if (abs >= 10_000_000) return `${sign}₹${trim(abs / 10_000_000)} crore`;
  if (abs >= 100_000) return `${sign}₹${trim(abs / 100_000)} lakh`;
  if (abs >= 1_000) return `${sign}₹${Math.round(abs / 1_000)}k`;
  return `${sign}₹${Math.round(abs)}`;
}

/** Short form for axes and dense tables: ₹18.5L, ₹1.2Cr. */
export function formatInrShort(amount: number): string {
  const abs = Math.abs(amount);
  const sign = amount < 0 ? "-" : "";
  if (abs >= 10_000_000) return `${sign}₹${trim(abs / 10_000_000)}Cr`;
  if (abs >= 100_000) return `${sign}₹${trim(abs / 100_000)}L`;
  if (abs >= 1_000) return `${sign}₹${Math.round(abs / 1_000)}k`;
  return `${sign}₹${Math.round(abs)}`;
}

/** Parses "18.5 lakh", "18.5L", "1.2 cr", "1850000" into rupees. */
export function parseInr(input: string): number | null {
  const text = input.trim().toLowerCase().replace(/[₹,\s]/g, "");
  if (text === "") return null;
  const match = text.match(/^(\d+(?:\.\d+)?)(l|lakh|lac|lakhs|cr|crore|crores|k)?$/);
  if (!match) return null;
  const value = Number.parseFloat(match[1]);
  if (!Number.isFinite(value)) return null;
  switch (match[2]) {
    case "l":
    case "lakh":
    case "lac":
    case "lakhs":
      return Math.round(value * 100_000);
    case "cr":
    case "crore":
    case "crores":
      return Math.round(value * 10_000_000);
    case "k":
      return Math.round(value * 1_000);
    default:
      return Math.round(value);
  }
}

function trim(n: number): string {
  return (Math.round(n * 100) / 100).toString();
}
