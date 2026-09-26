import Anthropic from "@anthropic-ai/sdk";

/**
 * Model used for every generated response. Kept in one place so it can be
 * changed without hunting through route handlers.
 */
export const MODEL = process.env.SALTOR_MODEL ?? "claude-opus-5";

let cached: Anthropic | null = null;

/**
 * True when the app has credentials to call Claude.
 *
 * Every AI feature has a deterministic fallback, so the platform stays fully
 * usable without a key — the numbers come from the dataset either way, and only
 * the prose is generated. Check this before calling getClient().
 */
export function isAiEnabled(): boolean {
  // Either credential the SDK accepts is enough; it resolves them itself.
  return Boolean(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN);
}

/**
 * Where API requests go.
 *
 * Pinned explicitly rather than left to the SDK's default, because some hosts
 * (CI runners, agent sandboxes, corporate proxies) export ANTHROPIC_BASE_URL
 * for their own tooling. Inheriting that silently would send this app's
 * requests — and its API key — somewhere the operator never intended. Override
 * deliberately with SALTOR_ANTHROPIC_BASE_URL if you really do front the API
 * with a gateway.
 */
const BASE_URL = process.env.SALTOR_ANTHROPIC_BASE_URL ?? "https://api.anthropic.com";

export function getClient(): Anthropic {
  if (!isAiEnabled()) {
    throw new Error(
      "ANTHROPIC_API_KEY is not configured. Add it to .env.local and restart the dev server.",
    );
  }
  if (!cached) cached = new Anthropic({ baseURL: BASE_URL });
  return cached;
}

/** Exposed for the health check so the UI can report where it would call. */
export function baseUrl(): string {
  return BASE_URL;
}

/** Extracts the plain text of a response, ignoring thinking and tool blocks. */
export function textOf(message: Anthropic.Message): string {
  return message.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("\n")
    .trim();
}
