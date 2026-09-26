import type Anthropic from "@anthropic-ai/sdk";
import { MODEL, getClient, isAiEnabled, textOf } from "./client";
import { CHAT_TOOLS, runTool, summariseAssessment, type ToolContext } from "./tools";
import { assess, type AdviceRow } from "../advice";
import { formatInr } from "../format";
import { cityBySlug, roleBySlug } from "../data/taxonomy";

const SYSTEM_PROMPT = `You are Saltor, a salary fairness assistant for people working in India.

Your job is to tell someone the truth about their pay, using data, in plain language they can act on.

HARD RULES ABOUT NUMBERS
- You have no salary knowledge of your own. Every rupee figure you state must come from a tool result in this conversation.
- Never estimate, interpolate, or recall a salary from memory. If the tools return no data, say so plainly: "I don't have enough reports for that yet."
- When a tool tells you a figure rests mostly on seeded reference data, or that confidence is low, say that in your answer. Do not present a wide guess as a precise fact.
- Quote Indian amounts the way Indians write them: lakh and crore (for example "18.5 lakh", "1.2 crore"), and always say whether you mean annual total compensation.

HOW TO ANSWER
- Lead with the answer. If someone asks "am I underpaid", the first sentence says yes, no, or "roughly at market", with the number.
- Then give the two or three facts that support it: their percentile, the gap in rupees, whether their last raise beat inflation.
- End with the single most useful next step — ask for a raise, start interviewing, or nothing.
- Be direct and warm. No corporate hedging, no motivational filler. Short paragraphs, no headings unless the answer is genuinely long.
- Never tell someone they are underpaid to make them feel validated. If they are paid well, say so.

WHAT YOU ARE NOT
- You are not a lawyer, and you do not give legal or tax advice.
- You do not know anything about a specific named employer's pay unless a tool returned it.
- You never ask for or repeat anything that could identify the user.`;

export type ChatTurn = { role: "user" | "assistant"; content: string };

export type ChatProfile = {
  roleSlug: string;
  citySlug: string;
  yearsExperience: number;
  companyType?: string;
  currentTotalInr?: number;
  lastRaisePct?: number | null;
  monthsSinceRaise?: number | null;
};

export type ChatResult = {
  reply: string;
  /** Tool calls made, so the UI can show what the answer was grounded in. */
  toolCalls: { name: string; input: unknown }[];
  aiGenerated: boolean;
};

/** Stops a runaway loop; the tools here need at most three or four rounds. */
const MAX_ROUNDS = 6;

/**
 * Answers a question using the dataset.
 *
 * Uses a manual tool-use loop rather than the SDK's beta tool runner so the
 * route can report exactly which tools were called (the UI shows this) and so
 * the feature does not depend on a beta helper.
 */
export async function answerQuestion(
  history: ChatTurn[],
  profile: ChatProfile | null,
  ctx: ToolContext,
): Promise<ChatResult> {
  if (!isAiEnabled()) {
    return {
      reply: await fallbackAnswer(history, profile, ctx),
      toolCalls: [],
      aiGenerated: false,
    };
  }

  const client = getClient();
  const toolCalls: { name: string; input: unknown }[] = [];

  const messages: Anthropic.MessageParam[] = [];
  if (profile) {
    // Given as context, not as an answer: the model still has to call tools to
    // turn these facts into figures.
    messages.push({
      role: "user",
      content: `Context about me, already on file (use it instead of asking again):\n${JSON.stringify(
        profileForModel(profile),
        null,
        2,
      )}`,
    });
    messages.push({ role: "assistant", content: "Understood — I'll use that." });
  }
  for (const turn of history) {
    messages.push({ role: turn.role, content: turn.content });
  }

  for (let round = 0; round < MAX_ROUNDS; round++) {
    const response = await client.messages.create({
      model: MODEL,
      max_tokens: 16000,
      thinking: { type: "adaptive" },
      system: [{ type: "text", text: SYSTEM_PROMPT, cache_control: { type: "ephemeral" } }],
      tools: CHAT_TOOLS,
      messages,
    });

    if (response.stop_reason === "refusal") {
      return {
        reply:
          "I can't answer that one. If it was about your own pay, try asking it as a salary question — for example, \"am I underpaid?\"",
        toolCalls,
        aiGenerated: true,
      };
    }

    const toolUses = response.content.filter(
      (b): b is Anthropic.ToolUseBlock => b.type === "tool_use",
    );

    if (toolUses.length === 0) {
      return { reply: textOf(response), toolCalls, aiGenerated: true };
    }

    messages.push({ role: "assistant", content: response.content });

    // Run the round's tool calls together, and return every result in one
    // user message — splitting them teaches the model to stop parallelising.
    const results = await Promise.all(
      toolUses.map(async (call) => {
        toolCalls.push({ name: call.name, input: call.input });
        const outcome = await runTool(call.name, call.input, ctx);
        return {
          type: "tool_result" as const,
          tool_use_id: call.id,
          content: outcome.content,
          is_error: outcome.isError,
        };
      }),
    );
    messages.push({ role: "user", content: results });
  }

  return {
    reply:
      "I wasn't able to pin that down. Try asking about one specific thing — for example \"what should a backend engineer with 5 years in Pune earn?\"",
    toolCalls,
    aiGenerated: true,
  };
}

function profileForModel(p: ChatProfile) {
  return {
    role: p.roleSlug,
    city: p.citySlug,
    years_experience: p.yearsExperience,
    company_type: p.companyType,
    current_total_inr: p.currentTotalInr,
    last_raise_pct: p.lastRaisePct,
    months_since_raise: p.monthsSinceRaise,
  };
}

/**
 * The no-API-key path. Instead of refusing, it runs the same assessment the
 * model would have run and renders it from a template — the numbers are
 * identical, only the prose is canned.
 */
async function fallbackAnswer(
  history: ChatTurn[],
  profile: ChatProfile | null,
  ctx: ToolContext,
): Promise<string> {
  if (!profile || profile.currentTotalInr == null) {
    return [
      "AI replies are switched off on this deployment (no ANTHROPIC_API_KEY is set), so I can't hold a conversation right now.",
      "",
      "The data still works: fill in the salary form and you'll get your fair range, your percentile, the inflation comparison and a raise-or-switch recommendation — all computed from the dataset, no AI involved.",
    ].join("\n");
  }

  const rows = await ctx.loadRoleRows(profile.roleSlug);
  const a = assess(rows, {
    roleSlug: profile.roleSlug,
    citySlug: profile.citySlug,
    yearsExperience: profile.yearsExperience,
    companyType: profile.companyType,
    currentTotalInr: profile.currentTotalInr,
    lastRaisePct: profile.lastRaisePct ?? null,
    monthsSinceRaise: profile.monthsSinceRaise ?? null,
  });

  if (a.fairRange.benchmark.matchLevel === "none") {
    return "There aren't enough reports for your role yet to say anything useful. Once more people in your field submit, this will fill in.";
  }

  const role = roleBySlug(profile.roleSlug)?.label ?? profile.roleSlug;
  const city = cityBySlug(profile.citySlug)?.label ?? profile.citySlug;
  const headline =
    a.verdict === "underpaid"
      ? `Yes — you look underpaid by about ${formatInr(Math.abs(a.gapInr))} a year.`
      : a.verdict === "above-market"
        ? "No — you're paid above the market for your profile."
        : "You're roughly at market for your profile.";

  const lines = [
    headline,
    "",
    `A ${role} with ${profile.yearsExperience} years in ${city} sits in a fair range of ${formatInr(a.fairRange.low)} to ${formatInr(a.fairRange.high)} total annual pay, with a midpoint of ${formatInr(a.fairRange.point)}. You're at ${formatInr(a.currentTotalInr)} — the ${ordinal(a.marketPercentile)} percentile.`,
  ];

  if (a.realRaise) {
    lines.push(
      "",
      a.realRaise.losingGround
        ? `Your last raise of ${a.realRaise.nominalRaisePct}% trailed ${a.realRaise.inflationPct}% inflation over the same ${a.realRaise.months} months, so in real terms you took a ${Math.abs(a.realRaise.realRaisePct)}% pay cut.`
        : `Your last raise of ${a.realRaise.nominalRaisePct}% beat ${a.realRaise.inflationPct}% inflation — a real gain of ${a.realRaise.realRaisePct}%.`,
    );
  }

  lines.push("", ACTION_TEXT[a.action](a));
  if (a.caveats.length > 0) lines.push("", `One caveat: ${a.caveats[0]}`);
  lines.push("", "(This reply was generated from the data without AI, because no API key is configured.)");

  return lines.join("\n");
}

const ACTION_TEXT: Record<string, (a: ReturnType<typeof assess>) => string> = {
  hold: () => "Nothing to do on pay right now. Revisit this if you go 18 months without a raise.",
  negotiate: (a) =>
    `Ask for a raise. A defensible number to put on the table is ${formatInr(a.internalAskInr)}.`,
  "negotiate-then-switch": (a) =>
    `Ask for ${formatInr(a.internalAskInr)} first, and start interviewing in parallel — the gap is near the edge of what internal raises usually clear. A switch could realistically land ${formatInr(a.switchTargetInr)}.`,
  switch: (a) =>
    `The gap is larger than an internal raise usually clears. Start interviewing: a switch could realistically land around ${formatInr(a.switchTargetInr)}.`,
};

function ordinal(n: number): string {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return n + (s[(v - 20) % 10] ?? s[v] ?? s[0]);
}

export { summariseAssessment };
