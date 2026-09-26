// Hand-written and deliberately minimal: just the shapes this app actually reads
// and writes, so Supabase queries are typed without a generated 2000-line file.
// Regenerate properly with `supabase gen types typescript` if the schema grows.

export type SalarySubmissionRow = {
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

export type ExternalBenchmarkRow = {
  /** Employer category the figure describes. Null when the source didn't say. */
  segment: string | null;
  id: string;
  source: string;
  source_url: string | null;
  license_note: string;
  role_category: string;
  city: string | null;
  min_years: number;
  max_years: number;
  p25: number | null;
  p50: number;
  p75: number | null;
  sample_size: number | null;
  as_of: string;
  imported_at: string;
};

export type BucketStatsRow = {
  n: number;
  p25: number;
  p50: number;
  p75: number;
  mean: number;
  std: number;
  rank_pct: number | null;
};

export type Database = {
  public: {
    Tables: {
      salary_submission: {
        Row: SalarySubmissionRow;
        Insert: SalarySubmissionRow;
        Update: Partial<SalarySubmissionRow>;
        Relationships: [];
      };
      external_benchmark: {
        Row: ExternalBenchmarkRow;
        Insert: Omit<ExternalBenchmarkRow, "id" | "imported_at"> & { id?: string };
        Update: Partial<ExternalBenchmarkRow>;
        Relationships: [];
      };
      // The real-data rebuild runs against its own tables so the live demo keeps
      // its rows. Identical shapes; TABLE_SUFFIX picks which pair is in use.
      salary_submission_v2: {
        Row: SalarySubmissionRow;
        Insert: SalarySubmissionRow;
        Update: Partial<SalarySubmissionRow>;
        Relationships: [];
      };
      external_benchmark_v2: {
        Row: ExternalBenchmarkRow;
        Insert: Omit<ExternalBenchmarkRow, "id" | "imported_at"> & { id?: string };
        Update: Partial<ExternalBenchmarkRow>;
        Relationships: [];
      };
    };
    Views: Record<never, never>;
    Functions: {
      bucket_stats: {
        Args: {
          p_category: string;
          p_city: string | null;
          p_min_years: number;
          p_max_years: number;
          p_ctc: number | null;
        };
        Returns: BucketStatsRow[];
      };
      verified_count_this_month: { Args: Record<never, never>; Returns: number };
      bucket_stats_v2: {
        Args: {
          p_category: string;
          p_city: string | null;
          p_min_years: number;
          p_max_years: number;
          p_ctc: number | null;
        };
        Returns: BucketStatsRow[];
      };
      verified_count_this_month_v2: { Args: Record<never, never>; Returns: number };
    };
    Enums: Record<never, never>;
    CompositeTypes: Record<never, never>;
  };
};
