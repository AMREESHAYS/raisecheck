# RaiseCheck — anonymous salary benchmarking for India

Submit your role, city, experience and CTC. Get back where you sit against real
submissions (P25/P50/P75), whether your last raise actually beat inflation, and a
negotiation coach that only argues from your own numbers.

**No PII exists in the schema.** There is no name, email, phone or company column.
`ip_hash` is a salted SHA-256 used only for rate limiting; it is never returned by an
API route and never leaves the server. Every table has RLS enabled with no policies,
so the anon key can read nothing — only the server's service-role key touches rows.

## Setup

1. **Create a Supabase project** (supabase.com → New project), or provision one
   through the Vercel Marketplace if you're deploying there:
   ```bash
   npm i -g vercel && vercel link && vercel integration add supabase --yes
   ```
2. **Run the migration.** Paste `supabase/migrations/0001_init.sql` into the Supabase
   SQL editor and run it, or `supabase db push` if you use their CLI.
3. **Fill in the env.**
   ```bash
   cp .env.local.example .env.local
   ```
   `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` come from Project Settings → API.
   `GROQ_API_KEY` comes from console.groq.com/keys. `IP_HASH_SALT` is any long random
   string — `openssl rand -hex 32`.

   **Restart the dev server after editing it** — Next.js reads env files only at
   startup, and hot reload will not pick up a new key. Until the values are there the
   app serves a setup screen listing exactly which ones are missing.

   Never create a plain `.env` for these. `.gitignore` covers every env file except
   the example, but the service-role key bypasses RLS entirely — one committed file
   and the whole database is readable by anyone with the repo.
4. ```bash
   npm install
   npm run dev          # http://localhost:3000
   npm test             # money-logic self-check, runs offline
   ```

Optional, for local development only:
```bash
ALLOW_SEED=1 npm run seed
```
This writes ~28,000 **fabricated** submissions so percentile logic has something to
work on. Fabricated rows in a trust product are exactly the failure this app is built
to prevent — never run it against production. Seeded rows are tagged `ip_hash LIKE
'seed-%'` and the script deletes its own previous rows before inserting.

To clear them out for good:
```sql
delete from salary_submission where ip_hash like 'seed-%';
```

## What's built

| Build step | State |
|---|---|
| 1. Data model + submission form + validation gates | done |
| 2. Percentile aggregation + results screen | done |
| 3. Inflation comparison | done |
| 4. Chatbot grounded in the aggregates (Groq) | done |
| 5. Negotiation script generator | done |
| 6. Prediction model, resume analysis, ML spam detection | out of scope |

## Data integrity gates

`lib/validate.ts`, `app/api/submit/route.ts`

- **Role and city are closed vocabularies** (`lib/vocab.ts` — ~170 roles, 25 cities). Free text is rejected, not normalised.
- **CTC bounds**: below ₹1.2 L/yr is rejected as a monthly-figure typo; above ₹2 Cr goes to `pending` for manual review; above ₹50 Cr is rejected. A 0–2 yrs submission above ₹1.5 Cr is rejected as a typo.
- **Rate limit**: one submission per role per 24h, keyed on `sha256(salt | ip | coarse device fingerprint)`.
- **Outlier gate**: >3σ from its own bucket goes to `pending`. Buckets below `MIN_SAMPLE` cannot reject anything — with n<8 every early submission looks extreme.
- Only `status = 'verified'` rows reach any aggregate, anywhere. The `bucket_stats` RPC filters on it in SQL.

## Market rate

`lib/stats.ts` + the `bucket_stats` Postgres function.

Minimum n=8 before any number is shown. P25/P50/P75 via `percentile_cont`, never a
mean. Percentiles, rank and the outlier gate's mean/stddev come back in one round
trip, and salary rows never cross the wire. Sample size is printed next to every figure.

When a bucket is too thin it widens in this order — **city specificity is dropped
before experience granularity**, because pay tracks experience harder than city:

1. role category + city + experience bucket
2. role category + experience bucket, all India
3. role category + a wider experience band, all India
4. role category, all experience levels, all India

Each fallback carries a plain-language note saying what the user is actually looking at.

## Inflation

`lib/inflation.ts`, `data/cpi.json`

`real_change = (1 + raise/100) / (1 + inflation/100) - 1`, where inflation is CPI
compounded (not summed) from the raise date to today, prorating each calendar year.

**Two things in `data/cpi.json` need attention before launch:**

1. `2025` and `2026` are marked `provisional` — replace them with the published MOSPI/RBI figures. `verified_through: 2024` marks what's confirmed against the published series. The UI already tells users when a provisional figure was used.
2. The series is all-India CPI (Combined). MOSPI publishes state-level and rural/urban CPI; wiring city-level in is the obvious next accuracy win, and `CPI_META.geography` is the string to update when you do.

## The coach

`app/api/chat/route.ts`, `lib/groq.ts`

Groq via its OpenAI-compatible endpoint — plain `fetch`, no SDK. Default model is
`llama-3.3-70b-versatile`, overridable with `GROQ_MODEL`. Non-streaming: Groq is fast
enough that a negotiation email lands in a couple of seconds. Switch to SSE if that
stops being true.

The client posts back the same profile it submitted, and **the server re-derives every
market number itself** — it never trusts percentages sent by the browser. Grounding is
injected as a JSON block in a system message. The system prompt enforces: cite the
sample size next to any figure, never claim what a named company pays, say plainly
when the data isn't there rather than guessing, and keep the tone direct.

When the bucket is below n=8, the grounding block says so in words and instructs the
model to admit it. That path is worth testing before launch — it's the one where a
model is most tempted to fall back on training data.

Chat is rate limited to 12 messages/minute per client, in process memory. That stops
one tab burning the Groq budget; it does not survive multiple instances. Move it to
Supabase or Upstash before scaling out.

## Third-party benchmarks

`external_benchmark` table + `npm run import-benchmarks`

Benchmarks from outside our own submissions live in their own table and render in
their own block, attributed to the source by name, with sample size and an as-of date.
They are **never averaged into the community percentiles** — two datasets with
different methodologies merged into one number is how a benchmark stops meaning
anything. The chatbot's grounding block carries the same instruction.

```bash
npm run import-benchmarks -- ./my-licensed-feed.json
```

Every row must carry `source` and `license_note`; the importer refuses rows without
them. `license_note` should state what actually permits the use — a data licence, an
API agreement, a public report's redistribution terms.

**What this is not:** there is no scraper for Glassdoor, AmbitionBox or levels.fyi, and
no adapter that quietly becomes one. See *Where market data can legitimately come from*
below.

## Ingesting AmbitionBox / Glassdoor / levels.fyi via Apify

`scripts/ingest-apify.ts`, `lib/apify.ts`, `lib/ingest/extract.ts`, `data/apify-sources.json`

**Batch, never per-request.** An actor run takes minutes and costs credits, so a user
submitting their salary must never trigger one. Ingestion writes into
`external_benchmark`; the app only ever reads that table, and a repeat run inside
`--stale-days` (default 30) exits without spending anything.

```bash
npm run ingest -- --source levels_fyi --probe      # 10 items, dump the raw shape, write nothing
npm run ingest -- --source levels_fyi --dry-run    # parse + aggregate, write nothing
npm run ingest -- --source levels_fyi              # write
```

Sources are configured in `data/apify-sources.json` — actor ID, input template, and the
`license_note` shown in the UI beside every figure from that source. The actor IDs there
were read from the public Apify store; **verify them in your own account before a paid
run**, since actors get renamed and deprecated.

### Run `--probe` first

These actors don't publish output schemas, so `lib/ingest/extract.ts` reads them
tolerantly: it hunts for a salary, title, location and experience under the key names
these scrapers commonly use, normalises each, and **drops any row it can't read rather
than guessing**. A misparsed salary silently poisons a percentile, and a percentile is
the entire product.

`--probe` prints the real field names and the parse ratio. If that ratio is poor, add
the actual keys to the `*_KEYS` lists in `extract.ts` — that's the intended extension
point, no rewrite needed.

### What survives ingestion

- **Company identity does not.** Rows are aggregated into (role category, city, experience band) buckets and the employer is discarded. The coach is forbidden from claiming what a named employer pays, so that detail must not exist in the first place.
- **Buckets under n=8 are not published** — the same bar community data has to clear.
- **USD rows are dropped unless `USD_INR` is set.** No hardcoded rate: a stale one distorts every figure built on it.
- Figures below ₹1 L/yr are treated as monthly-figure errors, not salaries.

Normalisation handles what these sites actually publish: `₹12,00,000`, `12 LPA`,
`₹8L - ₹12L`, `1.2 Cr`, `$150,000`; `Bengaluru`/`Gurugram`/`Navi Mumbai` mapped onto the
controlled city list; free-text titles mapped to role categories with specific rules
ahead of generic ones, so "Engineering Manager" lands in Management rather than
Engineering. All of it is covered by `npm test`.

### Before you run this

Scraped figures render in their own block, attributed by name with sample size and an
as-of date, and are **never averaged into the community percentiles** — two datasets
with different methodologies merged into one number is how a benchmark stops meaning
anything. The chatbot's grounding block carries the same instruction.

What this code does not do: defeat bot protection, solve CAPTCHAs, or rotate identities
to avoid detection. Fetching is Apify's side of the line; this repo calls their API and
normalises what comes back.

AmbitionBox, Glassdoor and levels.fyi each prohibit automated collection in their terms
of use. Using a commercial scraping platform outsources the execution, not the
compliance — Apify's terms put that on the account holder. `license_note` is a required
field precisely because someone will eventually ask where a number came from; that file
records what you claim about the data, it does not establish your right to it.

Licensed alternatives, if you want figures you can defend without having that argument:
levels.fyi and InfoEdge (AmbitionBox/Naukri) both sell data commercially; Michael Page,
Randstad, Aon and NASSCOM publish India salary guides that permit attributed citation;
PLFS and MOSPI wage series are openly published and free. All of them import through
`npm run import-benchmarks` with the same attribution.

## Before deploying

- Set `IP_HASH_SALT` to a real secret. In production the app refuses to start hashing without it.
- The service-role key must exist only as a server env var. Anything named `NEXT_PUBLIC_*` ships to the browser.
- Chat rate limiting is per-instance (see above).
