-- Parallel tables for the real-data rebuild.
--
-- The live demo runs on the same Supabase project and is propped up by ~26,500
-- fabricated rows. Purging those would empty it mid-demo, so this work gets its
-- own tables instead and production is left exactly as it is. Nothing here holds
-- generated data: every row must come from a real submission or a cited source.
--
-- Point the app at these with TABLE_SUFFIX=_v2.

create table if not exists salary_submission_v2 (
  id                  uuid primary key,
  role_title          text    not null,
  role_category       text    not null,
  years_experience    int     not null check (years_experience between 0 and 50),
  city                text    not null,
  current_ctc_annual  bigint  not null check (current_ctc_annual > 0),
  last_raise_pct      real,
  last_raise_date     date,
  employment_type     text    not null check (employment_type in ('full-time','contract')),
  company_size_bucket text             check (company_size_bucket in ('<50','50-500','500-5000','5000+')),
  -- The single most explanatory field on the form. Engineering at 3-5 years is
  -- ₹7.1 L in IT services and ₹26.4 L at a product company — both real. Without
  -- this, those collapse into one median that describes nobody.
  employer_segment    text             check (employer_segment in ('IT Services','Product & Internet','GCC','BFSI','Consulting','Startup','Other')),
  submitted_at        timestamptz not null default now(),
  ip_hash             text    not null,
  status              text    not null check (status in ('pending','verified','rejected'))
);

create index if not exists idx_bucket_v2
  on salary_submission_v2 (role_category, city, years_experience) where status = 'verified';
create index if not exists idx_bucket_segment_v2
  on salary_submission_v2 (role_category, employer_segment, years_experience) where status = 'verified';
create index if not exists idx_ratelimit_v2
  on salary_submission_v2 (ip_hash, role_title, submitted_at);
create index if not exists idx_verified_at_v2
  on salary_submission_v2 (submitted_at) where status = 'verified';

-- `segment` is the new part. Without it, two correct figures look like a
-- contradiction: an IT services engineer at 6 years and a product-company
-- engineer at 6 years are four times apart, and one median across both
-- describes nobody. It is the coarsest field that carries the explanation —
-- employer identity still never survives ingestion.
create table if not exists external_benchmark_v2 (
  id            uuid primary key default gen_random_uuid(),
  source        text not null,
  source_url    text,
  license_note  text not null,
  role_category text not null,
  segment       text check (segment in ('IT Services','Product & Internet','GCC','BFSI','Consulting','Startup','Other')),
  city          text,
  min_years     int  not null,
  max_years     int  not null,
  p25           bigint,
  p50           bigint not null,
  p75           bigint,
  sample_size   int,
  as_of         date not null,
  imported_at   timestamptz not null default now()
);
create index if not exists idx_external_bucket_v2
  on external_benchmark_v2 (role_category, city, min_years, max_years);
create index if not exists idx_external_segment_v2
  on external_benchmark_v2 (role_category, segment, min_years, max_years);

alter table salary_submission_v2  enable row level security;
alter table external_benchmark_v2 enable row level security;

grant usage on schema public to service_role;
grant select, insert, update, delete on public.salary_submission_v2  to service_role;
grant select, insert, update, delete on public.external_benchmark_v2 to service_role;

create or replace function bucket_stats_v2(
  p_category  text,
  p_city      text,
  p_min_years int,
  p_max_years int,
  p_ctc       bigint default null
)
returns table (
  n bigint, p25 bigint, p50 bigint, p75 bigint,
  mean double precision, std double precision, rank_pct int
)
language sql stable security definer set search_path = public as $$
  with rows as (
    select current_ctc_annual as ctc
    from salary_submission_v2
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
    case when p_ctc is null or count(*) = 0 then null
         else round(100.0 * count(*) filter (where ctc < p_ctc) / count(*))::int end
  from rows;
$$;

create or replace function verified_count_this_month_v2()
returns bigint
language sql stable security definer set search_path = public as $$
  select count(*)::bigint from salary_submission_v2
  where status = 'verified' and submitted_at >= date_trunc('month', now());
$$;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    revoke execute on function bucket_stats_v2(text,text,int,int,bigint) from anon;
    revoke execute on function verified_count_this_month_v2() from anon;
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    revoke execute on function bucket_stats_v2(text,text,int,int,bigint) from authenticated;
    revoke execute on function verified_count_this_month_v2() from authenticated;
  end if;
end $$;
