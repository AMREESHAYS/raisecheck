"use client";

import { useState } from "react";
import { parseInr, formatInr } from "@/lib/format";
import type { Meta } from "./types";

export type FormValues = {
  roleSlug: string;
  levelSlug: string;
  citySlug: string;
  companyType: string;
  yearsExperience: number;
  yearsAtCompany: number;
  annualBaseInr: number;
  annualBonusInr: number;
  annualEquityInr: number;
  lastRaisePct: number | null;
  monthsSinceRaise: number | null;
  shareable: boolean;
};

/**
 * Amount field that accepts what people actually type — "18.5L", "₹18,50,000",
 * "1.2 crore" — and echoes back what it understood so nobody submits a figure
 * that is off by a factor of a hundred.
 */
function AmountField({
  id,
  label,
  hint,
  value,
  onChange,
  required,
}: {
  id: string;
  label: string;
  hint?: string;
  value: string;
  onChange: (raw: string) => void;
  required?: boolean;
}) {
  const parsed = parseInr(value);
  return (
    <div>
      <label htmlFor={id}>
        {label}
        {required ? "" : " (optional)"}
      </label>
      <input
        id={id}
        inputMode="decimal"
        placeholder="e.g. 18.5L or 1850000"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        aria-describedby={`${id}-hint`}
      />
      <div className="hint" id={`${id}-hint`}>
        {value.trim() !== "" && parsed == null
          ? "Couldn't read that — try 18.5L, 1850000, or 1.2 crore."
          : parsed != null
            ? `Read as ${formatInr(parsed)} per year.`
            : (hint ?? "Per year, in rupees.")}
      </div>
    </div>
  );
}

export function SalaryForm({
  meta,
  onSubmit,
  busy,
}: {
  meta: Meta;
  onSubmit: (values: FormValues) => void;
  busy: boolean;
}) {
  const [roleSlug, setRole] = useState("software-engineer");
  const [levelSlug, setLevel] = useState("mid");
  const [citySlug, setCity] = useState("bengaluru");
  const [companyType, setCompanyType] = useState("indian-it-services");
  const [years, setYears] = useState("4");
  const [tenure, setTenure] = useState("2");
  const [base, setBase] = useState("");
  const [bonus, setBonus] = useState("");
  const [equity, setEquity] = useState("");
  const [raise, setRaise] = useState("");
  const [monthsSince, setMonthsSince] = useState("");
  const [shareable, setShareable] = useState(true);
  const [error, setError] = useState<string | null>(null);

  function submit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);

    const baseInr = parseInr(base);
    const yearsNum = Number.parseFloat(years);
    const tenureNum = Number.parseFloat(tenure);

    if (baseInr == null || baseInr <= 0) return setError("Please enter your annual base pay.");
    if (!Number.isFinite(yearsNum)) return setError("Please enter your years of experience.");
    if (!Number.isFinite(tenureNum)) return setError("Please enter how long you've been at this company.");
    if (tenureNum > yearsNum + 0.5)
      return setError("Years at this company can't be more than your total experience.");

    onSubmit({
      roleSlug,
      levelSlug,
      citySlug,
      companyType,
      yearsExperience: yearsNum,
      yearsAtCompany: tenureNum,
      annualBaseInr: baseInr,
      annualBonusInr: parseInr(bonus) ?? 0,
      annualEquityInr: parseInr(equity) ?? 0,
      lastRaisePct: raise.trim() === "" ? null : Number.parseFloat(raise),
      monthsSinceRaise: monthsSince.trim() === "" ? null : Math.round(Number.parseFloat(monthsSince)),
      shareable,
    });
  }

  return (
    <form className="card" onSubmit={submit}>
      <h2 style={{ marginTop: 0 }}>Your details</h2>
      <p className="hint" style={{ marginBottom: 18 }}>
        Nothing here identifies you. No email, no employer name, no login.
      </p>

      <div className="grid2">
        <div>
          <label htmlFor="role">Role</label>
          <select id="role" value={roleSlug} onChange={(e) => setRole(e.target.value)}>
            {meta.roles.map((r) => (
              <option key={r.slug} value={r.slug}>
                {r.label}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="level">Level</label>
          <select id="level" value={levelSlug} onChange={(e) => setLevel(e.target.value)}>
            {meta.levels.map((l) => (
              <option key={l.slug} value={l.slug}>
                {l.label}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="city">City</label>
          <select id="city" value={citySlug} onChange={(e) => setCity(e.target.value)}>
            {meta.cities.map((c) => (
              <option key={c.slug} value={c.slug}>
                {c.label}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="company">Company type</label>
          <select id="company" value={companyType} onChange={(e) => setCompanyType(e.target.value)}>
            {meta.companyTypes.map((c) => (
              <option key={c.slug} value={c.slug}>
                {c.label}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="years">Total years of experience</label>
          <input
            id="years"
            inputMode="decimal"
            value={years}
            onChange={(e) => setYears(e.target.value)}
          />
        </div>
        <div>
          <label htmlFor="tenure">Years at this company</label>
          <input
            id="tenure"
            inputMode="decimal"
            value={tenure}
            onChange={(e) => setTenure(e.target.value)}
          />
        </div>
      </div>

      <h3>Pay</h3>
      <div className="grid2">
        <AmountField id="base" label="Annual fixed base" value={base} onChange={setBase} required />
        <AmountField
          id="bonus"
          label="Bonus / variable last year"
          hint="Leave blank if none."
          value={bonus}
          onChange={setBonus}
        />
        <AmountField
          id="equity"
          label="Equity per year (RSU/ESOP)"
          hint="Annualised value. Leave blank if none."
          value={equity}
          onChange={setEquity}
        />
      </div>

      <h3>Your last raise</h3>
      <p className="hint" style={{ marginTop: -4, marginBottom: 12 }}>
        Optional, but this is what lets us check your raise against real inflation.
      </p>
      <div className="grid2">
        <div>
          <label htmlFor="raise">Last raise (%)</label>
          <input
            id="raise"
            inputMode="decimal"
            placeholder="e.g. 8"
            value={raise}
            onChange={(e) => setRaise(e.target.value)}
          />
          <div className="hint">Enter 0 if you haven&apos;t had one.</div>
        </div>
        <div>
          <label htmlFor="months">Months since then</label>
          <input
            id="months"
            inputMode="numeric"
            placeholder="e.g. 14"
            value={monthsSince}
            onChange={(e) => setMonthsSince(e.target.value)}
          />
        </div>
      </div>

      <div style={{ marginTop: 18 }}>
        <div className="checkline">
          <input
            id="shareable"
            type="checkbox"
            checked={shareable}
            onChange={(e) => setShareable(e.target.checked)}
          />
          <label htmlFor="shareable" style={{ fontWeight: 400 }}>
            Add my report to the public dataset so others in my role get a better benchmark. It is
            only ever shown as part of an aggregate.
          </label>
        </div>
      </div>

      {error && <p className="error">{error}</p>}

      <div className="row" style={{ marginTop: 18 }}>
        <button type="submit" disabled={busy}>
          {busy ? "Working…" : "Show me where I stand"}
        </button>
      </div>
    </form>
  );
}
