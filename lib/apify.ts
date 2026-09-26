/**
 * Minimal Apify REST client. No SDK — starting a run, polling it and reading its
 * dataset is three endpoints.
 *
 * Actor runs cost money and take minutes, so nothing here is ever called from a
 * request handler. Ingestion is a batch job (`npm run ingest`) that writes into
 * `external_benchmark`; the app only ever reads that table.
 */
const API = "https://api.apify.com/v2";

function token() {
  const t = process.env.APIFY_TOKEN;
  if (!t) throw new Error("APIFY_TOKEN is not set — see .env.local.example");
  return t;
}

export type RunResult = { runId: string; datasetId: string; status: string; items: unknown[] };

async function api(path: string, init?: RequestInit) {
  const res = await fetch(`${API}${path}`, {
    ...init,
    headers: {
      authorization: `Bearer ${token()}`,
      "content-type": "application/json",
      ...init?.headers,
    },
  });
  if (!res.ok) throw new Error(`apify ${res.status} ${path}: ${(await res.text()).slice(0, 300)}`);
  return res.json();
}

/** Start an actor, wait for it to finish, return its dataset items. */
export async function runActor(
  actorId: string,
  input: unknown,
  opts: { timeoutSecs?: number; maxItems?: number; onTick?: (status: string, secs: number) => void } = {},
): Promise<RunResult> {
  const timeoutSecs = opts.timeoutSecs ?? 600;
  const started = await api(`/acts/${actorId}/runs`, {
    method: "POST",
    body: JSON.stringify(input),
  });
  const runId: string = started.data.id;
  const datasetId: string = started.data.defaultDatasetId;

  const begin = Date.now();
  let status: string = started.data.status;
  while (["READY", "RUNNING"].includes(status)) {
    const elapsed = (Date.now() - begin) / 1000;
    if (elapsed > timeoutSecs) {
      await api(`/actor-runs/${runId}/abort`, { method: "POST" }).catch(() => {});
      throw new Error(`actor ${actorId} still ${status} after ${timeoutSecs}s — aborted`);
    }
    opts.onTick?.(status, Math.round(elapsed));
    await new Promise((r) => setTimeout(r, 5000));
    status = (await api(`/actor-runs/${runId}`)).data.status;
  }
  if (status !== "SUCCEEDED") throw new Error(`actor ${actorId} finished ${status}`);

  const limit = opts.maxItems ?? 1000;
  const items = (await api(`/datasets/${datasetId}/items?clean=true&limit=${limit}`)) as unknown[];
  return { runId, datasetId, status, items: Array.isArray(items) ? items : [] };
}
