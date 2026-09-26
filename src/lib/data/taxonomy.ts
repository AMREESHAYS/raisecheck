/**
 * Canonical taxonomy for roles, cities and seniority.
 *
 * Everything the benchmark engine does depends on these slugs being stable, so
 * treat them as an append-only list: renaming a slug orphans existing rows.
 */

export type LevelSlug = "intern" | "junior" | "mid" | "senior" | "staff" | "manager";

export const LEVELS: { slug: LevelSlug; label: string; typicalYears: [number, number] }[] = [
  { slug: "intern", label: "Intern / Trainee", typicalYears: [0, 1] },
  { slug: "junior", label: "Junior (0-2 yrs)", typicalYears: [0, 2] },
  { slug: "mid", label: "Mid (2-5 yrs)", typicalYears: [2, 5] },
  { slug: "senior", label: "Senior (5-9 yrs)", typicalYears: [5, 9] },
  { slug: "staff", label: "Staff / Principal (9+ yrs)", typicalYears: [8, 25] },
  { slug: "manager", label: "Engineering / Team Manager", typicalYears: [7, 25] },
];

export const LEVEL_SLUGS: string[] = LEVELS.map((l) => l.slug);

/**
 * `baseP50` is the reference median total compensation in INR for this role at
 * 3 years of experience in a tier-1 city, used only to generate the seed
 * dataset. `spread` is the log-normal sigma controlling how wide the band is.
 */
export type RoleDef = {
  slug: string;
  label: string;
  family: string;
  baseP50: number;
  spread: number;
  /** Annual % premium per year of experience, compounding. */
  expSlope: number;
};

export const ROLES: RoleDef[] = [
  // Engineering
  { slug: "software-engineer", label: "Software Engineer", family: "Engineering", baseP50: 1_450_000, spread: 0.42, expSlope: 0.115 },
  { slug: "frontend-engineer", label: "Frontend Engineer", family: "Engineering", baseP50: 1_350_000, spread: 0.4, expSlope: 0.11 },
  { slug: "backend-engineer", label: "Backend Engineer", family: "Engineering", baseP50: 1_500_000, spread: 0.42, expSlope: 0.12 },
  { slug: "fullstack-engineer", label: "Full-stack Engineer", family: "Engineering", baseP50: 1_420_000, spread: 0.41, expSlope: 0.115 },
  { slug: "mobile-engineer", label: "Mobile Engineer (Android/iOS)", family: "Engineering", baseP50: 1_400_000, spread: 0.4, expSlope: 0.11 },
  { slug: "devops-sre", label: "DevOps / SRE", family: "Engineering", baseP50: 1_600_000, spread: 0.43, expSlope: 0.12 },
  { slug: "qa-engineer", label: "QA / Test Engineer", family: "Engineering", baseP50: 900_000, spread: 0.38, expSlope: 0.09 },
  { slug: "data-engineer", label: "Data Engineer", family: "Data", baseP50: 1_550_000, spread: 0.43, expSlope: 0.12 },
  { slug: "data-scientist", label: "Data Scientist", family: "Data", baseP50: 1_600_000, spread: 0.45, expSlope: 0.125 },
  { slug: "ml-engineer", label: "ML / AI Engineer", family: "Data", baseP50: 1_900_000, spread: 0.48, expSlope: 0.14 },
  { slug: "data-analyst", label: "Data Analyst", family: "Data", baseP50: 900_000, spread: 0.38, expSlope: 0.095 },
  // Product & design
  { slug: "product-manager", label: "Product Manager", family: "Product", baseP50: 1_900_000, spread: 0.45, expSlope: 0.13 },
  { slug: "product-designer", label: "Product / UX Designer", family: "Design", baseP50: 1_200_000, spread: 0.4, expSlope: 0.11 },
  { slug: "graphic-designer", label: "Graphic / Visual Designer", family: "Design", baseP50: 650_000, spread: 0.36, expSlope: 0.085 },
  // Business
  { slug: "business-analyst", label: "Business Analyst", family: "Business", baseP50: 1_000_000, spread: 0.38, expSlope: 0.1 },
  { slug: "sales-executive", label: "Sales Executive / AE", family: "Business", baseP50: 850_000, spread: 0.48, expSlope: 0.105 },
  { slug: "marketing-manager", label: "Marketing Manager", family: "Business", baseP50: 1_250_000, spread: 0.42, expSlope: 0.11 },
  { slug: "content-writer", label: "Content Writer", family: "Business", baseP50: 550_000, spread: 0.38, expSlope: 0.085 },
  { slug: "hr-recruiter", label: "HR / Recruiter", family: "Business", baseP50: 700_000, spread: 0.36, expSlope: 0.09 },
  { slug: "accountant", label: "Accountant / Finance", family: "Business", baseP50: 750_000, spread: 0.37, expSlope: 0.09 },
  { slug: "customer-support", label: "Customer Support", family: "Operations", baseP50: 450_000, spread: 0.33, expSlope: 0.07 },
  { slug: "operations-manager", label: "Operations Manager", family: "Operations", baseP50: 1_000_000, spread: 0.4, expSlope: 0.1 },
  { slug: "teacher-educator", label: "Teacher / Educator", family: "Education", baseP50: 500_000, spread: 0.34, expSlope: 0.07 },
  { slug: "doctor-physician", label: "Doctor / Physician", family: "Healthcare", baseP50: 1_200_000, spread: 0.5, expSlope: 0.1 },
  { slug: "civil-engineer", label: "Civil / Mechanical Engineer", family: "Core Engineering", baseP50: 650_000, spread: 0.37, expSlope: 0.085 },
];

export const ROLE_SLUGS = ROLES.map((r) => r.slug);

export type CityTier = 1 | 2 | 3;

export type CityDef = {
  slug: string;
  label: string;
  tier: CityTier;
  /** Pay multiplier relative to the tier-1 reference (Bengaluru = 1.0). */
  multiplier: number;
};

export const CITIES: CityDef[] = [
  { slug: "bengaluru", label: "Bengaluru", tier: 1, multiplier: 1.0 },
  { slug: "mumbai", label: "Mumbai", tier: 1, multiplier: 0.97 },
  { slug: "delhi-ncr", label: "Delhi NCR (incl. Gurugram, Noida)", tier: 1, multiplier: 0.95 },
  { slug: "hyderabad", label: "Hyderabad", tier: 1, multiplier: 0.94 },
  { slug: "pune", label: "Pune", tier: 1, multiplier: 0.9 },
  { slug: "chennai", label: "Chennai", tier: 1, multiplier: 0.87 },
  { slug: "kolkata", label: "Kolkata", tier: 2, multiplier: 0.76 },
  { slug: "ahmedabad", label: "Ahmedabad", tier: 2, multiplier: 0.75 },
  { slug: "jaipur", label: "Jaipur", tier: 2, multiplier: 0.7 },
  { slug: "kochi", label: "Kochi", tier: 2, multiplier: 0.72 },
  { slug: "coimbatore", label: "Coimbatore", tier: 2, multiplier: 0.69 },
  { slug: "indore", label: "Indore", tier: 2, multiplier: 0.68 },
  { slug: "chandigarh", label: "Chandigarh", tier: 2, multiplier: 0.72 },
  { slug: "bhubaneswar", label: "Bhubaneswar", tier: 2, multiplier: 0.66 },
  { slug: "lucknow", label: "Lucknow", tier: 2, multiplier: 0.65 },
  { slug: "nagpur", label: "Nagpur", tier: 2, multiplier: 0.66 },
  { slug: "remote-india", label: "Remote (India-based)", tier: 1, multiplier: 0.92 },
  { slug: "other-india", label: "Other city in India", tier: 3, multiplier: 0.6 },
];

export const CITY_SLUGS = CITIES.map((c) => c.slug);

export type CompanyType =
  | "funded-startup"
  | "bootstrapped-startup"
  | "indian-it-services"
  | "global-product-mnc"
  | "gcc-captive"
  | "domestic-enterprise"
  | "psu-government"
  | "ngo-academia"
  | "other";

export const COMPANY_TYPES: { slug: CompanyType; label: string; multiplier: number }[] = [
  { slug: "funded-startup", label: "VC-funded startup", multiplier: 1.05 },
  { slug: "bootstrapped-startup", label: "Bootstrapped / small startup", multiplier: 0.84 },
  { slug: "indian-it-services", label: "Indian IT services (TCS, Infosys, Wipro…)", multiplier: 0.72 },
  { slug: "global-product-mnc", label: "Global product company (FAANG-type)", multiplier: 1.55 },
  { slug: "gcc-captive", label: "MNC capability centre / GCC", multiplier: 1.15 },
  { slug: "domestic-enterprise", label: "Indian enterprise / bank / conglomerate", multiplier: 0.9 },
  { slug: "psu-government", label: "PSU / government", multiplier: 0.78 },
  { slug: "ngo-academia", label: "NGO / academia", multiplier: 0.62 },
  { slug: "other", label: "Other", multiplier: 1.0 },
];

export const COMPANY_TYPE_SLUGS: string[] = COMPANY_TYPES.map((c) => c.slug);

export const roleBySlug = (slug: string) => ROLES.find((r) => r.slug === slug);
export const cityBySlug = (slug: string) => CITIES.find((c) => c.slug === slug);
export const levelBySlug = (slug: string) => LEVELS.find((l) => l.slug === slug);
export const companyTypeBySlug = (slug: string) => COMPANY_TYPES.find((c) => c.slug === slug);

/** Weighted-average city multiplier, used when a national cohort is rescaled to a city. */
export const NATIONAL_CITY_MULTIPLIER = 0.85;

export function levelForYears(years: number): LevelSlug {
  if (years < 1) return "intern";
  if (years < 2) return "junior";
  if (years < 5) return "mid";
  if (years < 9) return "senior";
  return "staff";
}
