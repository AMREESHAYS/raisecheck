import { describe, expect, it } from "vitest";
import { runTool, type ToolContext } from "../src/lib/ai/tools";
import type { AdviceRow } from "../src/lib/advice";

/**
 * These tests guard the property the whole chatbot rests on: the model can only
 * obtain a number by calling a tool, and the tools never invent one.
 */

const rows = (n: number, centre = 1_800_000): AdviceRow[] =>
  Array.from({ length: n }, (_, i) => ({
    totalCompInr: Math.round(centre * (0.75 + (i / n) * 0.6)),
    yearsExperience: 5,
    yearsAtCompany: 2,
    citySlug: "bengaluru",
    companyType: "funded-startup",
    source: "user",
    trustScore: 1,
  }));

const ctx = (data: AdviceRow[] = rows(40)): ToolContext => ({
  loadRoleRows: async () => data,
});

const json = (s: string) => JSON.parse(s);

describe("list_options", () => {
  it("lists roles the platform knows", async () => {
    const out = await runTool("list_options", { kind: "roles" }, ctx());
    expect(out.isError).toBe(false);
    const roles = json(out.content);
    expect(roles.length).toBeGreaterThan(10);
    expect(roles.some((r: { slug: string }) => r.slug === "software-engineer")).toBe(true);
  });

  it("filters by a search term", async () => {
    const out = await runTool("list_options", { kind: "cities", search: "beng" }, ctx());
    const cities = json(out.content);
    expect(cities).toHaveLength(1);
    expect(cities[0].slug).toBe("bengaluru");
  });

  it("rejects an unknown kind rather than guessing", async () => {
    const out = await runTool("list_options", { kind: "planets" }, ctx());
    expect(out.isError).toBe(true);
  });
});

describe("lookup_market_rate", () => {
  it("returns percentiles and how much data they rest on", async () => {
    const out = await runTool(
      "lookup_market_rate",
      { role: "software-engineer", city: "bengaluru", years_experience: 5 },
      ctx(),
    );
    const d = json(out.content);
    expect(d.found).toBe(true);
    expect(d.percentiles.p50).toBeGreaterThan(0);
    expect(d.based_on_reports).toBe(40);
    expect(d.real_reports).toBe(40);
    expect(d.currency).toMatch(/INR/);
    expect(d).toHaveProperty("confidence");
  });

  it("reports found:false instead of a number when there is no data", async () => {
    const out = await runTool(
      "lookup_market_rate",
      { role: "software-engineer", city: "bengaluru", years_experience: 5 },
      ctx([]),
    );
    const d = json(out.content);
    expect(d.found).toBe(false);
    expect(d.message).toMatch(/not enough data|no comparable/i);
    expect(JSON.stringify(d)).not.toMatch(/\d{6,}/); // no salary figure anywhere
  });

  it("tells the model to look up the slug instead of accepting a guess", async () => {
    const out = await runTool(
      "lookup_market_rate",
      { role: "ninja-coder", city: "bengaluru", years_experience: 5 },
      ctx(),
    );
    expect(out.isError).toBe(true);
    expect(out.content).toMatch(/list_options/);
  });

  it("flags when the answer rests on seed data", async () => {
    const seeded = rows(40).map((r) => ({ ...r, source: "seed" }));
    const out = await runTool(
      "lookup_market_rate",
      { role: "software-engineer", city: "bengaluru", years_experience: 5 },
      ctx(seeded),
    );
    const d = json(out.content);
    expect(d.mostly_reference_data).toBe(true);
    expect(d.real_reports).toBe(0);
  });
});

describe("assess_salary", () => {
  it("returns a verdict, an action and the reasoning", async () => {
    const out = await runTool(
      "assess_salary",
      {
        role: "software-engineer",
        city: "bengaluru",
        years_experience: 5,
        company_type: "indian-it-services",
        current_total_inr: 900_000,
      },
      ctx(),
    );
    const d = json(out.content);
    expect(d.verdict).toBe("underpaid");
    expect(["negotiate", "negotiate-then-switch", "switch"]).toContain(d.recommended_action);
    expect(Array.isArray(d.reasons)).toBe(true);
    expect(d.market_percentile).toBeLessThan(30);
  });

  it("passes the inflation check through when raise history is given", async () => {
    const out = await runTool(
      "assess_salary",
      {
        role: "software-engineer",
        city: "bengaluru",
        years_experience: 5,
        current_total_inr: 1_800_000,
        last_raise_pct: 2,
        months_since_raise: 12,
      },
      ctx(),
    );
    const d = json(out.content);
    expect(d.inflation_check).not.toBeNull();
    expect(d.inflation_check.losingGround).toBe(true);
  });

  it("says whether the switch premium was measured or assumed", async () => {
    const out = await runTool(
      "assess_salary",
      {
        role: "software-engineer",
        city: "bengaluru",
        years_experience: 5,
        current_total_inr: 1_200_000,
      },
      ctx(),
    );
    const d = json(out.content);
    expect(typeof d.switch_premium_measured_from_data).toBe("boolean");
  });
});

describe("compare_with_inflation", () => {
  it("returns the real raise", async () => {
    const out = await runTool(
      "compare_with_inflation",
      { current_salary_inr: 1_000_000, raise_pct: 5, months_since_raise: 24 },
      ctx(),
    );
    const d = json(out.content);
    expect(d.realRaisePct).toBeLessThan(0);
    expect(d.breakEvenSalary).toBeGreaterThan(0);
  });
});

describe("error handling", () => {
  it("returns an error result for an unknown tool rather than throwing", async () => {
    const out = await runTool("delete_everything", {}, ctx());
    expect(out.isError).toBe(true);
    expect(out.content).toMatch(/Unknown tool/);
  });

  it("returns a correctable message for malformed input rather than throwing", async () => {
    const out = await runTool(
      "lookup_market_rate",
      { role: "software-engineer", city: "bengaluru", years_experience: "five" },
      ctx(),
    );
    expect(out.isError).toBe(true);
    expect(out.content).toMatch(/Invalid tool input/);
  });

  it("survives a tool input that is not an object at all", async () => {
    const out = await runTool("lookup_market_rate", "nonsense", ctx());
    expect(out.isError).toBe(true);
  });
});
