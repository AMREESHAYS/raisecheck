import { NextResponse } from "next/server";
import { validate } from "@/lib/validate";
import { marketRate, MIN_SAMPLE } from "@/lib/stats";
import { externalBenchmarks, hashClient } from "@/lib/db";
import { expBucket } from "@/lib/vocab";
import { realChange, CPI_META } from "@/lib/inflation";
import { inrFull } from "@/lib/format";
import { groqChat, groqModel, type ChatMessage } from "@/lib/groq";
import { clientIp } from "@/lib/request";

export const maxDuration = 30;

const MAX_TURNS = 12;
const MAX_CHARS = 1200;

// ponytail: per-instance sliding window. Good enough to stop one tab burning the
// Groq budget; move to Supabase or Upstash when there is more than one instance.
const WINDOW_MS = 60_000;
const MAX_PER_WINDOW = 12;
const hits = new Map<string, number[]>();

function rateLimited(key: string) {
  const now = Date.now();
  const recent = (hits.get(key) ?? []).filter((t) => now - t < WINDOW_MS);
  recent.push(now);
  hits.set(key, recent);
  if (hits.size > 5000) hits.clear(); // Crude cap so the map can't grow forever.
  return recent.length > MAX_PER_WINDOW;
}

const SYSTEM = `You are the RaiseCheck negotiation coach. You help people in India work out whether they are underpaid and what to do about it.

GROUNDING RULES - these override everything else:
- Every number you state about market pay MUST come from the GROUNDING block in this conversation. Never use salary figures from your own training data.
- Whenever you give a market figure, state the sample size behind it in the same breath. "Rs 24 L at the median, from 34 submissions" - not "Rs 24 L".
- If the GROUNDING block does not contain what is needed to answer, say so plainly and say what you would need. Do not estimate, do not invent a range.
- Never state or imply what a specific named company pays. You have no company-level data. If asked about one, say you do not have company-level data and answer with the role/city benchmark instead.
- The percentiles describe submissions to this site, not the whole market. Do not present them as the definitive national rate.

TONE:
- Direct and concrete. The person is here because they suspect they are being underpaid and they are irritated. Match that with straight answers, not corporate cushioning.
- No "I hope this helps", no "it is important to note", no bullet-point walls. Short paragraphs.
- Indian context: CTC, LPA, notice period, appraisal cycles, switching vs internal raise. Use rupees with Indian digit grouping.
- Do not tell them to be grateful or to "consider the full package" unless they ask about benefits.

WHEN ASKED FOR A NEGOTIATION SCRIPT OR EMAIL, reply in exactly this shape:

EMAIL
Subject: <subject line>
<body, under 180 words, addressed to their manager, no placeholders except [Manager] and [Your name]>

TALKING POINTS
1. <one sentence they can say out loud>
2. <one sentence>
3. <one sentence>

Use their real numbers from GROUNDING. Anchor the ask at the P75 figure when they are below it, otherwise at P75 plus their own performance. Confident, specific, not aggressive or apologetic. No threats to quit unless they raised that themselves.

NEVER invent their accomplishments. You do not know what they shipped, led or fixed. Writing "I reduced API latency by 30%" into an email they might send as-is puts a false claim in front of their manager. Where the email needs their track record, write a bracketed placeholder they must fill in — [your biggest win this year], [the project you led] — and nothing more specific. The market numbers are the argument; their achievements are theirs to supply.

Money in GROUNDING is already formatted. Copy those strings exactly as given — do not reformat, round or recompute them.`;

export async function POST(req: Request) {
  let body: { profile?: Record<string, unknown>; messages?: { role: string; content: string }[] };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Bad request." }, { status: 400 });
  }

  if (!process.env.GROQ_API_KEY)
    return NextResponse.json(
      { error: "The coach isn't configured yet — GROQ_API_KEY is missing." },
      { status: 503 },
    );

  // The client sends back the same profile it submitted. We never trust numbers it
  // sends us about the market — percentiles are always re-derived here.
  const v = validate({
    ...body.profile,
    last_raise_pct: body.profile?.last_raise_pct ?? "",
    last_raise_date: body.profile?.last_raise_date ?? "",
  });
  if (!v.ok) return NextResponse.json({ error: v.error }, { status: 400 });
  const p = v.value;

  const history = (body.messages ?? [])
    .filter((m) => m.role === "user" || m.role === "assistant")
    .slice(-MAX_TURNS)
    .map((m) => ({
      role: m.role as "user" | "assistant",
      content: String(m.content).slice(0, MAX_CHARS),
    }));

  if (history.length === 0 || history[history.length - 1].role !== "user")
    return NextResponse.json({ error: "Nothing to answer." }, { status: 400 });

  try {
    if (rateLimited(hashClient(clientIp(req), "chat")))
      return NextResponse.json(
        { error: "Slow down a moment — too many messages. Try again in a minute." },
        { status: 429 },
      );

    const b = expBucket(p.years_experience);
    const market = await marketRate(p.role_category, p.city, p.years_experience, p.current_ctc_annual);
    const external = await externalBenchmarks({
      role_category: p.role_category,
      city: p.city,
      years: p.years_experience,
      segment: p.employer_segment,
    });
    const inflation =
      p.last_raise_pct != null && p.last_raise_date != null
        ? realChange(p.current_ctc_annual, p.last_raise_pct, new Date(p.last_raise_date))
        : null;

    const grounding = {
      person: {
        role: p.role_title,
        role_category: p.role_category,
        city: p.city,
        years_experience: p.years_experience,
        experience_bucket: b.label,
        employer_segment: p.employer_segment ?? "not given",
        current_ctc: inrFull(p.current_ctc_annual),
        last_raise_pct: p.last_raise_pct,
        last_raise_date: p.last_raise_date,
      },
      market:
        "insufficient" in market
          ? {
              available: false,
              reason: `Only ${market.n} verified submissions match; ${MIN_SAMPLE} are required before any figure is shown. You have NO market numbers for this person. Say so.`,
            }
          : {
              available: true,
              sample_size: market.n,
              // Pre-formatted, because models reliably mangle Indian digit
              // grouping — 35,38,719 came back as 3,53,87,19. Give it a string
              // to copy instead of arithmetic to get wrong.
              p25: inrFull(market.p25),
              median: inrFull(market.p50),
              p75: inrFull(market.p75),
              their_percentile_rank: market.rank_pct,
              describes: {
                role_category: market.basis.role_category,
                city: market.basis.city ?? "all India",
                experience: market.basis.experience,
              },
              caveat: market.note,
            },
      external_benchmarks: external.map((e) => ({
        source: e.source,
        employer_segment: e.segment,
        median: inrFull(e.p50),
        p25: e.p25 == null ? null : inrFull(e.p25),
        p75: e.p75 == null ? null : inrFull(e.p75),
        sample_size: e.sample_size,
        as_of: e.as_of,
        note: "Third-party figure. Attribute it to the source by name when you use it; never merge it with the submission percentiles into one number. Segments are not comparable to each other — an IT services median and a product-company median differ several-fold and both are correct.",
      })),
      inflation: inflation
        ? {
            their_last_raise_pct: inflation.raisePct,
            cpi_inflation_since_that_raise_pct: Number(inflation.inflationPct.toFixed(2)),
            real_change_pct: Number(inflation.realPct.toFixed(2)),
            real_rupee_change_per_year: inrFull(inflation.rupeeDelta),
            verdict: inflation.verdict,
            source: CPI_META.source,
            provisional: inflation.provisional,
          }
        : { available: false, reason: "They didn't give a last raise % and date." },
    };

    const messages: ChatMessage[] = [
      { role: "system", content: SYSTEM },
      {
        role: "system",
        content: `GROUNDING (the only numbers you may use):\n${JSON.stringify(grounding, null, 2)}`,
      },
      ...history,
    ];

    return NextResponse.json({ reply: await groqChat(messages), model: groqModel() });
  } catch (e) {
    console.error("chat failed", e);
    return NextResponse.json(
      { error: "The coach couldn't answer that right now. Try again." },
      { status: 502 },
    );
  }
}
