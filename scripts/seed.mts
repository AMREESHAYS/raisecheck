/**
 * DEMO DATA ONLY. Fills the database so percentile logic has something to work on
 * locally. Fabricated rows in a trust product are exactly the failure this app is
 * built to prevent — never point this at production.
 * Run: npm run seed
 */
import { config } from "dotenv";

// Same precedence Next.js uses, so the scripts and the app read one file.
// Explicit, because bare `dotenv/config` reads `.env` only — and a stray `.env`
// holding a service-role key is the one file that must never be committed.
config({ path: [".env.local", ".env"] });
import { randomUUID } from "node:crypto";
import { supabase, type Submission } from "../lib/db.ts";
import { ROLES, CITIES, EXP_BUCKETS } from "../lib/vocab.ts";

if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
  console.error("No Supabase credentials. Copy .env.local.example to .env.local and fill it in.");
  process.exit(1);
}

if (!process.env.ALLOW_SEED) {
  console.error(
    "Refusing to seed. This writes ~28,000 fabricated salaries.\n" +
      "If this is a throwaway dev project, re-run with ALLOW_SEED=1.",
  );
  process.exit(1);
}

const BASE_LAKHS: Record<string, number> = {
  Engineering: 9, "Data & AI": 10, Design: 7, Product: 12, QA: 6,
  "DevOps & Infra": 9, Security: 9, "IT & Support": 4.5, Sales: 6,
  Marketing: 5.5, "Customer Success": 5, Operations: 5, Finance: 7,
  HR: 5, Legal: 8, Content: 4.5, Consulting: 11, Management: 20,
};
const CITY_MULT: Record<string, number> = {
  Bangalore: 1.15, "Delhi NCR": 1.08, Gurgaon: 1.1, Mumbai: 1.1,
  Hyderabad: 1.05, Pune: 1.0, Chennai: 0.95,
};
const EXP_MULT = [1, 1.9, 3.1, 4.4, 5.6];

const gauss = () =>
  Math.sqrt(-2 * Math.log(1 - Math.random())) * Math.cos(2 * Math.PI * Math.random());

const titles = Object.keys(ROLES);
const rows: Submission[] = [];

for (const city of CITIES) {
  for (const [bi, b] of EXP_BUCKETS.entries()) {
    for (const cat of new Set(Object.values(ROLES))) {
      for (let i = 0; i < 10 + Math.floor(Math.random() * 6); i++) {
        const base = BASE_LAKHS[cat] * (CITY_MULT[city] ?? 0.85) * EXP_MULT[bi];
        const ctc = Math.round(base * 1e5 * Math.exp(gauss() * 0.3));
        if (ctc < 120_000) continue;
        const daysAgo = Math.floor(Math.random() * 500) + 20;
        rows.push({
          id: randomUUID(),
          role_title: titles.find((t) => ROLES[t] === cat)!,
          role_category: cat,
          years_experience: b.min + Math.floor(Math.random() * (Math.min(b.max, b.min + 4) - b.min + 1)),
          city,
          current_ctc_annual: ctc,
          last_raise_pct: Math.round((3 + Math.random() * 14) * 10) / 10,
          last_raise_date: new Date(Date.now() - daysAgo * 864e5).toISOString().slice(0, 10),
          employment_type: Math.random() < 0.94 ? "full-time" : "contract",
          company_size_bucket: ["<50", "50-500", "500-5000", "5000+"][Math.floor(Math.random() * 4)],
          submitted_at: new Date(Date.now() - Math.random() * 20 * 864e5).toISOString(),
          ip_hash: "seed-" + randomUUID(),
          status: "verified",
        });
      }
    }
  }
}

const db = supabase();
await db.from("salary_submission").delete().like("ip_hash", "seed-%");
for (let i = 0; i < rows.length; i += 500) {
  const { error } = await db.from("salary_submission").insert(rows.slice(i, i + 500));
  if (error) {
    console.error(error.message);
    process.exit(1);
  }
  process.stdout.write(`\rinserted ${Math.min(i + 500, rows.length)}/${rows.length}`);
}
console.log(`\nseeded ${rows.length} demo submissions`);
