# Push Operations — Tata CLiQ Fashion & Luxury

An internal control centre for push notification planning, review and production.
Next.js 14 (App Router) + TypeScript + Tailwind, with Supabase as the source of truth.

The model is the point: **month → date → many slots → many campaigns → workflow → audit trail**.
One date is never one campaign.

---

## 1. Create the Supabase project

1. Go to [supabase.com](https://supabase.com) → **New project**. Pick a region close to your users (Mumbai for India).
2. Save the database password somewhere safe — you will not see it again.
3. Wait for provisioning (~2 minutes).

### Run the SQL, in order

Open **SQL Editor** → **New query**, paste each file, press **Run**:

| Order | File | What it does |
|---|---|---|
| 1 | `supabase/01_schema.sql` | Tables, enums, relationships, the `launch_date - 7` generated deadline column, slot-occupancy triggers |
| 2 | `supabase/02_rls.sql` | Row Level Security policies and the controlled workflow functions |
| 3 | `supabase/03_seed.sql` | Realistic demo data — run this **after** step 2 below |
| 4 | `supabase/04_crm_logic.sql` | The real CRM logic layer: MoEngage segment library, offer factors, push tags, channel mix |

### Create the four users

**Authentication → Users → Add user → Create new user.** Tick *Auto Confirm User* for each.

| Email | Password | Role |
|---|---|---|
| `category@internal.local` | `cat_9090` | CATEGORY |
| `crm@internal.local` | `crm_9090` | CRM |
| `content@internal.local` | `con_9090` | CONTENT |
| `executive@internal.local` | `exe_9090` | EXECUTIVE |

A trigger in `01_schema.sql` creates the matching `profiles` row automatically and derives the
role from the email prefix. The login screen still asks for `CATEGORY` / `CRM` / `CONTENT` /
`EXECUTIVE` — the mapping to email happens in `src/services/auth.ts`, and no password is ever
stored in your own tables.

Now run `supabase/03_seed.sql`, then `supabase/04_crm_logic.sql`. Together they build a live
60-day calendar with ~250 campaigns across every workflow stage, then attach real MoEngage
segments, push tags and channels to each one.

### Copy your keys

**Project Settings → API**:

- Project URL → `NEXT_PUBLIC_SUPABASE_URL`
- `anon` / publishable key → `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`

Never put the `service_role` key in this app. It bypasses RLS and would be visible in the browser.

---

## 2. Run it locally

```bash
npm install
cp .env.example .env.local     # then paste your two values in
npm run dev
```

Open http://localhost:3000 and sign in. The prototype accounts are listed on the login screen —
click one to fill the form.

---

## 3. Push to GitHub

```bash
git init
git add .
git commit -m "Push Operations dashboard"
git branch -M main
git remote add origin https://github.com/<you>/<repo>.git
git push -u origin main
```

`.env.local` is gitignored. Only `.env.example` is committed.

---

## 4. Deploy on Vercel

1. [vercel.com/new](https://vercel.com/new) → **Import** your repo.
2. Framework preset: **Next.js** (detected automatically). Leave build settings alone.
3. **Environment Variables** — add both, for Production, Preview and Development:
   - `NEXT_PUBLIC_SUPABASE_URL`
   - `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`
4. **Deploy.**

After the first deploy, go back to Supabase → **Authentication → URL Configuration** and add your
Vercel domain (and `https://your-app.vercel.app/**`) to **Redirect URLs**, then set **Site URL** to
the same domain.

Changing an environment variable in Vercel requires a redeploy to take effect — variables are
inlined at build time.

---

## 5. Walk the flows

Sign in as **CRM** first; without an open calendar there is nothing for Category to fill.

1. **CRM** → Calendar → *Open this month*. Seven slots appear on every date.
2. **CATEGORY** → Calendar → click an open slot → fill the form. Submit is disabled until every
   required field is complete, then the record locks.
3. **CRM** → Dashboard → open the campaign → accept or override the recommendation, which picks
   a real MoEngage segment with its base count → set the tag, template and tracking code →
   *Send to Content*.
4. **CONTENT** → Overview → open the campaign → write the header and sub copy against live
   character counts → *Submit to CRM*.
5. **CRM** → Final QC → tick every line → *Mark ready for production* → *Push to production*.
6. **EXECUTIVE** → Performance → read throughput, origin mix and the current bottleneck.
7. Any role → **Audiences** → browse the segment library, offer factors and push tag mapping.

Every one of those steps writes to Supabase and to the activity trail.

---

## Architecture

```
src/
├── app/
│   ├── login/               sign-in
│   └── (app)/               authenticated shell
│       ├── overview/        role-aware dashboard
│       ├── calendar/        the slot board
│       ├── campaigns/       search and filters
│       ├── planned/         CRM-raised campaigns
│       ├── qc/              final QC and ready-to-go
│       ├── changes/         change request review
│       ├── emergency/       emergency queue
│       ├── segments/        audience library, offer factors, push tags
│       └── performance/     executive health
├── components/              shell, board, drawer, form, targeting, recommendation, charts
├── lib/                     supabase client, deadlines, workflow rules, formatting
├── services/                auth, calendar, campaigns, content, notifications,
│                            recommendations, targeting
├── types/                   user, calendar, campaign, targeting
└── data/                    mockRecommendations (rules engine)
```

Business rules live in `src/lib/`, not in components. `deadlines.ts` owns the seven-day rule;
`workflow.ts` owns stage derivation, QC completeness and character limits.

### Where the rules are enforced

| Rule | Enforced by |
|---|---|
| Deadline = launch date − 7 days | `category_deadline` generated column (`01_schema.sql`) |
| Only CRM opens dates and slots | RLS policies `days_crm_write`, `slots_crm_write` |
| A slot holds one campaign | `unique` on `campaigns.calendar_slot_id` + `sync_slot_status` trigger |
| Incomplete campaigns cannot submit | `categoryCompleteness` in `workflow.ts`, gating the submit button |
| Submitted Category data is locked | RLS `campaigns_update` restricts Category to `EMPTY`/`DRAFT` |
| Changes go through a request | `apply_change_request()` with a column whitelist |
| Content cannot touch Category or CRM fields | Content has no UPDATE on `campaigns`; it calls `submit_content()` |
| Ready requires full QC | `qcComplete()` gates the button; checklist rows live in `qc_checklists` |
| Executive is read only | No write policy grants the EXECUTIVE role |

### The recommendation boundary

`services/recommendations.ts` is the only seam the future model needs.

```
Campaign + Segment library → getRecommendation() → Recommendation → <RecommendationPanel />
```

Today it returns a **rules-based** recommendation, not a random mock. Every rule comes from the
CRM logic workbook:

- **Audience** maps the campaign category to its predominance segment in the MoEngage library,
  and carries the real reachable base count.
- **Offer construct** follows the offer playbook — VIP and high-LTV targets get early access
  rather than discount, lapsed users get a win-back band, high-intent users get the smallest
  coupon that will convert.
- **Timing** prefers a behavioural window with a measurable base behind it, taken from the
  `Applaunch` segments (10pm–12am carries 671k users, 12am–2am 335k, 5am–8am 312k).
- **Confidence** rises with how much is actually known about the target, rather than being
  a decorative number.
- **Factors** shown in the panel are the five the workbook flags as priority: LTV, Recency,
  CVR, Margin % and Category/Brand Affinity.

When the trained model ships, replace the body of `getRecommendation` with a fetch to the
scoring endpoint. Every component and every stored `crm_decisions` row already has the right
shape — including the recommended-versus-selected split that records manual overrides as
training feedback.

---

## What came out of the workbooks

### Segment library (`Segments_Moe.xlsx`)

37 live MoEngage segments are seeded into a `segments` table with their real base counts,
catalogue codes and rule definitions — predominance segments (Women's Apparel 392,770; Westside
351,000; Men's Footwear 327,508), behavioural app-launch windows, lifecycle bases, location
splits, search cohorts and the email reachability segments.

Targeting is no longer a free-text field. CRM picks from this library, and the reachable base
travels with the campaign into `expected_reach`.

The three standard suppressions — notification clicked in the last 12 hours, Tata internal users,
and order placed in the last 7 days — are stored in `segment_exclusions` and shown on every
targeting panel, because they apply to every push segment without exception.

### Offer logic (`LOGIC SCENARIOS`)

The 15 decision factors and their offer implications are in `offer_factors`, with the five
priority factors flagged. The customer-segment-to-offer mapping is in `offer_playbook`. Both are
readable in the Audiences screen and both feed the recommendation engine.

### Push operations fields

`push_tags` holds the tag-to-group mapping (Beauty → 1111, MenF/WomF/KidsF → 2222,
KidsAp/MenA → 3333, WomAE/WomAW/Daali → 4444, everything else → 5555). Group ID is set by a
database trigger from the tag, so it can never drift from the mapping.

Collapse ID is a free field for now. The tag sheet groups by 1111–5555, but the live campaign
sheet uses 1122 / 2233 / 4455 — that discrepancy is one of the open questions in the workbook,
so the app does not guess a rule.

### Channel mix

`channels` carries the revenue contribution from the CRM team's own numbers: push above 70%,
WhatsApp around 22%, SMS 4%, email 1–3% and growing. The dashboard and Audiences screens both
read from this table rather than hard-coding percentages.

### Still open with the CRM team

These are recorded here rather than guessed at in code:

- What rule decides the Collapse ID value on a given row.
- What GL stands for, and whether it is Global Luxury.
- What `prp` means inside a tracking code.
- Who chooses `onetime` versus `earlyaccess`, and on what basis.
- Why the campaign sheet carries two slot columns.
- The finite PN template list — the app currently offers Basic, Bezel, Timer and Coloured BG.
- Official header and sub-copy limits per template type — currently 60 and 100 for all.
- Whether the MoEngage campaign ID should be pasted back against the slot after creation.

---

### Not built, by design

No production API, no real push delivery, no CleverTap or MoEngage integration, no ML model, no
customer data. Push to Production sets `production_status = 'PUSHED'` and stops there.

---

## Design notes

Built to the supplied dashboard reference: light canvas, white rounded cards with hairline borders
and a soft shadow, indigo primary, grouped sidebar with count badges, KPI cards with icon chips,
and pill statuses in the standard semantic colours.

Plus Jakarta Sans for headings and numbers, Inter for interface text, monospace only where the
value really is machine-generated — MoEngage segment names, group IDs and tracking codes.

The calendar keeps its slot-strip treatment inside a card: every date is a fixed column of seven
slots, so an open slot is exactly as visible as a booked one. That is the argument against the
spreadsheet, stated in the layout.

Charts are hand-rolled SVG — no charting dependency, so the bundle stays small and the styling
matches the rest of the system exactly.

---

## Troubleshooting

**"Signed in, but no profile is linked"** — you created the auth user before running
`01_schema.sql`, so the trigger did not fire. Delete the user and recreate it, or insert the
profile row by hand.

**Empty calendar** — sign in as CRM and use *Open this month*, or run `03_seed.sql`.

**Audiences screen is empty** — `04_crm_logic.sql` has not been run yet.

**Campaigns have no segment or channel** — the same. The final `update` in `04_crm_logic.sql`
attaches segments, tags and channels to the seeded campaigns.

**Category cannot save** — check the browser console for an RLS error. Category can only write
campaigns with origin `CATEGORY_REQUEST`, and only while the submission is unlocked.

**Fonts fail at build time** — the build fetches Google Fonts. It needs outbound network access,
which Vercel has.

---

## Performance Analytics module (new)

A separate, self-contained monthly reporting tab — independent of the campaign scheduling data.
CRM uploads one `.xlsx` per month; the entire Performance tab (KPI strip, trend chart, eight
per-table cards, the Top 10 PN leaderboard, and every AI Analysis card) rebuilds from that file.
Visible to **CRM** and **EXECUTIVE** only.

### Setup

1. Run `supabase/07_performance_analytics.sql` (after files 01–06).
2. Get a Gemini API key from [Google AI Studio](https://aistudio.google.com/apikey).
3. Add to Vercel's project environment variables (**not** `.env` committed to git):
   - `GEMINI_API_KEY` — server-only, never prefixed with `NEXT_PUBLIC_`
   - `GEMINI_MODEL` — optional, defaults to `gemini-2.0-flash`
4. Redeploy. The key is read only inside `app/api/performance-analysis/route.ts`, a Next.js Route
   Handler that runs as a Vercel serverless function — it never reaches the browser bundle.

### The expected upload format

One workbook per month, containing these sheets (matched by name, case-insensitive; missing
sheets produce an inline warning rather than breaking the page):

| Sheet | Key columns |
|---|---|
| `Monthly_KPI` | Month, Platform, Period_Status, Visits, Orders, Revenue_INR, CVR, AOV_INR, RPV_INR |
| `Category_Performance` | Month, Category, + the same 6 metrics |
| `Remarketing_Flow` | Month, Remarketing Flow, + metrics |
| `Segment_Performance` | Month, Segment, + metrics |
| `PN_Type_Performance` | Month, PN Type, + metrics |
| `Cohort_Performance` | Month, Cohort, + metrics |
| `Occasion_Performance` | Month, Occasion, + metrics |
| `Tag_Performance` | Month, Tag, + metrics |
| `top 10 performing PN` | PN name, + metrics (no Month column — always current month, fully replaced each upload) |

`CVR` is a decimal (`0.0157`, not `"1.57%"`) — only formatted as a percentage at render time.
`Revenue_INR`/`AOV_INR`/`RPV_INR` are raw numbers — compact ₹ Cr/L/K formatting is applied only
for display, the stored value is never altered.

Re-uploading a month refreshes that month's rows in place (upsert on month + dimension name);
older months already in the database are never deleted, which is what powers the trailing-3-month
trend context fed into each AI Analysis card.

### How the AI Analysis actually works

Nothing raw ever reaches Gemini. `lib/performanceAnalysis.ts` runs entirely in your own code first:
z-score outlier detection on Revenue/CVR/RPV, a confidence tag per row from order volume
(<50 Low, 50–500 Medium, >500 High), and the trailing-3-month history per dimension pulled from
previously uploaded months. Only that filtered, pre-reasoned payload is sent to Gemini via the
serverless route, which forces strict JSON output (`responseMimeType: "application/json"`) matching
a fixed schema — the UI never renders free-form paragraphs.

Each card's analysis is cached in `perf_ai_cache` per (table, month) — reloading the page doesn't
re-call Gemini. Click **Regenerate analysis** on any card, or the Total Performance Analysis panel,
to force a fresh call.

**Known, deliberate limitation:** the workbook has no user-level or overlap data, so the "flag
shared audience/fatigue risk across segments" input the brief describes cannot be genuinely
computed from this dataset. Rather than fabricate a number, every prompt explicitly tells Gemini
`overlap data available: false` and instructs it to say so rather than guess — per the brief's own
rule that a missing-data claim should be stated, not invented.

**Open item:** the brief's Part 1 spec names 9 tables to build AI cards for (including "Campaign"
and "Operations"), but the exact file-format spec only defines 8 sheets with no `Campaign_Performance`
or `Operations_Performance` sheet. "Campaign" is currently represented by the Top 10 Performing PN
leaderboard (the closest real data available); there is no "Operations" card yet — send a sheet
spec for it (sheet name + exact columns) and it can be added the same way as the other seven.
