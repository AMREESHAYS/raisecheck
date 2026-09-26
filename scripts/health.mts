/**
 * Does every external dependency actually answer? Run: npm run health
 * Checks credentials, schema, and a real round trip to each service.
 */
import { config } from "dotenv";
config({ path: [".env.local", ".env"] });

import { supabase } from "../lib/db.ts";
import { groqChat, groqModel } from "../lib/groq.ts";

let failed = false;
const ok = (m: string) => console.log(`  PASS  ${m}`);
const bad = (m: string) => {
  failed = true;
  console.log(`  FAIL  ${m}`);
};

console.log("\nenv");
for (const k of ["SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY", "GROQ_API_KEY", "IP_HASH_SALT"]) {
  process.env[k] ? ok(k) : bad(`${k} is missing`);
}
if (process.env.SUPABASE_SERVICE_ROLE_KEY && process.env.SUPABASE_SERVICE_ROLE_KEY.length < 30)
  bad("SUPABASE_SERVICE_ROLE_KEY looks too short — is it the anon key?");

console.log("\nsupabase");

/**
 * Asks PostgREST directly rather than going through supabase-js.
 * A `head: true` count against a missing table came back with no error object,
 * which read as a pass while the table did not exist — a health check that can
 * report green on a missing schema is worse than no health check.
 */
async function tableExists(table: string) {
  const url = process.env.SUPABASE_URL!.trim().replace(/\/$/, "");
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY!.trim();
  const res = await fetch(`${url}/rest/v1/${table}?select=*&limit=1`, {
    headers: { apikey: key, authorization: `Bearer ${key}` },
  });
  const body = await res.text();
  if (res.status === 200) return { ok: true as const, rows: JSON.parse(body).length as number };
  return { ok: false as const, detail: `${res.status} ${body.slice(0, 160)}` };
}

for (const table of ["salary_submission", "external_benchmark"]) {
  try {
    const r = await tableExists(table);
    if (r.ok) ok(`${table} exists`);
    else bad(`${table}: ${r.detail}  (run supabase/migrations/0001_init.sql in the SQL editor)`);
  } catch (e) {
    bad(`${table}: ${(e as Error).message}`);
  }
}

try {
  const { data, error } = await supabase().rpc("bucket_stats", {
    p_category: "Engineering",
    p_city: null,
    p_min_years: 0,
    p_max_years: 60,
    p_ctc: null,
  });
  if (error) bad(`bucket_stats RPC: ${error.message}  (migration not applied?)`);
  else ok(`bucket_stats RPC works — ${Number(data?.[0]?.n ?? 0)} verified Engineering rows`);
} catch (e) {
  bad(`bucket_stats RPC: ${(e as Error).message}`);
}

try {
  const { data, error } = await supabase().rpc("verified_count_this_month");
  if (error) bad(`verified_count_this_month: ${error.message}`);
  else ok(`verified_count_this_month = ${Number(data ?? 0)}`);
} catch (e) {
  bad(`verified_count_this_month: ${(e as Error).message}`);
}

console.log(`\ngroq (${groqModel()})`);
try {
  const reply = await groqChat([
    { role: "system", content: "Reply with exactly one word." },
    { role: "user", content: "Say OK." },
  ]);
  ok(`model answered: "${reply.slice(0, 40)}"`);
} catch (e) {
  bad((e as Error).message);
}

console.log(failed ? "\nHEALTH CHECK FAILED\n" : "\nALL CHECKS PASSED\n");
process.exit(failed ? 1 : 0);
