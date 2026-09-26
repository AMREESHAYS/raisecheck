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

export function getClient(): Anthropic {
  if (!isAiEnabled()) {
    throw new Error("ANTHROPIC_API_KEY is not configured");
  }
  if (!cached) cached = new Anthropic();
  return cached;
}

/** Extracts the plain text of a response, ignoring thinking and tool blocks. */
export function textOf(message: Anthropic.Message): string {
  return message.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("\n")
    .trim();
}
