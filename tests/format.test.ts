import { describe, expect, it } from "vitest";
import { formatInr, formatInrShort, parseInr } from "../src/lib/format";

describe("parseInr", () => {
  it("reads plain rupee amounts", () => {
    expect(parseInr("1850000")).toBe(1_850_000);
    expect(parseInr("₹18,50,000")).toBe(1_850_000);
    expect(parseInr(" 1850000 ")).toBe(1_850_000);
  });

  it("reads lakh in every spelling people use", () => {
    for (const input of ["18.5L", "18.5 lakh", "18.5lac", "18.5 Lakhs", "18.5l"]) {
      expect(parseInr(input)).toBe(1_850_000);
    }
  });

  it("reads crore", () => {
    expect(parseInr("1.2cr")).toBe(12_000_000);
    expect(parseInr("1.2 crore")).toBe(12_000_000);
  });

  it("reads thousands", () => {
    expect(parseInr("45k")).toBe(45_000);
  });

  it("returns null for anything it cannot read, rather than guessing", () => {
    for (const input of ["", "   ", "abc", "18.5 lakhs per year", "1,2,3lk", "--5"]) {
      expect(parseInr(input)).toBeNull();
    }
  });

  it("never silently mis-scales a bare number", () => {
    // The classic bug: "18" meaning 18 lakh. We must read it as 18 rupees and
    // let the UI echo that back, not quietly multiply.
    expect(parseInr("18")).toBe(18);
  });
});

describe("formatInr", () => {
  it("uses lakh and crore the way Indian readers expect", () => {
    expect(formatInr(1_850_000)).toBe("₹18.5 lakh");
    expect(formatInr(12_000_000)).toBe("₹1.2 crore");
    expect(formatInr(45_000)).toBe("₹45k");
    expect(formatInr(600)).toBe("₹600");
  });

  it("handles zero and negatives", () => {
    expect(formatInr(0)).toBe("₹0");
    expect(formatInr(-250_000)).toBe("-₹2.5 lakh");
  });

  it("does not crash on non-finite input", () => {
    expect(formatInr(Number.NaN)).toBe("—");
    expect(formatInr(Number.POSITIVE_INFINITY)).toBe("—");
  });

  it("round-trips through parseInr for common values", () => {
    for (const value of [450_000, 1_850_000, 12_000_000]) {
      expect(parseInr(formatInr(value).replace("₹", "").replace(" ", ""))).toBe(value);
    }
  });
});

describe("formatInrShort", () => {
  it("uses compact suffixes", () => {
    expect(formatInrShort(1_850_000)).toBe("₹18.5L");
    expect(formatInrShort(12_000_000)).toBe("₹1.2Cr");
  });
});
