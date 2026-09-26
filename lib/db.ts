import { createClient } from "@supabase/supabase-js";
import type { Database } from "./database.types";
import { createHash } from "node:crypto";

// Service-role key. Server-side only — every table has RLS enabled with no
// policies, so the anon key can read nothing. Never import this module from a
// client component.
let client: ReturnType<typeof createClient<Database>> | null = null;

export function supabase() {
  if (client) return client;
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key)
    throw new Error(
      "SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set — see .env.local.example",
    );
  client = createClient<Database>(url, key, { auth: { persistSession: false } });
  return client;
}

/** Whether the server has what it needs to talk to Supabase at all. */
export function missingConfig() {
  const needed = ["SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"];
  // hashClient() throws without a salt in production, which would render a working
  // form whose every submission fails. Treat it as required wherever it is required.
  if (process.env.NODE_ENV === "production") needed.push("IP_HASH_SALT");
  return needed.filter((k) => !process.env[k]);
}

export function isConfigured() {
  return missingConfig().length === 0;
}

export type Submission = {
  id: string;
  role_title: string;
  role_category: string;
  years_experience: number;
  city: string;
  current_ctc_annual: number;
  last_raise_pct: number | null;
  last_raise_date: string | null;
  employment_type: string;
  company_size_bucket: string | null;
  submitted_at: string;
  ip_hash: string;
  status: "pending" | "verified" | "rejected";
};

/** Salted so the column can never be reversed into a visitor list, even if dumped. */
export function hashClient(ip: string, fingerprint: string) {
  const salt = process.env.IP_HASH_SALT;
  if (!salt && process.env.NODE_ENV === "production")
    throw new Error("IP_HASH_SALT must be set in production");
  return createHash("sha256")
    .update(`${salt ?? "dev-only-salt"}|${ip}|${fingerprint}`)
    .digest("hex");
}

export async function hasRecentSubmission(ipHash: string, roleTitle: string) {
  const since = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
  const { count, error } = await supabase()
    .from("salary_submission")
    .select("id", { count: "exact", head: true })
    .eq("ip_hash", ipHash)
    .eq("role_title", roleTitle)
    .gt("submitted_at", since);
  if (error) throw new Error(`rate-limit check failed: ${error.message}`);
  return (count ?? 0) > 0;
}

export async function insertSubmission(s: Submission) {
  const { error } = await supabase().from("salary_submission").insert(s);
  if (error) throw new Error(`insert failed: ${error.message}`);
}

export type BucketStats = {
  n: number;
  p25: number;
  p50: number;
  p75: number;
  mean: number;
  std: number;
  rank_pct: number | null;
};

/**
 * Percentiles, rank and the outlier gate's mean/stddev in one round trip.
 * Postgres does the percentile_cont — we never pull salary rows over the wire.
 * city = null means all-India.
 */
export async function bucketStats(args: {
  role_category: string;
  city: string | null;
  minYears: number;
  maxYears: number;
  ctc?: number;
}): Promise<BucketStats> {
  const { data, error } = await supabase().rpc("bucket_stats", {
    p_category: args.role_category,
    p_city: args.city,
    p_min_years: args.minYears,
    p_max_years: args.maxYears,
    p_ctc: args.ctc ?? null,
  });
  if (error) throw new Error(`bucket_stats failed: ${error.message}`);
  const row = data?.[0];
  if (!row || !row.n) return { n: 0, p25: 0, p50: 0, p75: 0, mean: 0, std: 0, rank_pct: null };
  return {
    n: Number(row.n),
    p25: Number(row.p25),
    p50: Number(row.p50),
    p75: Number(row.p75),
    mean: Number(row.mean),
    std: Number(row.std),
    rank_pct: row.rank_pct == null ? null : Number(row.rank_pct),
  };
}

export async function verifiedCountThisMonth() {
  // A missing key or a broken counter must never take the landing page down.
  try {
    const { data, error } = await supabase().rpc("verified_count_this_month");
    return error ? 0 : Number(data ?? 0);
  } catch {
    return 0;
  }
}

export type ExternalBenchmark = {
  source: string;
  source_url: string | null;
  license_note: string;
  p25: number | null;
  p50: number;
  p75: number | null;
  sample_size: number | null;
  as_of: string;
};

/** Third-party benchmarks for a bucket. Always displayed attributed, never blended. */
export async function externalBenchmarks(args: {
  role_category: string;
  city: string | null;
  years: number;
}): Promise<ExternalBenchmark[]> {
  const q = supabase()
    .from("external_benchmark")
    .select("source, source_url, license_note, p25, p50, p75, sample_size, as_of")
    .eq("role_category", args.role_category)
    .lte("min_years", args.years)
    .gte("max_years", args.years)
    .order("as_of", { ascending: false });
  // External data is a bonus, not a dependency: never fail a result page over it.
  try {
    // A city-less row is an all-India figure and still applies to someone who
    // named a city — AmbitionBox publishes no location at all, so filtering
    // strictly on city would hide every row it gives us.
    const { data, error } = await (args.city
      ? q.or(`city.eq.${args.city},city.is.null`)
      : q.is("city", null));
    return error ? [] : (data ?? []);
  } catch {
    return [];
  }
}
