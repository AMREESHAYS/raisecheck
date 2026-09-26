import Link from "next/link";
import { predictFairRange } from "@/lib/benchmark";
import { CITIES, ROLES, cityBySlug, roleBySlug } from "@/lib/data/taxonomy";
import { formatInrShort } from "@/lib/format";
import { loadRoleRows } from "@/lib/repo";

export const dynamic = "force-dynamic";

const EXPERIENCE_COLUMNS = [1, 3, 5, 8, 12];

/**
 * Browse benchmarks without submitting anything.
 *
 * Nobody should have to hand over their salary to find out what a role pays —
 * that would make the platform feel like a toll gate rather than a public good.
 */
export default async function ExplorePage({
  searchParams,
}: {
  searchParams: Promise<{ role?: string; city?: string }>;
}) {
  const params = await searchParams;
  const roleSlug = roleBySlug(params.role ?? "")?.slug ?? "software-engineer";
  const citySlug = cityBySlug(params.city ?? "")?.slug ?? "bengaluru";

  const rows = await loadRoleRows(roleSlug).catch(() => []);
  const role = roleBySlug(roleSlug)!;
  const city = cityBySlug(citySlug)!;

  const columns = EXPERIENCE_COLUMNS.map((years) => {
    const fair = predictFairRange(rows, { roleSlug, citySlug, yearsExperience: years });
    return { years, fair };
  });

  const anyData = columns.some((c) => c.fair.benchmark.matchLevel !== "none");

  return (
    <main className="wrap">
      <h1>Explore the data</h1>
      <p className="lede">
        Market rates by role, city and experience — no submission needed. Total annual compensation,
        in rupees.
      </p>

      <form className="card flat grid2" method="get">
        <div>
          <label htmlFor="role">Role</label>
          <select id="role" name="role" defaultValue={roleSlug}>
            {ROLES.map((r) => (
              <option key={r.slug} value={r.slug}>
                {r.label}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="city">City</label>
          <select id="city" name="city" defaultValue={citySlug}>
            {CITIES.map((c) => (
              <option key={c.slug} value={c.slug}>
                {c.label}
              </option>
            ))}
          </select>
        </div>
        <div style={{ alignSelf: "end" }}>
          <button type="submit">Show rates</button>
        </div>
      </form>

      <h2>
        {role.label} · {city.label}
      </h2>

      {!anyData ? (
        <div className="card">
          <p>
            No comparable reports for this combination yet. We would rather show you nothing than a
            number we made up.
          </p>
        </div>
      ) : (
        <div className="card flat">
          <table className="dist-table">
            <thead>
              <tr>
                <th>Experience</th>
                <th>25th</th>
                <th>Median</th>
                <th>75th</th>
                <th>90th</th>
                <th>Based on</th>
              </tr>
            </thead>
            <tbody>
              {columns.map(({ years, fair }) => {
                const b = fair.benchmark;
                if (b.matchLevel === "none") {
                  return (
                    <tr key={years}>
                      <td>{years} yrs</td>
                      <td colSpan={5} style={{ textAlign: "left", color: "var(--text-faint)" }}>
                        not enough data
                      </td>
                    </tr>
                  );
                }
                return (
                  <tr key={years}>
                    <td>{years} yrs</td>
                    <td>{formatInrShort(b.percentiles.p25)}</td>
                    <td>
                      <strong>{formatInrShort(b.percentiles.p50)}</strong>
                    </td>
                    <td>{formatInrShort(b.percentiles.p75)}</td>
                    <td>{formatInrShort(b.percentiles.p90)}</td>
                    <td>
                      {b.sampleSize} ({b.realSampleSize} real){" "}
                      <span className={`badge ${b.confidence}`}>{b.confidence}</span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <p className="hint">
            Where a cohort was too thin, figures are widened to nearby segments and rescaled to{" "}
            {city.label}. &ldquo;Real&rdquo; counts reports submitted by people; the rest are seeded
            reference rows weighted well below them.{" "}
            <Link href="/about">How this is calculated →</Link>
          </p>
        </div>
      )}

      <p style={{ marginTop: 28 }}>
        <Link href="/">← Check whether you&apos;re underpaid</Link>
      </p>
    </main>
  );
}
