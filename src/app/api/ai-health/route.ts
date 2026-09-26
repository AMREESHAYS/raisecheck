import { NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { MODEL, baseUrl, getClient, isAiEnabled } from "@/lib/ai/client";

export const dynamic = "force-dynamic";

/**
 * Verifies that the configured API key actually works.
 *
 * Exists because a missing or wrong key otherwise shows up as the app quietly
 * serving template output — correct behaviour, but indistinguishable from "my
 * key isn't being picked up". This turns that into a clear answer. It makes one
 * deliberately tiny request; it is not free, so do not poll it.
 */
export async function GET() {
  if (!isAiEnabled()) {
    return NextResponse.json({
      ok: false,
      configured: false,
      model: MODEL,
      baseUrl: baseUrl(),
      message:
        "No ANTHROPIC_API_KEY found. Add it to .env.local and restart the server. The app still works — AI features fall back to template output.",
    });
  }

  try {
    const response = await getClient().messages.create({
      model: MODEL,
      max_tokens: 16,
      messages: [{ role: "user", content: "Reply with the single word: ready" }],
    });
    const text = response.content
      .filter((b): b is Anthropic.TextBlock => b.type === "text")
      .map((b) => b.text)
      .join("")
      .trim();

    return NextResponse.json({
      ok: true,
      configured: true,
      model: response.model,
      baseUrl: baseUrl(),
      reply: text,
      usage: {
        inputTokens: response.usage.input_tokens,
        outputTokens: response.usage.output_tokens,
      },
      message: "Key works. The chatbot and negotiation drafts will now be AI-generated.",
    });
  } catch (err) {
    const detail =
      err instanceof Anthropic.AuthenticationError
        ? "The key was rejected. Check for a typo, a trailing space, or a revoked key."
        : err instanceof Anthropic.PermissionDeniedError
          ? "The key is valid but not permitted to use this model."
          : err instanceof Anthropic.RateLimitError
            ? "Rate limited — the key works, but you are over your limit right now."
            : err instanceof Anthropic.APIConnectionError
              ? `Could not reach ${baseUrl()}. Check network access, or an ANTHROPIC_BASE_URL override.`
              : err instanceof Anthropic.APIError
                ? `API error ${err.status}: ${err.message}`
                : String(err);

    return NextResponse.json(
      { ok: false, configured: true, model: MODEL, baseUrl: baseUrl(), message: detail },
      { status: 502 },
    );
  }
}
