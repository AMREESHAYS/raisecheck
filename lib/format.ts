/** Indian money shorthand: 12,50,000 -> "₹12.5 L", 1,20,00,000 -> "₹1.2 Cr". */
export function inrShort(n: number) {
  if (!Number.isFinite(n)) return "—";
  if (Math.abs(n) >= 1_00_00_000) return `₹${(n / 1_00_00_000).toFixed(2).replace(/\.?0+$/, "")} Cr`;
  if (Math.abs(n) >= 1_00_000) return `₹${(n / 1_00_000).toFixed(1).replace(/\.0$/, "")} L`;
  return `₹${Math.round(n).toLocaleString("en-IN")}`;
}

export function inrFull(n: number) {
  return `₹${Math.round(n).toLocaleString("en-IN")}`;
}
