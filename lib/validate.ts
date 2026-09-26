import { ROLES, CITIES, EMPLOYMENT_TYPES, COMPANY_SIZES, expBucket } from "./vocab";

// ponytail: one conservative national floor instead of 25 fabricated city figures.
// State minimum wages are notified per state AND per skill category; wire the real
// notified rates in (keyed by city) before this number is load-bearing for rejection.
export const CTC_FLOOR = 120_000;
// Above this, a submission is plausible but rare enough that it goes to manual review
// rather than straight into a public aggregate.
export const CTC_REVIEW_CEILING = 20_000_000;
export const CTC_HARD_CEILING = 500_000_000;

export type RawInput = Record<string, unknown>;

export type Validated = {
  role_title: string;
  role_category: string;
  years_experience: number;
  city: string;
  current_ctc_annual: number;
  last_raise_pct: number | null;
  last_raise_date: string | null;
  employment_type: string;
  company_size_bucket: string | null;
  needsReview: boolean;
};

export function validate(input: RawInput): { ok: true; value: Validated } | { ok: false; error: string } {
  const bad = (error: string) => ({ ok: false as const, error });

  const role_title = String(input.role_title ?? "");
  if (!(role_title in ROLES)) return bad("Pick a role from the list.");

  const city = String(input.city ?? "");
  if (!(CITIES as readonly string[]).includes(city)) return bad("Pick a city from the list.");

  const years_experience = Number(input.years_experience);
  if (!Number.isInteger(years_experience) || years_experience < 0 || years_experience > 50)
    return bad("Years of experience must be a whole number between 0 and 50.");

  const current_ctc_annual = Math.round(Number(input.current_ctc_annual));
  if (!Number.isFinite(current_ctc_annual)) return bad("Enter your annual CTC in rupees.");
  if (current_ctc_annual < CTC_FLOOR)
    return bad("That CTC is below the legal minimum for full-time work in India. Enter your annual figure, not monthly.");
  if (current_ctc_annual > CTC_HARD_CEILING) return bad("That CTC is outside the range we accept.");

  const employment_type = String(input.employment_type ?? "full-time");
  if (!(EMPLOYMENT_TYPES as readonly string[]).includes(employment_type))
    return bad("Pick an employment type.");

  const sizeRaw = input.company_size_bucket;
  const company_size_bucket =
    sizeRaw == null || sizeRaw === "" ? null : String(sizeRaw);
  if (company_size_bucket && !(COMPANY_SIZES as readonly string[]).includes(company_size_bucket))
    return bad("Pick a company size from the list.");

  let last_raise_pct: number | null = null;
  if (input.last_raise_pct != null && input.last_raise_pct !== "") {
    last_raise_pct = Number(input.last_raise_pct);
    if (!Number.isFinite(last_raise_pct) || last_raise_pct < -50 || last_raise_pct > 300)
      return bad("Last raise % must be between -50 and 300.");
  }

  let last_raise_date: string | null = null;
  if (input.last_raise_date != null && input.last_raise_date !== "") {
    const d = new Date(String(input.last_raise_date));
    if (Number.isNaN(d.getTime())) return bad("Last raise date isn't a valid date.");
    if (d.getTime() > Date.now()) return bad("Last raise date is in the future.");
    if (d.getUTCFullYear() < 2000) return bad("Last raise date is too far back to compare.");
    last_raise_date = d.toISOString().slice(0, 10);
  }
  if ((last_raise_pct === null) !== (last_raise_date === null))
    return bad("Give both the raise % and its date, or neither.");

  // A CTC that implies an impossible rate for the experience level is a typo, not data.
  const b = expBucket(years_experience);
  if (b.max <= 2 && current_ctc_annual > 15_000_000)
    return bad("That's far outside the range for this experience level — check the figure.");

  return {
    ok: true,
    value: {
      role_title,
      role_category: ROLES[role_title],
      years_experience,
      city,
      current_ctc_annual,
      last_raise_pct,
      last_raise_date,
      employment_type,
      company_size_bucket,
      needsReview: current_ctc_annual > CTC_REVIEW_CEILING,
    },
  };
}
