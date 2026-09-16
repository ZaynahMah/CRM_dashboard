import { NextRequest, NextResponse } from "next/server";

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
You are the senior CRM analyst preparing the ONE panel leadership reads first for this month's Tata CLiQ CRM performance report.
This is PROTOTYPE data analysis on a dummy dataset.

MONTH: ${body.month}

PER-TABLE OUTLIERS AND TOP/BOTTOM PERFORMERS, ACROSS ALL TABLES THIS MONTH:
${JSON.stringify(body.tableSummaries, null, 2)}

LAST MONTH'S FOCUS RECOMMENDATIONS AND WHETHER THEY WORKED (if available):
${JSON.stringify(body.lastMonthFocuses, null, 2)}

USER-OVERLAP DATA AVAILABLE: false — no user-level identifiers exist in this dataset. Do not
invent a numeric overlap/fatigue figure; only comment on it qualitatively from category adjacency
if genuinely relevant, and say plainly if it cannot be measured.

${GROUNDING_RULES}
Additionally:
- This panel must never repeat what a per-table card already says verbatim — it must add NEW synthesis only possible by looking across tables.
- Correlate across at least two dimensions at once (e.g. Segment x PN Type, Category x Remarketing Flow, Cohort x Occasion) using the data above.
- If insufficient data exists for a strong cross-cutting claim, say so rather than forcing a connection.

Respond with ONLY this JSON shape, no markdown fences, no extra text:
{
  "headline": "one sentence summarizing the single biggest story in this month's CRM performance",
  "strongest_driver": "the best-performing intersection/dimension this month, with exact numbers",
  "biggest_risk": "the most concerning pattern this month - concentration risk, fatigue risk, or decay - with exact numbers",
  "cross_cutting_insight": "one insight only visible by combining 2+ tables",
  "top_3_priorities": ["ranked, quantified action 1", "action 2", "action 3"],
  "portfolio_fatigue_check": "flag if user overlap across segments/PN types creates over-messaging risk, or state it cannot be measured",
  "last_month_scorecard": "brief recap of what was recommended last month across tables and whether metrics improved, were unchanged, or worsened",
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
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { error: "GEMINI_API_KEY is not configured on the server. Set it in Vercel's project environment variables." },
      { status: 500 }
    );
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
      const errText = await res.text();
      return NextResponse.json({ error: `Gemini API error (${res.status}): ${errText.slice(0, 300)}` }, { status: 502 });
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
