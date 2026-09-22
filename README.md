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

## Performance Analytics module

A separate, purely in-session monthly reporting tab — no database involved at all.
CRM uploads one `.xlsx`, it's parsed entirely in the browser and held in React state; every card,
chart, table and AI analysis on the page is built from that. **Nothing is saved anywhere.**
Refreshing the page clears it — re-upload the file and the view rebuilds. This is a deliberate
choice: the report is a monthly snapshot the CRM team already has on file, not something this app
needs to be the source of truth for. Visible to **CRM** (uploads) and **EXECUTIVE** (read-only,
but only within a browser tab where CRM has already uploaded that session — there is no
cross-user sharing without a backend, see the note below).

### Setup

The only setup this module needs is the Gemini key for the AI Analysis cards:

1. Get a Gemini API key from [Google AI Studio](https://aistudio.google.com/apikey).
2. Add to Vercel's project environment variables (**not** committed to git):
   - `GEMINI_API_KEY` — server-only, never prefixed with `NEXT_PUBLIC_`
   - `GEMINI_MODEL` — optional, defaults to `gemini-3.6-flash`
3. Redeploy. The key is read only inside `app/api/performance-analysis/route.ts`, a Next.js Route
   Handler that runs as a Vercel serverless function — it never reaches the browser bundle.

No SQL migration, no Supabase table, nothing else to configure.

### The expected upload format

One workbook, containing these sheets (matched by name, case-insensitive; a missing sheet
produces an inline warning naming exactly which one, rather than breaking the page):

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
| `top 10 performing PN` | PN name, + metrics (no Month column — always current month) |

`CVR` is a decimal (`0.0157`, not `"1.57%"`) — only formatted as a percentage at render time.
`Revenue_INR`/`AOV_INR`/`RPV_INR` are raw numbers — compact ₹ Cr/L/K formatting is applied only
for display.

### Why the revenue trend chart still works with no persistence

`Monthly_KPI` is specified to carry rolling trailing months (e.g. the last 12) in every single
upload — so the multi-month trend chart is built entirely from that one sheet in the one file you
just uploaded. No history needs to accumulate anywhere for that to work.

### What genuinely changes without a backend (read this before relying on it operationally)

- **Nothing is shared between users or tabs.** If CRM uploads the report in their browser, an
  Executive logging in from a different browser or machine will see "No performance data loaded" —
  the data lives only in the tab that parsed it. If you need Executive to see the same report,
  either have them open the app in the same browser profile after CRM uploads, or re-upload the
  same file from their own login.
- **Trailing-3-month history for the per-table AI Analysis cards will typically be empty.** The
  dimension sheets (Category_Performance, Segment_Performance, etc.) are specified to contain only
  the current month's rows per upload — without a database accumulating them upload over upload,
  there's no prior month to compare against inside a single session. The AI prompt is told this
  explicitly ("empty array = no history yet") rather than fabricating a trend, per the brief's own
  grounding rules. If trailing-month context matters to you, the fix is either to re-introduce
  persistence for just this data, or to have each monthly upload include the last few months of
  dimension data directly (a larger sheet than the current spec, but zero backend required).
- **AI analysis results are cached only for the current tab's session** (a plain in-memory
  JavaScript object) — switching tables and back won't re-call Gemini, but a page refresh calls it
  fresh again on next view. "Regenerate analysis" always forces a fresh call regardless.
- **"Last month's recommendation" carry-over inside each AI card doesn't persist across sessions**
  for the same reason — every session starts clean.

If any of the above becomes a real problem later, the fix is narrow: reintroduce just a `perf_*`
table set behind the existing Supabase project (the module was originally built that way and can
be restored), without touching anything else in the app.

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
   - `GEMINI_MODEL` — optional, defaults to `gemini-3.6-flash`
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
spec for it (sheet name + exact columns) and it can be added the same way as the other seven.## Seeing data already in the dashboard? Reset it.

If every role logs in and already sees campaigns instead of a genuinely empty state, that's
`03_seed.sql` — it's designed for local testing only, but once it's been run against your real
Supabase project, that data stays there until explicitly cleared (the app can't tell a seeded
campaign apart from a real one; that's by design, since they're the same shape).

**Run `supabase/RESET_ALL_DATA.sql`** in the Supabase SQL Editor to clear every campaign and
everything that hangs off one (activity logs, notifications, change requests, QC checklists,
content submissions, CRM decisions) — nothing else touches your schema, your accounts, or your
master reference data (segments, categories, brands, offers). Reload the app afterward; every
dashboard, every queue, and the workflow flowchart at the top will read exactly zero until CRM
uploads a real input file. Safe to re-run any time you want a clean slate again.

## Production hardening audit (this pass)

A full audit against "no page invents its own state, one authoritative workflow, zero dummy
data" turned up and fixed several real bugs — not just the ones explicitly reported:

**The Excel date/time bug** was a classic Excel-serial timezone conversion issue: SheetJS's
`cellDates: true` constructs date objects using the machine's local clock at read time, so any
code that then called `.toISOString()` or read the object's getters silently shifted the value —
reproduced exactly under `TZ=Asia/Kolkata` (`01-Jul` became `2026-06-30`). Fixed in
`lib/excelDates.ts` by decoding the raw numeric Excel serial directly via `XLSX.SSF.parse_date_code()`,
never touching a `Date` object at all. Applied to both the CRM input upload and the Performance
module's month parsing, which had the identical latent bug.

**`/calendar` was still rendering a completely disconnected legacy system** —
`SlotBoard.tsx`/`TargetingBlock.tsx`/`services/calendar.ts`, the old 7-slot-per-day model against
`calendar_days`/`calendar_slots` tables — while every other page had long since moved to the real
`campaigns` table. Rebuilt `/calendar` to read the same `calendar_status = 'UPDATED'` filter Final
View uses, then deleted the three orphaned files.

**Final QC had silently regressed to a no-op.** The 10-item checklist UI existed in the codebase
but was never actually rendered in the campaign drawer — "Mark Ready to Publish" set
`qc_status = 'PASSED'` unconditionally on click. Restored the real checklist and added the
explicit **Update Calendar** gate: a new `calendar_status` column plus an `update_calendar()`
Postgres function that re-validates `qc_status = 'PASSED'` server-side before allowing the
finalize — so this can never be bypassed by a client that skipped the checklist. Final View and
the Calendar page both filter on this one column exclusively.

**Schema/frontend field-name mismatch.** The UI was writing to `smit_feedback`/`nazia_feedback`,
columns that don't exist — the real migration created `feedback_1`/`feedback_2`. Every field the
drawer and export touch is now properly typed on `Campaign` (see `types/campaign.ts`), and every
`as any` cast that had been masking this class of bug is gone from `CampaignDrawer.tsx` and
`exportExcel.ts`.

**Three competing recommendation implementations existed simultaneously** — a rules engine
(`data/mockRecommendations.ts` / `services/recommendations.ts`, never actually rendered), a
CRM-only dummy-tips panel, and a third hardcoded static string inside the drawer. Deleted the
first and third; kept the CRM-only dummy-tips panel as the one implementation, now gated to
appear specifically once Category has submitted (`category_status = 'LOCKED'`) rather than
unconditionally.

**CRM Review was implicit, not a real gate.** Approving a Category submission and starting Part 2
(Title Brief, PN Template, etc.) used to be the same action. Added an explicit Approve /
Request Changes step: Part 2 fields stay locked until CRM approves, and Request Changes reopens
the submission for Category with a reason, logged.

**Bulk "Send to Content & Design" sent everything ready, with no selection.** Added real
multi-select checkboxes plus a Select All toggle in CRM Own Campaigns — CRM chooses which
campaigns to route, not an implicit "send all."

**Locked Category edits could silently overwrite the submitted value with no audit trail.**
Category's "Completed" view now shows locked fields read-only with an Edit action that routes
through the existing `change_requests` table (original value → requested value → reason → who →
when), reviewed on the Changes page — the original submission is never lost.

**`workflow_status` (added in an earlier migration) was write-once and never kept in sync** with
the five real status columns the UI actually uses — exactly the "two status models that can
silently disagree" risk. Added a trigger (`09_calendar_and_sync.sql`) that keeps it an
always-accurate mirror on every write, even though nothing currently reads it.

**The progress bar used arbitrary percentage thresholds** ("published > 30% of total → stage 6")
instead of literal per-stage counts. Rebuilt as a real funnel: the exact number of campaigns
sitting in each of the 8 stages right now, with zero dependence on the current date or days
elapsed — an empty database shows every stage at exactly zero.

**A real, demonstrable submission-blocking bug**: the Add Campaign modal's Segment/Category
dropdowns already correctly drew from `masterData.json` (77 segments), but submission was
blocked if the pair wasn't also present in a smaller, separately-maintained `approved_pairs` SQL
table (~50 pairs from one source document). A valid, real selection could be rejected. The pair
check is now informational only — shown as a hint, never blocking.

### Known open item: two segment/category sources still exist

`masterData.json` (used by every dropdown in the app) and the `pncc_segments`/`pncc_categories`/
`approved_pairs` SQL tables (used only for the now-non-blocking hint in Add Campaign, and the
read-only Audiences page) are not reconciled — they came from different source documents at
different points in this project. `masterData.json` is the de facto authoritative one since it's
what every real input path uses. Fully reconciling the SQL tables against it — or retiring them —
is worth doing but wasn't safe to do blind (no complete, verified pairs list was available to
substitute in without risking a different kind of silent data error).

---

## Production workflow — no seed/demo data required

As of this version, the app assumes real CRM input files from the start. `03_seed.sql` still
exists in the repo but is **local-testing only** — do not run it against a production database.
There is no "Populate Month Campaigns" auto-generation button anymore; that was a random shuffle
generator meant for demos, and it's been removed along with `services/populate.ts` and the old
in-app slot-editing sheet.

The real flow, end to end:

1. **CRM uploads the initial input file** (`Upload CRM Input` on the CRM dashboard) — a workbook
   with Day, Time, Slot, Segment, Category columns. Header names are matched by meaning (see the
   Performance module's parsing notes below) — exact wording doesn't matter, and the real header
   row is found automatically even if there's a title row above it.
2. **CRM separately uploads a CRM Self PNs file** (`Upload CRM Self PNs`, same column shape) for
   campaigns CRM owns end-to-end — these skip the Category step entirely (`category_status` is
   set to `LOCKED` on arrival) and go straight into CRM's own completion queue.
3. The first upload is what Category sees under **Incoming Data** on their dashboard. Category
   fills Sub Category, Brand, Offer, Brief, Landing, CVR, RPV, then bulk-submits back to CRM.
4. Category can also raise an **Emergency push** at any time — time is a required field for this
   (not optional), since CRM accepts it directly into that slot. CRM reviews the Emergency queue
   and either **Accepts** (moves it into the normal review pipeline at the time Category gave) or
   **Rejects with a reason** (visible back to Category, campaign is marked Blocked).
5. Once CRM has reviewed Category's submissions and completed its own Part 2 fields (Title Brief,
   Message Brief, PN Template, Creative Requirements) on the **CRM Own Campaigns** panel, CRM
   clicks **Send to Content & Design** — a single bulk action that routes the batch to both teams
   at once.
6. **Content** and **Design** each see their own queue (Content via Incoming Data on their
   dashboard, Design via the dedicated **Design Queue** nav item) and each has a bulk
   "submit back to CRM" action once their part is done.
7. CRM's **Final View** (new nav item, CRM-only) shows everything that has cleared Category, CRM,
   Content and Design, with a **Download final sheet** button — the single consolidated export.

Every bulk transition writes to `activity_logs` automatically (`CRM_INPUT_UPLOAD`,
`CATEGORY_BULK_SUBMIT`, `EMERGENCY_ACCEPTED`/`EMERGENCY_REJECTED`, `SENT_TO_CONTENT_AND_DESIGN`,
`CONTENT_BULK_SUBMIT`, `DESIGN_BULK_SUBMIT`), and the calendar reflects every status change live
since it reads the same campaign records — there's no separate sync step.


