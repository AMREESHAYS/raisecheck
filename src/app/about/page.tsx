import Link from "next/link";
import { CPI_SOURCE_NOTE, INDIA_CPI_INFLATION } from "@/lib/data/inflation";
import { MIN_EFFECTIVE_SAMPLE, SEED_WEIGHT } from "@/lib/benchmark";
import { datasetStats } from "@/lib/repo";

export const dynamic = "force-dynamic";

export default async function AboutPage() {
  const stats = await datasetStats().catch(() => null);

  return (
    <main className="wrap">
      <h1>How this works</h1>
      <p className="lede">
        A salary platform is only worth using if you can check its reasoning. Here is all of it.
      </p>

      <h2>Where the numbers come from</h2>
      <p>
        Two sources, always labelled separately. <strong>Real reports</strong> are what people
        submit. <strong>Seeded reference rows</strong> are generated from documented assumptions
        about role medians, city cost differences and company-type premiums — they exist so the
        platform is useful before it has an audience.
      </p>
      <p>
        Seeded rows count for {SEED_WEIGHT} of a real report in every calculation, so real data
        overtakes them quickly. Every result tells you how many of each it used, and says plainly
        when it is resting mostly on reference data.
      </p>
      {stats && (
        <div className="stats">
          <div className="stat">
            <div className="k">Real reports</div>
            <div className="v">{stats.realReports.toLocaleString("en-IN")}</div>
          </div>
          <div className="stat">
            <div className="k">Reference rows</div>
            <div className="v">{stats.seedReports.toLocaleString("en-IN")}</div>
          </div>
          <div className="stat">
            <div className="k">Held for review</div>
            <div className="v">{stats.pendingReview.toLocaleString("en-IN")}</div>
          </div>
        </div>
      )}

      <h2>How your fair range is worked out</h2>
      <p>
        We do not show you an average. Averages in Indian salary data are dragged around by a
        handful of very high earners, and they tell you nothing about your own situation.
      </p>
      <p>Instead, for each query we build a cohort of comparable reports, in this order:</p>
      <ol>
        <li>Your exact role, city and experience band.</li>
        <li>Your role and city, all experience levels.</li>
        <li>Your role in cities of the same tier.</li>
        <li>Your role nationally.</li>
      </ol>
      <p>
        We stop at the first level with at least {MIN_EFFECTIVE_SAMPLE} units of effective sample,
        and we always tell you which level was used. Rows pulled in from another city are rescaled
        to yours, and every row is slid along the role&apos;s experience curve so a cohort of
        juniors cannot drag down a senior&apos;s benchmark. Then we apply your company type, because
        the same job pays very differently at an IT services firm and at a global product company.
      </p>

      <h2>Raise vs. inflation</h2>
      <p>
        A 6% raise against 6.7% inflation is a pay cut. We compute the real raise as
        (1 + your raise) ÷ (1 + inflation over the same months) − 1, compounding CPI month by month
        rather than subtracting one number from another.
      </p>
      <p className="hint">{CPI_SOURCE_NOTE}</p>
      <table className="dist-table">
        <thead>
          <tr>
            <th>Year</th>
            <th>India CPI inflation</th>
          </tr>
        </thead>
        <tbody>
          {INDIA_CPI_INFLATION.slice().reverse().map((y) => (
            <tr key={y.year}>
              <td>
                {y.year}
                {y.provisional ? " (provisional)" : ""}
              </td>
              <td>{y.cpiInflationPct}%</td>
            </tr>
          ))}
        </tbody>
      </table>

      <h2>Raise or switch?</h2>
      <p>
        Internal raises rarely clear about 25%; job switches routinely do more. So we compare your
        gap against both. The job-switch premium is measured from the dataset itself — how much more
        recent joiners earn than people with three or more years of tenure, with the experience
        effect stripped out — and never from seeded rows, so the platform cannot read its own
        assumptions back out as a finding. Until there is enough real data to measure it, we use a
        documented default and label it as one.
      </p>

      <h2>Keeping the data honest</h2>
      <p>
        Every submission is screened by deterministic rules before it can affect anyone&apos;s
        benchmark: component sanity checks, a robust outlier test based on median absolute deviation
        so existing outliers cannot widen the gate, and duplicate detection. Unusual-but-plausible
        reports are accepted at reduced weight; implausible ones are held for review, not silently
        deleted. No model ever decides whether your report is real.
      </p>

      <h2>What we never store</h2>
      <p>
        No email, no name, no employer, no login, no IP address in the database. The only per-row
        identifier is a one-way hash of the figures you reported, used to catch accidental double
        submissions. There is no user table to leak.
      </p>

      <h2>What the AI does and doesn&apos;t do</h2>
      <p>
        The assistant has no salary knowledge of its own. It can only produce a figure by calling a
        tool that reads this database, and it is instructed to say &ldquo;I don&apos;t have enough
        data&rdquo; rather than estimate. The negotiation draft is given your assessment and told to
        use nothing else. If you see a number, it came from the data.
      </p>

      <p style={{ marginTop: 32 }}>
        <Link href="/">← Check your own pay</Link>
      </p>
    </main>
  );
}
