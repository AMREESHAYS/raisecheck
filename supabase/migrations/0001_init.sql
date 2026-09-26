-- RaiseCheck schema.
-- Design rule: there is no PII column here and there never will be.
-- ip_hash is a salted SHA-256 used only for rate limiting. It is never selected
-- into an API response and never leaves the server.

create table if not exists salary_submission (
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
  submitted_at        timestamptz not null default now(),
  ip_hash             text    not null,
  status              text    not null check (status in ('pending','verified','rejected'))
);

create index if not exists idx_bucket
  on salary_submission (role_category, city, years_experience) where status = 'verified';
create index if not exists idx_ratelimit
  on salary_submission (ip_hash, role_title, submitted_at);
create index if not exists idx_verified_at
  on salary_submission (submitted_at) where status = 'verified';

-- Benchmarks from outside our own submissions (licensed feeds, published reports,
-- datasets you have the right to use). Kept in a separate table so a community
-- number and a third-party number can never be silently averaged into one figure:
-- every row carries its own source, sample size and licence note, and the UI
-- attributes each one.
create table if not exists external_benchmark (
  id            uuid primary key default gen_random_uuid(),
  source        text not null,
  source_url    text,
  license_note  text not null,
  role_category text not null,
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
create index if not exists idx_external_bucket
  on external_benchmark (role_category, city, min_years, max_years);

-- Deny-all by default. No policies are defined, so the anon and authenticated
-- keys can read nothing. Only the service-role key (server-side) touches rows.
alter table salary_submission  enable row level security;
alter table external_benchmark enable row level security;

-- Newer Supabase projects don't hand service_role table privileges by default,
-- so the server gets a 42501 on every query without this. RLS above still holds:
-- these grants only apply to the server-side key, never to anon or authenticated.
grant usage on schema public to service_role;
grant select, insert, update, delete on public.salary_submission  to service_role;
grant select, insert, update, delete on public.external_benchmark to service_role;

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
