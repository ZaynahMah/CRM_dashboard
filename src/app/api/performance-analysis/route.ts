import { NextRequest, NextResponse } from "next/server";
import { getSessionUserId, checkRateLimit } from "@/lib/apiGuard";

export const runtime = "nodejs";

/**
 * Server-only route — the Gemini API key never reaches the browser.
 * Set GEMINI_API_KEY (and optionally GEMINI_MODEL) in Vercel's project
 * environment variables; nothing here is NEXT_PUBLIC_.
 */
const GEMINI_MODEL = process.env.GEMINI_MODEL || "gemini-3.6-flash";

const GROUNDING_RULES = `
GROUNDING RULES — follow these exactly:
- Ban generic phrases: "personalization is key," "leverage data," "optimize strategy," "focus on engagement." Every claim must cite an exact number/rate from the data provided below.
- Ground reasoning in Indian e-commerce PN/CRM norms: fatigue risk from 6-10+ pushes/week, timing/batching over volume, personalization lift potential, interactive/rich-media constructs vs static discount pushes, and how players like Myntra, Ajio, Nykaa, Tira are known to operate — without fabricating exact competitor figures.
- If a pattern needs data not present below (e.g. delivery/CTR, true incrementality, real user-level overlap), state that explicitly instead of guessing.
- Never invent a number that isn't in the provided data.
`.trim();

function buildTablePrompt(body: TableRequestBody): string {
  return `
You are a senior CRM performance analyst reviewing one table from a monthly Tata CLiQ CRM report.
This is PROTOTYPE data analysis on a dummy dataset — be precise and grounded, but do not claim real-world certainty beyond what the numbers show.

TABLE: ${body.sheetTitle}
MONTH: ${body.month}

OUTLIERS (|z-score| >= 1.5 on Revenue, CVR, or RPV):
${JSON.stringify(body.outliers, null, 2)}

TOP 3 PERFORMERS BY REVENUE:
${JSON.stringify(body.topPerformers, null, 2)}

BOTTOM 3 PERFORMERS BY REVENUE:
${JSON.stringify(body.bottomPerformers, null, 2)}

CONFIDENCE TAGS (by order volume — Low <50, Medium 50-500, High >500):
${JSON.stringify(body.confidenceTags, null, 2)}

TRAILING 3-MONTH HISTORY PER ROW (oldest first; empty array = no history yet):
${JSON.stringify(body.trailingHistory, null, 2)}

USER-OVERLAP DATA AVAILABLE: false — this dataset has no user-level identifiers, so a real
shared-audience/fatigue-overlap number cannot be computed. Do not invent one; if relevant,
say overlap cannot be measured from this dataset.

${body.lastFocus ? `LAST MONTH'S RECOMMENDATION FOR THIS TABLE: "${body.lastFocus}"` : ""}

${GROUNDING_RULES}

Respond with ONLY this JSON shape, no markdown fences, no extra text:
{
  "pattern": "one specific, non-obvious pattern grounded in an exact number/rate/rank from the data above",
  "risk_or_loophole": "something a normal viewer would miss — e.g. revenue concentration, CVR decay despite volume growth, high-volume/low-RPV combos",
  "focus_next_month": "one concrete prioritized action, not generic advice",
  "estimated_impact": "quantified INR or % estimate behind the focus action, explicitly labeled as an estimate",
  "confidence": "High" | "Medium" | "Low",
  "last_month_check": "if a prior recommendation was given above, one line: 'Last month we flagged X - result: improved/unchanged/worsened'. Omit this key entirely if none was given."
}`.trim();
}

function buildTotalPrompt(body: TotalRequestBody): string {
  return `
You are the senior CRM analyst preparing the Executive AI Summary for this month's Tata CLiQ Executive Business Intelligence Dashboard.
This is PROTOTYPE data analysis on a dummy dataset.

MONTH: ${body.month}

TOP/BOTTOM PERFORMERS ACROSS EVERY TABLE THIS MONTH (Category, Segment, Remarketing Flow, Cohort, PN Type, Occasion, Tag):
${JSON.stringify(body.tableSummaries, null, 2)}

LAST MONTH'S FOCUS RECOMMENDATIONS AND WHETHER THEY WORKED (if available):
${JSON.stringify(body.lastMonthFocuses, null, 2)}

${GROUNDING_RULES}
Additionally:
- Every "best"/"weakest" claim must name the actual dimension value from the data above (e.g. an actual category name), with its exact number — never a placeholder.
- The 3 recommendations must be concrete and quantified, not generic advice.
- If a data source needed for one of the fields below is empty this month, say so plainly in that field rather than inventing a value.

Respond with ONLY this JSON shape, no markdown fences, no extra text:
{
  "headline": "one sentence summarizing the single biggest story in this month's CRM performance",
  "working": {
    "best_category": "name + exact revenue/CVR figure",
    "best_segment": "name + exact figure",
    "best_cohort": "name + exact figure",
    "best_remarketing_flow": "name + exact figure",
    "best_pn_type": "name + exact figure",
    "best_occasion": "name + exact figure"
  },
  "risks": {
    "weakest_category": "name + exact figure + why it's a risk",
    "weakest_audience": "name + exact figure",
    "weakest_campaign_type": "name + exact figure"
  },
  "opportunities": {
    "scale": "specific area to scale, with the number behind it",
    "optimize": "specific area to optimize, with the number behind it",
    "revenue_growth": "specific quantified revenue growth opportunity"
  },
  "recommendations": ["quantified executive recommendation 1", "recommendation 2", "recommendation 3"],
  "confidence": "High" | "Medium" | "Low"
}`.trim();
}

interface TableRequestBody {
  scope: "table";
  sheetTitle: string;
  month: string;
  outliers: unknown;
  topPerformers: unknown;
  bottomPerformers: unknown;
  confidenceTags: unknown;
  trailingHistory: unknown;
  lastFocus?: string;
}
interface TotalRequestBody {
  scope: "total";
  month: string;
  tableSummaries: unknown;
  lastMonthFocuses: unknown;
}

export async function POST(req: NextRequest) {
  /**
   * Auth first, before anything else — before reading the body, before
   * touching the key. An unauthenticated caller should learn nothing about
   * this route except that it refused them.
   */
  const userId = await getSessionUserId(req);
  if (!userId) {
    // One message for a missing header, a malformed one, a forged token and
    // an expired one alike. Telling a prober which of those it was is free
    // help.
    return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  }

  const limit = checkRateLimit(userId);
  if (!limit.allowed) {
    return NextResponse.json(
      { error: "Too many requests. Please wait a moment and try again." },
      { status: 429, headers: { "Retry-After": String(limit.retryAfterSeconds) } }
    );
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    // Logged for the operator; the caller gets nothing actionable. The old
    // message named Vercel and the variable, which tells a prober how the
    // service is deployed and what to look for.
    console.error("GEMINI_API_KEY is not set. Configure it in the deployment environment.");
    return NextResponse.json({ error: "Analysis is unavailable right now." }, { status: 503 });
  }

  let body: TableRequestBody | TotalRequestBody;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  const prompt = body.scope === "table" ? buildTablePrompt(body) : buildTotalPrompt(body);

  try {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${apiKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: { responseMimeType: "application/json", temperature: 0.4 },
        }),
      }
    );

    if (!res.ok) {
      // Upstream text can carry key state, quota details and project
      // identifiers. It belongs in the server log, not in the response.
      const errText = await res.text();
      console.error(`Gemini API error ${res.status}: ${errText.slice(0, 500)}`);
      return NextResponse.json({ error: "Analysis could not be generated." }, { status: 502 });
    }

    const data = await res.json();
    const text: string | undefined = data?.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!text) {
      return NextResponse.json({ error: "Gemini returned no content." }, { status: 502 });
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      return NextResponse.json({ error: "Gemini did not return valid JSON.", raw: text.slice(0, 500) }, { status: 502 });
    }

    return NextResponse.json({ analysis: parsed, model: GEMINI_MODEL });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Gemini request failed." }, { status: 500 });
  }
}
