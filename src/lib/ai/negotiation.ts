import { MODEL, getClient, isAiEnabled, textOf } from "./client";
import { summariseAssessment } from "./tools";
import type { assess } from "../advice";
import { formatInr } from "../format";
import { cityBySlug, roleBySlug } from "../data/taxonomy";

export type NegotiationFormat = "email" | "script" | "message";
export type NegotiationTone = "collaborative" | "direct" | "formal";

export type NegotiationRequest = {
  assessment: ReturnType<typeof assess>;
  roleSlug: string;
  citySlug: string;
  format: NegotiationFormat;
  tone: NegotiationTone;
  /** Free text from the user: what they shipped, what changed in their scope. */
  achievements?: string;
  /** Who it is addressed to, e.g. "Priya" or "my manager". No surname needed. */
  recipient?: string;
  /** Whether the user is willing to say they are interviewing elsewhere. */
  mentionOutsideInterest?: boolean;
};

export type NegotiationDraft = {
  subject: string | null;
  body: string;
  aiGenerated: boolean;
  /** The figures the draft is allowed to use, echoed for the UI. */
  figures: { currentPay: string; askFor: string; marketMidpoint: string; percentile: number };
};

const SYSTEM_PROMPT = `You write salary negotiation messages for people working in India.

You will be given a factual assessment of someone's pay: their current total compensation, the market range for their role and city, their percentile, the gap, and a specific figure to ask for. Write the message they will actually send.

RULES ABOUT FACTS
- Use only the figures in the assessment. Never invent a number, a competitor's offer, a company name, or a statistic.
- Use the recommended ask figure as the number they request. Do not soften it into a range unless the assessment gives a range for it.
- If the assessment says the data is low-confidence or rests on reference ranges, do not present the market figure as an established fact — write it as "market data I've looked at puts the range at…" rather than "the market rate is exactly…".

HOW TO WRITE IT
- Lead with the contribution, not the request. One or two sentences of specific value delivered, then the ask.
- State the number plainly, once. No apologising, no "I was wondering if maybe", no gratitude padding at both ends.
- Anchor on market data and scope, never on personal expenses or on what a colleague earns.
- Keep it short: an email is 150-200 words. A spoken script is a short opening plus what to say if the answer is "there's no budget".
- Write in the register of Indian professional English — plain, courteous, not American-breezy and not colonial-formal.
- Never threaten to quit. If outside interest is allowed, mention it once, as a fact, without leverage language.

OUTPUT FORMAT
- For an email: the first line must be exactly "Subject: <subject line>", then a blank line, then the body.
- For a script or a chat message: no subject line, just the text.
- No preamble, no explanation of your choices, no markdown headings. Output only the message.`;

/**
 * Drafts a negotiation message grounded in the user's own assessment.
 *
 * Without an API key this returns a template filled with the same figures —
 * less fluent, equally accurate.
 */
export async function draftNegotiation(req: NegotiationRequest): Promise<NegotiationDraft> {
  const a = req.assessment;
  const figures = {
    currentPay: formatInr(a.currentTotalInr),
    askFor: formatInr(a.internalAskInr),
    marketMidpoint: formatInr(a.fairRange.point),
    percentile: a.marketPercentile,
  };

  if (!isAiEnabled()) {
    return { ...templateDraft(req), aiGenerated: false, figures };
  }

  const role = roleBySlug(req.roleSlug)?.label ?? req.roleSlug;
  const city = cityBySlug(req.citySlug)?.label ?? req.citySlug;

  const brief = [
    `Format: ${req.format}`,
    `Tone: ${req.tone}`,
    `Role: ${role} in ${city}`,
    req.recipient ? `Addressed to: ${req.recipient}` : "Addressed to: their manager (no name given)",
    req.mentionOutsideInterest
      ? "They are comfortable mentioning that they are interviewing elsewhere."
      : "They do NOT want to mention other interviews or outside offers.",
    req.achievements?.trim()
      ? `In their own words, what they have delivered:\n"""\n${req.achievements.trim().slice(0, 2000)}\n"""`
      : "They did not list specific achievements. Leave a clearly marked placeholder like [one or two specific things you delivered this year] rather than inventing any.",
    "",
    "Assessment (the only figures you may use):",
    JSON.stringify(summariseAssessment(a), null, 2),
  ].join("\n");

  try {
    const response = await getClient().messages.create({
      model: MODEL,
      max_tokens: 16000,
      thinking: { type: "adaptive" },
      system: [{ type: "text", text: SYSTEM_PROMPT, cache_control: { type: "ephemeral" } }],
      messages: [{ role: "user", content: brief }],
    });

    if (response.stop_reason === "refusal") {
      return { ...templateDraft(req), aiGenerated: false, figures };
    }

    const text = textOf(response);
    if (!text) return { ...templateDraft(req), aiGenerated: false, figures };

    return { ...splitSubject(text, req.format), aiGenerated: true, figures };
  } catch {
    // A generation failure should not cost the user their draft.
    return { ...templateDraft(req), aiGenerated: false, figures };
  }
}

function splitSubject(text: string, format: NegotiationFormat): { subject: string | null; body: string } {
  if (format !== "email") return { subject: null, body: text };
  const match = text.match(/^\s*Subject:\s*(.+?)\r?\n/);
  if (!match) return { subject: null, body: text };
  return { subject: match[1].trim(), body: text.slice(match[0].length).trimStart() };
}

/**
 * The no-key draft. Deliberately plain: it is meant to be edited, and it never
 * claims anything the assessment does not support.
 */
function templateDraft(req: NegotiationRequest): { subject: string | null; body: string } {
  const a = req.assessment;
  const role = roleBySlug(req.roleSlug)?.label ?? req.roleSlug;
  const city = cityBySlug(req.citySlug)?.label ?? req.citySlug;
  const who = req.recipient?.trim() || "there";
  const achievements =
    req.achievements?.trim() || "[one or two specific things you delivered this year]";

  const hedge = a.fairRange.benchmark.mostlySeedData || a.fairRange.benchmark.confidence === "low";
  const marketLine = hedge
    ? `Market data I've looked at for a ${role} in ${city} at my experience level puts the range at roughly ${formatInr(a.fairRange.low)} to ${formatInr(a.fairRange.high)} in total annual compensation.`
    : `For a ${role} in ${city} at my experience level, the market range is ${formatInr(a.fairRange.low)} to ${formatInr(a.fairRange.high)} in total annual compensation, with a midpoint around ${formatInr(a.fairRange.point)}.`;

  const inflationLine = a.realRaise?.losingGround
    ? ` My last revision of ${a.realRaise.nominalRaisePct}% also fell short of the ${a.realRaise.inflationPct}% inflation over that period, so my pay has effectively gone backwards in real terms.`
    : "";

  const outsideLine = req.mentionOutsideInterest
    ? " I should mention that I have begun speaking with a couple of other companies, though my preference is to keep building here."
    : "";

  if (req.format === "script") {
    return {
      subject: null,
      body: [
        `OPENING (say this first)`,
        `"I'd like to talk about my compensation. Over the past year I've ${achievements}. ${marketLine} I'm currently at ${formatInr(a.currentTotalInr)}, which puts me at about the ${a.marketPercentile}th percentile. I'd like to move to ${formatInr(a.internalAskInr)}."`,
        ``,
        `IF THEY SAY THERE'S NO BUDGET`,
        `"I understand budgets are set. Can we agree on the number now and a date it takes effect — and what specifically you'd need to see from me for it to happen?"`,
        ``,
        `IF THEY ASK WHERE YOUR NUMBER COMES FROM`,
        `"Aggregated salary reports for this role, city and experience level.${inflationLine ? " I've also compared my last revision against inflation over the same period." : ""}"`,
        ``,
        `IF THEY OFFER LESS`,
        `"That's movement, thank you. Can we schedule a review in six months to close the remaining gap?"`,
        ``,
        `DON'T: threaten to leave, name a colleague's salary, or justify the number with personal expenses.`,
      ].join("\n"),
    };
  }

  if (req.format === "message") {
    return {
      subject: null,
      body: `Hi ${who} — could we find 20 minutes this week to talk about my compensation? Short version: I've ${achievements}, and ${marketLine.charAt(0).toLowerCase() + marketLine.slice(1)} I'm at ${formatInr(a.currentTotalInr)} today and would like to discuss moving to ${formatInr(a.internalAskInr)}. Happy to share what I'm basing that on.`,
    };
  }

  return {
    subject: `Compensation review — ${formatInr(a.internalAskInr)}`,
    body: [
      `Hi ${who},`,
      ``,
      `I'd like to raise my compensation for this year, and I want to give you the reasoning up front rather than take it into a meeting cold.`,
      ``,
      `Over the past year I've ${achievements}.`,
      ``,
      `${marketLine} I'm currently at ${formatInr(a.currentTotalInr)}, which places me at around the ${a.marketPercentile}th percentile for this profile.${inflationLine}`,
      ``,
      `On that basis I'd like to move to ${formatInr(a.internalAskInr)}.${outsideLine}`,
      ``,
      `I'm happy to walk through the data, and to talk about what you'd need to see from me if the full number isn't possible in this cycle.`,
      ``,
      `Thanks,`,
      `[your name]`,
    ].join("\n"),
  };
}
