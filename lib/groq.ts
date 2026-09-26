/**
 * Groq is OpenAI-compatible, so a plain fetch does the job — no SDK dependency.
 * Non-streaming: Groq's whole pitch is speed, and a 2s wait for a negotiation
 * email is fine. Switch to SSE (`stream: true`) if replies ever feel slow.
 */
const ENDPOINT = "https://api.groq.com/openai/v1/chat/completions";

/**
 * Read at call time, not module load. ESM hoists imports above everything, so a
 * module-level `process.env.X` is evaluated before a script's dotenv call runs —
 * and silently falls back to the default.
 */
export function groqModel() {
  return process.env.GROQ_MODEL ?? "openai/gpt-oss-120b";
}

export type ChatMessage = { role: "system" | "user" | "assistant"; content: string };

export async function groqChat(messages: ChatMessage[], signal?: AbortSignal) {
  const key = process.env.GROQ_API_KEY;
  if (!key) throw new Error("GROQ_API_KEY is not set");

  const res = await fetch(ENDPOINT, {
    method: "POST",
    headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
    body: JSON.stringify({
      model: groqModel(),
      messages,
      temperature: 0.3, // Money advice: consistency over flair.
      // gpt-oss models spend tokens on reasoning before they emit anything, and
      // that comes out of the same budget. At 900 the grounded prompt burned the
      // lot and returned an empty string. Low effort plus room to actually answer.
      reasoning_effort: "low",
      max_tokens: 3000,
    }),
    signal,
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`groq ${res.status}: ${detail.slice(0, 300)}`);
  }
  const json = (await res.json()) as {
    choices?: { finish_reason?: string; message?: { content?: string } }[];
  };
  const choice = json.choices?.[0];
  const reply = choice?.message?.content?.trim();
  if (!reply) {
    throw new Error(
      choice?.finish_reason === "length"
        ? "groq hit the token limit before answering — raise max_tokens"
        : `groq returned no content (finish_reason: ${choice?.finish_reason ?? "unknown"})`,
    );
  }
  return reply;
}
