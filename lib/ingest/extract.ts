/**
 * Turning scraped rows into comparable data points.
 *
 * Every Apify actor returns a different shape, and none of them return our
 * buckets. So this layer is deliberately tolerant: it looks for a salary, a
 * location and a job title under any of the names these actors commonly use,
 * normalises each, and drops anything it can't read rather than guessing.
 *
 * Dropping is the right default. A misparsed salary silently poisons a
 * percentile, and a percentile is the entire product.
 */
import { CITIES, CATEGORIES, EXP_BUCKETS, ROLES, type Category } from "../vocab";

/* ------------------------------------------------------------------ fields */

/** Case- and punctuation-insensitive lookup across a few likely key names. */
export function pickField(row: Record<string, unknown>, aliases: string[]): unknown {
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
  const flat = new Map<string, unknown>();
  const walk = (o: unknown, depth = 0) => {
    if (depth > 3 || o == null || typeof o !== "object" || Array.isArray(o)) return;
    for (const [k, v] of Object.entries(o as Record<string, unknown>)) {
      if (!flat.has(norm(k))) flat.set(norm(k), v);
      walk(v, depth + 1);
    }
  };
  walk(row);
  for (const a of aliases) {
    const hit = flat.get(norm(a));
    if (hit != null && hit !== "") return hit;
  }
  return undefined;
}

/* ------------------------------------------------------------------- money */

const CRORE = 1_00_00_000;
const LAKH = 1_00_000;

export type Money = { inr: number; currency: "INR" | "USD" | "UNKNOWN" };

/**
 * Parses the shapes these sites actually publish: "₹12,00,000", "12 LPA",
 * "₹8L - ₹12L", "1.2 Cr", "$150,000", plain numbers. Ranges become their midpoint.
 * Returns null rather than a guess when the string isn't money.
 */
export function parseMoney(input: unknown): Money | null {
  if (typeof input === "number") {
    return Number.isFinite(input) && input > 0 ? { inr: input, currency: "UNKNOWN" } : null;
  }
  if (typeof input !== "string") return null;
  const s = input.trim();
  if (!s) return null;

  const currency: Money["currency"] = /[$]|\busd\b/i.test(s)
    ? "USD"
    : /[₹]|\binr\b|\brs\.?\b|\blpa\b|lakh|lac|crore|\bcr\b|\bl\b/i.test(s)
      ? "INR"
      : "UNKNOWN";

  // Every number in the string, with whatever unit word follows it.
  const re = /(\d[\d,.]*)\s*(cr(?:ore)?s?|l(?:akh|ac)?s?|k|m)?/gi;
  const values: number[] = [];
  for (const m of s.matchAll(re)) {
    const raw = m[1].replace(/,/g, "");
    let n = Number(raw);
    if (!Number.isFinite(n) || n <= 0) continue;
    const unit = (m[2] ?? "").toLowerCase();
    if (unit.startsWith("cr")) n *= CRORE;
    else if (unit.startsWith("l")) n *= LAKH;
    else if (unit === "k") n *= 1_000;
    else if (unit === "m") n *= 1_000_000;
    values.push(n);
  }
  if (!values.length) return null;

  // "8 - 12 LPA": the unit trails the last number but applies to both.
  const scale = Math.max(...values);
  const scaled = values.map((v) => (v < LAKH && scale >= LAKH && v < 100 ? v * LAKH : v));

  const plausible = scaled.filter((v) => v > 0);
  if (!plausible.length) return null;
  const mid = plausible.length >= 2
    ? (Math.min(...plausible) + Math.max(...plausible)) / 2
    : plausible[0];

  return { inr: Math.round(mid), currency };
}

/** Annual INR, or null when the figure isn't usable as one. */
export function toAnnualInr(m: Money | null, usdInr = Number(process.env.USD_INR ?? 0)): number | null {
  if (!m) return null;
  if (m.currency === "USD") {
    // No hardcoded rate: a stale one silently distorts every figure built on it.
    if (!usdInr) return null;
    return Math.round(m.inr * usdInr);
  }
  // A "salary" under a lakh is a monthly figure or a typo, not an annual CTC.
  if (m.inr < 1_00_000) return null;
  if (m.inr > 50_00_00_000) return null;
  return m.inr;
}

/* -------------------------------------------------------------------- city */

const CITY_ALIASES: Record<string, string> = {
  bengaluru: "Bangalore", bangalore: "Bangalore", blr: "Bangalore",
  gurugram: "Gurgaon", gurgaon: "Gurgaon",
  bombay: "Mumbai", mumbai: "Mumbai", "navi mumbai": "Mumbai", thane: "Mumbai",
  calcutta: "Kolkata", kolkata: "Kolkata",
  madras: "Chennai", chennai: "Chennai",
  "new delhi": "Delhi NCR", delhi: "Delhi NCR", ncr: "Delhi NCR", faridabad: "Delhi NCR", ghaziabad: "Delhi NCR",
  noida: "Noida", "greater noida": "Noida",
  pune: "Pune", pimpri: "Pune",
  hyderabad: "Hyderabad", secunderabad: "Hyderabad",
  ahmedabad: "Ahmedabad", jaipur: "Jaipur",
  cochin: "Kochi", kochi: "Kochi", ernakulam: "Kochi",
  coimbatore: "Coimbatore",
  trivandrum: "Thiruvananthapuram", thiruvananthapuram: "Thiruvananthapuram",
  indore: "Indore", chandigarh: "Chandigarh", bhubaneswar: "Bhubaneswar",
  nagpur: "Nagpur", lucknow: "Lucknow",
  baroda: "Vadodara", vadodara: "Vadodara",
  surat: "Surat", mysuru: "Mysore", mysore: "Mysore",
  vizag: "Visakhapatnam", visakhapatnam: "Visakhapatnam",
  mohali: "Mohali",
  remote: "Remote (India)", "work from home": "Remote (India)", anywhere: "Remote (India)",
};

/** Maps a free-text location onto the controlled city list, or null. */
export function matchCity(input: unknown): string | null {
  if (typeof input !== "string") return null;
  const s = input.toLowerCase();
  // Longest alias first, so "navi mumbai" wins over "mumbai".
  const keys = Object.keys(CITY_ALIASES).sort((a, b) => b.length - a.length);
  for (const k of keys) {
    if (new RegExp(`\\b${k.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`).test(s)) {
      const city = CITY_ALIASES[k];
      if ((CITIES as readonly string[]).includes(city)) return city;
    }
  }
  return null;
}

/* -------------------------------------------------------------------- role */

// Checked in order: specific before generic, so "engineering manager" doesn't
// get caught by the "engineer" rule.
const ROLE_RULES: [RegExp, Category][] = [
  [/\b(engineering|technical|tech)\s+(manager|director|lead\s+manager)\b|\bvp\s+of\s+engineering\b|\bcto\b/i, "Management"],
  [/\b(chief of staff|general manager|country manager)\b/i, "Management"],
  [/\b(data scientist|machine learning|ml engineer|mlops|ai engineer|deep learning|nlp|computer vision|data engineer|analytics engineer|research scientist|statistician|bi developer)\b/i, "Data & AI"],
  [/\b(data analyst|business analyst|product analyst)\b/i, "Data & AI"],
  [/\b(ux|ui|product design|visual design|graphic design|motion design|interaction design|brand design|illustrator)\b|\bdesigner\b/i, "Design"],
  [/\b(product manager|product owner|program manager|project manager|scrum master|tpm)\b/i, "Product"],
  [/\b(qa|sdet|test engineer|quality assurance|automation test)\b/i, "QA"],
  [/\b(devops|site reliability|sre|platform engineer|cloud engineer|cloud architect|infrastructure|database administrator|dba|network engineer|systems engineer)\b/i, "DevOps & Infra"],
  [/\b(security|infosec|penetration test|pentest|soc analyst|grc|ciso)\b/i, "Security"],
  [/\b(it support|desktop support|system administrator|sysadmin|helpdesk|technical support)\b/i, "IT & Support"],
  [/\b(sales|account executive|business development|presales|inside sales|key account)\b/i, "Sales"],
  [/\b(marketing|seo|growth|brand manager|social media)\b/i, "Marketing"],
  [/\b(customer success|customer support|account manager)\b/i, "Customer Success"],
  [/\b(operations|supply chain|logistics|procurement|warehouse)\b/i, "Operations"],
  [/\b(accountant|financial analyst|finance manager|controller|auditor|tax|treasury|cfo|chartered accountant)\b/i, "Finance"],
  [/\b(hr|human resources|recruiter|talent acquisition|people ops|compensation and benefits)\b/i, "HR"],
  [/\b(legal|counsel|paralegal|company secretary|compliance)\b/i, "Legal"],
  [/\b(content writer|technical writer|copywriter|content strategist|video editor|editor)\b/i, "Content"],
  [/\b(consultant|consulting|strategy manager)\b/i, "Consulting"],
  [/\b(software|developer|engineer|programmer|full stack|frontend|front end|backend|back end|android|ios|architect)\b/i, "Engineering"],
];

/** Maps a free-text job title onto a role category, or null. */
export function matchRoleCategory(input: unknown): Category | null {
  if (typeof input !== "string") return null;
  const s = input.trim();
  if (!s) return null;
  // An exact vocabulary title is authoritative; the rules are the fallback.
  const exact = Object.keys(ROLES).find((t) => t.toLowerCase() === s.toLowerCase());
  if (exact) return ROLES[exact];
  for (const [re, cat] of ROLE_RULES) if (re.test(s)) return cat;
  return null;
}

/* -------------------------------------------------------------- experience */

/** Pulls years of experience out of "3-5 years", "5+ yrs", "2 years". */
export function matchYears(input: unknown): number | null {
  if (typeof input === "number") return Number.isFinite(input) && input >= 0 && input <= 50 ? Math.round(input) : null;
  if (typeof input !== "string") return null;
  const m = input.match(/(\d{1,2})\s*(?:-|to|–)\s*(\d{1,2})|(\d{1,2})\s*\+?\s*(?:y|yr|year)/i);
  if (!m) return null;
  const n = m[1] && m[2] ? (Number(m[1]) + Number(m[2])) / 2 : Number(m[3]);
  return Number.isFinite(n) && n >= 0 && n <= 50 ? Math.round(n) : null;
}

/* ------------------------------------------------------------------ points */

export type DataPoint = {
  role_category: Category;
  /** Null means all-India: the row proved INR but named no city. */
  city: string | null;
  years: number | null;
  ctc: number;
};

const SALARY_KEYS = [
  "totalCompensation", "total_comp", "totalComp", "ctc", "annualSalary", "salary",
  "baseSalary", "medianSalary", "avgSalary", "averageSalary", "salaryRange",
  "compensation", "pay", "estimatedSalary", "salaryEstimate",
];
const TITLE_KEYS = ["jobTitle", "title", "role", "designation", "position", "jobFamily", "level"];
const LOCATION_KEYS = ["location", "city", "jobLocation", "place", "region", "office"];
const YEARS_KEYS = ["yearsOfExperience", "experience", "yoe", "years", "experienceRange", "seniority"];

/**
 * One scraped row -> one comparable point, or null if it can't be read.
 *
 * The hard rule is that a row must PROVE it is Indian rupees before it counts.
 * levels.fyi returns US rows as bare numbers with no currency marker at all, so
 * parseMoney reports UNKNOWN and they would otherwise sail through as rupees —
 * a $300,500 median landing in the database as ₹3,00,500.
 *
 * Two things can prove it, and either is enough:
 *   - an explicit INR currency field (AmbitionBox has one, and no location)
 *   - a recognised Indian city (levels.fyi has locations, and no currency field)
 */
export function extractPoint(row: Record<string, unknown>): DataPoint | null {
  const role_category = matchRoleCategory(pickField(row, TITLE_KEYS));
  if (!role_category) return null;

  // An explicit non-India market beats everything, including a matching city name.
  const market = pickField(row, ["market", "country", "countryName"]);
  if (typeof market === "string" && market.trim() && !/^(india|in|ind)$/i.test(market.trim()))
    return null;

  const declared = pickField(row, ["salary_currency", "currency", "currencyCode"]);
  const declaredInr = typeof declared === "string" && /^inr$|^rs\.?$|^₹$/i.test(declared.trim());
  if (typeof declared === "string" && declared.trim() && !declaredInr) return null;

  // Monthly figures are not annual CTC and must not be mixed in with ones that are.
  const period = pickField(row, ["salary_period", "period", "payPeriod"]);
  if (typeof period === "string" && period.trim() && !/year|annual|yearly|pa|lpa/i.test(period))
    return null;

  const city = matchCity(pickField(row, LOCATION_KEYS));
  const money = parseMoney(pickField(row, SALARY_KEYS));
  if (money?.currency === "USD") return null; // Needs an explicit rate; see toAnnualInr.

  // Nothing established the currency: no INR marker and no Indian city. Drop it.
  if (!declaredInr && !city && money?.currency !== "INR") return null;

  const ctc = toAnnualInr(money);
  if (!ctc) return null;

  return { role_category, city, years: matchYears(pickField(row, YEARS_KEYS)), ctc };
}

/* ------------------------------------------------------------- aggregation */

export type Bucket = {
  role_category: string;
  city: string | null;
  min_years: number;
  max_years: number;
  p25: number;
  p50: number;
  p75: number;
  sample_size: number;
};

function percentile(sorted: number[], p: number) {
  if (sorted.length === 1) return sorted[0];
  const i = (p / 100) * (sorted.length - 1);
  const lo = Math.floor(i);
  return Math.round(sorted[lo] + (sorted[Math.ceil(i)] - sorted[lo]) * (i - lo));
}

/**
 * Points -> buckets. Company identity is discarded here on purpose: the coach is
 * forbidden from claiming what a named employer pays, so that detail must not
 * survive ingestion in the first place.
 */
export function aggregate(points: DataPoint[], minSample: number): Bucket[] {
  const groups = new Map<string, { b: Omit<Bucket, "p25" | "p50" | "p75" | "sample_size">; xs: number[] }>();

  for (const p of points) {
    const band = p.years == null ? null : EXP_BUCKETS.find((e) => p.years! >= e.min && p.years! <= e.max);
    const min_years = band?.min ?? 0;
    const max_years = band?.max ?? EXP_BUCKETS[EXP_BUCKETS.length - 1].max;
    const key = `${p.role_category}|${p.city ?? ""}|${min_years}|${max_years}`;
    if (!groups.has(key))
      groups.set(key, { b: { role_category: p.role_category, city: p.city, min_years, max_years }, xs: [] });
    groups.get(key)!.xs.push(p.ctc);
  }

  return [...groups.values()]
    .filter((g) => g.xs.length >= minSample)
    .map(({ b, xs }) => {
      const sorted = xs.sort((a, c) => a - c);
      return {
        ...b,
        p25: percentile(sorted, 25),
        p50: percentile(sorted, 50),
        p75: percentile(sorted, 75),
        sample_size: sorted.length,
      };
    })
    .sort((a, b) => b.sample_size - a.sample_size);
}

export const KNOWN_CATEGORIES = CATEGORIES;
