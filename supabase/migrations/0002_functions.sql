-- Functions only. The tables already exist; this adds what the migration missed.
-- Paste into Supabase dashboard -> SQL Editor -> Run.

/*
 * One round trip serves all three things the app needs about a bucket:
 * the public percentiles, where a given CTC ranks inside it, and the
 * mean/stddev the outlier gate uses. p_city null means "all India".
 */
create or replace function bucket_stats(
  p_category  text,
  p_city      text,
  p_min_years int,
  p_max_years int,
  p_ctc       bigint default null
)
returns table (
  n       bigint,
  p25     bigint,
  p50     bigint,
  p75     bigint,
  mean    double precision,
  std     double precision,
  rank_pct int
)
language sql
stable
security definer
set search_path = public
as $$
  with rows as (
    select current_ctc_annual as ctc
    from salary_submission
    where status = 'verified'
      and role_category = p_category
      and years_experience between p_min_years and p_max_years
      and (p_city is null or city = p_city)
  )
  select
    count(*)::bigint,
    percentile_cont(0.25) within group (order by ctc)::bigint,
    percentile_cont(0.50) within group (order by ctc)::bigint,
    percentile_cont(0.75) within group (order by ctc)::bigint,
    avg(ctc)::double precision,
    coalesce(stddev_pop(ctc), 0)::double precision,
    case
      when p_ctc is null or count(*) = 0 then null
      else round(100.0 * count(*) filter (where ctc < p_ctc) / count(*))::int
    end
  from rows;
$$;

create or replace function verified_count_this_month()
returns bigint
language sql
stable
security definer
set search_path = public
as $$
  select count(*)::bigint from salary_submission
  where status = 'verified' and submitted_at >= date_trunc('month', now());
$$;

-- Aggregates are only safe once the app's n>=8 gate has been applied, and that
-- gate lives in application code. So the functions stay server-side only.
do $$
begin
  -- Guarded so the migration also applies to a plain Postgres (a local test
  -- container has no anon/authenticated roles; a Supabase project does).
  if exists (select 1 from pg_roles where rolname = 'anon') then
    revoke execute on function bucket_stats(text,text,int,int,bigint) from anon;
    revoke execute on function verified_count_this_month() from anon;
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    revoke execute on function bucket_stats(text,text,int,int,bigint) from authenticated;
    revoke execute on function verified_count_this_month() from authenticated;
  end if;
end $$;
