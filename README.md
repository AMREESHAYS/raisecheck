# Saltor

A salary fairness platform for India. Share your pay anonymously, see the real market
rate for your role and city, find out whether your last raise actually beat inflation,
and get the words to ask for more.

Most people never negotiate because they don't know what they're worth. This gives them
the data and the language to do it.

---

## What it does today

- **Anonymous salary collection.** No account, no email, no employer name. The only
  per-row identifier is a one-way hash of the reported figures, used to catch duplicate
  submissions.
- **Real market rates, not averages.** Weighted percentiles over a cohort of comparable
  reports, widened step by step (exact city + experience → city → city tier → national)
  until there is enough sample, with the level used always reported.
- **A fair range for *you*, not for the cohort.** Rows are rescaled to your city and slid
  along the role's experience curve, then adjusted for company type. Every adjustment
  applied is listed in the UI so the number can be argued with.
- **Raise vs. real inflation.** Compares your nominal raise against compounded India CPI
  over the same window, and shows what you would need just to break even.
- **Raise or switch?** Compares your gap against what internal raises realistically clear
  (~25%) and against the job-switch premium measured from the dataset itself.
- **A grounded chatbot.** Ask "am I underpaid?" and get a real answer. The model has no
  salary knowledge of its own — it can only produce a figure by calling a tool that reads
  the database, and is instructed to say "I don't have enough data" rather than estimate.
- **A negotiation draft.** An email, a spoken script, or a short message, built from your
  own assessment. Nothing in it is invented; missing specifics become marked placeholders.
- **Spam and outlier screening.** Deterministic rules only — component sanity checks, a
  median-absolute-deviation outlier test, and duplicate detection. No model ever decides
  whether your report is real.

## Not built yet

- Resume analysis ("what should I learn next for a bigger raise")
- An AI plausibility check layered on top of the rule-based spam screening
- A moderation UI for the `pending` queue (rows are held correctly; there is no screen
  to review them yet)
- Auth, so nothing prevents one person from submitting repeatedly with varied figures

---

## Running it

```bash
npm install
cp .env.example .env.local     # optional — it runs with no configuration at all
npm run db:seed                # generates the reference dataset (~54,000 rows, ~10s)
npm run dev                    # http://localhost:3000
```

With no `DATABASE_URL`, the app runs against **PGlite** — real Postgres compiled to WASM,
stored in `./.pglite`. Zero setup, same SQL dialect as production. Point `DATABASE_URL` at
a real Postgres (Supabase, Neon, Railway, local) and it switches over with no code change:

```bash
export DATABASE_URL=postgres://user:pass@host:5432/saltor
npm run db:push                # create the schema
npm run db:seed
```

With no `ANTHROPIC_API_KEY`, the AI features still work — they fall back to deterministic
output built from the same data. The chatbot answers from templates and the negotiation
draft is assembled from a template. Only the prose changes when you add a key; the numbers
are identical either way.

```bash
npm test          # 90 tests over the benchmark, inflation, screening, advice and tool layers
npm run typecheck
npm run build
```

---

## How the numbers work

### Cold start

A salary platform is worthless on day one, because there is no data. So the repo ships a
**seed dataset** generated from documented assumptions — role reference medians, city
multipliers, company-type premiums, all in `src/lib/data/taxonomy.ts`. Three things keep
this honest:

1. Every seed row is marked `source = 'seed'` and shown to users as reference data.
2. Seed rows carry a weight of **0.35** against a real report in every percentile
   calculation. About ten real submissions outvote a cohort's seed rows.
3. The job-switch premium is **never** measured from seed rows, so the platform cannot
   read its own assumptions back out and present them as a finding.

Every result states how many real reports it used, and says plainly when it is resting
mostly on reference data. Lower `SEED_WEIGHT` in `src/lib/benchmark.ts` as real data
arrives; delete the seed rows entirely once a role has enough of its own
(`npm run db:seed -- --reset` regenerates them).

### Cohort widening

`computeBenchmark` tries progressively wider cohorts and stops at the first with at least
8 units of effective (weight-summed) sample:

| Level | Cohort |
|---|---|
| `role-city-experience` | exact role, city, and ±2.5 years |
| `role-city` | role and city, any experience |
| `role-tier-experience` | role, same city tier, ±2.5 years |
| `role-national-experience` | role nationally, ±2.5 years |
| `role-national` | role nationally |

Rows pulled in from another city are rescaled by the ratio of city multipliers, and every
row is slid along the role's experience curve (capped at ±3 years) so a cohort of juniors
cannot drag down a senior's benchmark. If nothing clears the bar, the match level is
`none` and the UI shows nothing rather than a guess.

### Real raise

`(1 + nominal) ÷ (1 + inflation) − 1`, with CPI compounded month by month rather than
years being added together. The CPI series lives in `src/lib/data/inflation.ts` with its
source noted; the two most recent years are marked provisional and should be verified
against the current MoSPI release before you rely on them.

### Screening

`screenSubmission` is pure, synchronous and deterministic. Suspicious rows go to `pending`
— excluded from benchmarks, kept for review — rather than being deleted, and merely
unusual rows are accepted at a reduced `trustScore` so one weird-but-real salary cannot
move a median by itself. The outlier test uses median absolute deviation so that existing
outliers cannot widen the gate.

---

## Layout

```
src/
  lib/
    benchmark.ts        percentile engine, cohort widening, fair-range prediction
    advice.ts           raise-vs-switch decision, job-switch premium measurement
    validate.ts         submission schema + deterministic spam/outlier screening
    format.ts           rupee parsing and lakh/crore formatting
    repo.ts             database access
    ratelimit.ts        in-process limiter for the AI routes
    data/
      taxonomy.ts       roles, cities, levels, company types — append-only slugs
      inflation.ts      India CPI series and real-raise maths
    ai/
      client.ts         key-optional Anthropic client
      tools.ts          the only way the model can obtain a number
      chat.ts           grounded chatbot (manual tool-use loop)
      negotiation.ts    negotiation draft, with a template fallback
  db/
    schema.ts           one table; deliberately no user table
    index.ts            Postgres via DATABASE_URL, or embedded PGlite
    seed.ts             deterministic reference dataset generator
  app/                  Next.js App Router — pages, components, API routes
tests/                  vitest suites for every engine above
```

### API

| Route | Purpose |
|---|---|
| `GET /api/meta` | Taxonomy, CPI series, dataset stats, whether AI is configured |
| `GET /api/benchmark` | Fair range for a query; add `currentTotal` for a full assessment |
| `POST /api/submissions` | Screen and store a report, and return that person's assessment |
| `POST /api/chat` | Grounded question answering |
| `POST /api/negotiate` | Negotiation draft |

---

## Before this goes live

- **Rate limiting is per-process and in-memory.** Put a real limiter in front of it.
- **Verify the CPI figures** for the two provisional years against MoSPI.
- **The seed multipliers are assumptions, not measurements.** They are reasonable, and
  they are labelled, but they are not research. Revisit them once real data can correct
  them.
- **There is no moderation screen** for the `pending` queue.
- **No abuse protection beyond duplicate detection** — a determined submitter can still
  skew a thin cohort with varied figures.
