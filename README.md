# Push Operations — Tata CLiQ Fashion & Luxury

An internal control centre for push notification planning, review and production.
Next.js 14 (App Router) + TypeScript + Tailwind, with Supabase as the source of truth.

The honest description: a shared spreadsheet with role-based permissions and a workflow,
that exports back to Excel. CRM uploads a sheet; each row becomes a campaign; teams fill
their own columns in sequence; the result exports as CSV.

> **Source of truth.** This README covers setup and orientation. For current architecture,
> known issues and working agreements, read `PROJECT_STATE.md` — it is the authoritative
> record and is updated every iteration. Where the two disagree, `PROJECT_STATE.md` wins.

---

## 1. Create the Supabase project

1. [supabase.com](https://supabase.com) → **New project**. Pick a region close to your users (Mumbai for India).
2. Save the database password somewhere safe — you will not see it again.
3. Wait for provisioning (~2 minutes).

### Run the SQL, in order

Open **SQL Editor** → **New query**, paste each file, press **Run**. Order matters.

| # | File | What it does |
|---|---|---|
| 01 | `supabase/01_schema.sql` | Tables, enums, relationships, the `launch_date - 7` generated deadline column, the auth→profile trigger |
| 02 | `supabase/02_rls.sql` | Row Level Security policies and the controlled workflow functions |
| 04 | `supabase/04_crm_logic.sql` | CRM logic layer: MoEngage segment library, offer factors, push tags, channel mix |
| 05 | `supabase/05_slot_restructure.sql` | PNCC segment/category tables, approved pairs, fixed time slots |
| 06 | `supabase/06_workflow_statuses.sql` | Workflow status columns and the wide Final Ops column set |
| 08 | `supabase/08_production_workflow.sql` | **The DESIGN role**, design/emergency status columns, Design's RLS policy, `is_crm_self` |
| 09 | `supabase/09_calendar_and_sync.sql` | `calendar_status`, the `update_calendar()` RPC, the `workflow_status` mirror |
| 10 | `supabase/10_slot_dedup.sql` | Slot de-duplication |
| 11 | `supabase/11_remove_slot_uniqueness.sql` | Removes the one-campaign-per-slot constraint |
| 12 | `supabase/12_fix_category_content_update_rls.sql` | **Required** — fixes the broken ownership check that stopped Category saving at all |
| 13 | `supabase/13_backfill_missing_profiles.sql` | Backfills profile rows for auth users created before their role existed |

**There is no `03_seed.sql` step and no `07`.** See the two notes below.

### Do not run `03_seed.sql` against a real project

`supabase/03_seed.sql` exists in the repo and is **local testing only**. It creates roughly 250
demo campaigns across a 60-day calendar. The app cannot tell a seeded campaign from a real one —
they are the same shape — so once it has run against your live project that data stays until you
clear it explicitly.

If you have already run it, or any role logs in and sees campaigns instead of an empty state,
run **`supabase/RESET_ALL_DATA.sql`**. It clears every campaign and everything hanging off one
(activity logs, notifications, change requests, QC checklists, content submissions, CRM
decisions) and touches nothing else — not your schema, accounts, or master reference data.
Safe to re-run whenever you want a clean slate.

### There is no `07`

Migration numbering skips 07. No `07_performance_analytics.sql` exists or is needed — the
Performance module holds no database state (see §7).

### Create the five users

**Authentication → Users → Add user → Create new user.** Tick *Auto Confirm User* for each.

| Email | Password | Role |
|---|---|---|
| `category@internal.local` | `cat_9090` | CATEGORY |
| `crm@internal.local` | `crm_9090` | CRM |
| `content@internal.local` | `con_9090` | CONTENT |
| `design@internal.local` | `des_9090` | DESIGN |
| `executive@internal.local` | `exe_9090` | EXECUTIVE |

`handle_new_auth_user()` creates the matching `profiles` row and derives the role from the email
prefix. It is an **INSERT trigger**, so it only runs for users created *after* it knew about
their role. DESIGN was added in migration 08 — if `design@internal.local` was created before 08
ran, it has no profile row and sign-in will fail with a message telling you exactly that.
Run `supabase/13_backfill_missing_profiles.sql` to repair it.

The login screen asks for the username (`CATEGORY`, `CRM`, `CONTENT`, `DESIGN`, `EXECUTIVE`);
the mapping to email lives in `src/services/auth.ts`. No password is ever stored in your tables.

### Copy your keys

**Project Settings → API**:

- Project URL → `NEXT_PUBLIC_SUPABASE_URL`
- `anon` / publishable key → `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`

Never put the `service_role` key in this app. It bypasses RLS and would be visible in the browser.

---

## 2. Run it locally

```bash
npm install
cp .env.example .env.local     # fill in the two NEXT_PUBLIC_ values
npm run dev
```

Open http://localhost:3000.

---

## 3. Deploy on Vercel

Import the repo, framework preset **Next.js**, then set four environment variables:

| Variable | Scope | Notes |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | client | |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | client | anon key only |
| `GEMINI_API_KEY` | **server only** | never prefix with `NEXT_PUBLIC_` |
| `GEMINI_MODEL` | server, optional | defaults to `gemini-3.6-flash` |

`NEXT_PUBLIC_*` values are inlined at build time, so changing one needs a redeploy, not just a
restart. In Supabase → **Authentication → URL Configuration**, add the Vercel domain to Site URL
and Redirect URLs.

The current deployment is the Vercel project `crm-dashboard` under the TATA CLiQ team, building
from `main` on push.

---

## 4. The workflow

```
CRM Input → Category → CRM → Content → CRM → Design → CRM → Final QC → Calendar
```

**Content and Design are sequential, not parallel.** There is a CRM checkpoint between them.

1. **CRM uploads the input file** (*Upload CRM Input*) — a workbook with Day, Time, Slot,
   Segment, Category. Headers are matched by meaning, not exact text, and the real header row is
   found even with a title row above it. Upload replaces the existing Category-sourced set, behind
   a confirmation showing the real counts.
2. **Category** fills Sub Category, Brand, Offer, Brief, Landing, Expected CVR, Expected RPV.
   Rows are worked across the week, locked individually or bulk-submitted per week.
3. **CRM** reviews, completes Part 2 (Title Brief, Message Brief, PN Template, Creative
   Requirements), then **Send to Content**.
4. **Content** writes header and sub copy against live character counts and submits. H/S counts
   are computed from the text — Content never types them.
5. **CRM** reviews the copy, then **Send to Design**.
6. **Design** pastes a Creative Link (optional) and sends the batch back.
7. **CRM** completes Part 3, ticks all ten Final QC lines, then **Update Calendar** — the one
   explicit finalization step. Nothing reaches Final View or the Calendar without it.
8. **Final View** → *Download final sheet* produces the consolidated 46-column export (CSV).

**CRM Self** is a separate upload with its own sheet shape (Time, Slot, Segments, Category, Sub
Category, Brand, Offer, Title Brief, Message Brief, PN Template, Creative Requirements, plus a
required Date). Those rows skip Category entirely and land directly with Content, then follow the
same sequence. The two uploads are independent: neither can delete the other's rows.

**Emergency pushes** can be raised by Category or CRM at any time; Time is mandatory. CRM accepts
into that exact slot or rejects with a reason. Emergencies appear in their own tab for CRM,
Content and Design.

Every bulk transition writes to `activity_logs`. The calendar reads the same campaign records,
so there is no separate sync step.

---

## 5. Architecture

```
src/
├── app/
│   ├── login/                   sign-in
│   ├── api/
│   │   └── performance-analysis/  the only server route (keeps GEMINI_API_KEY off the client)
│   └── (app)/                   authenticated shell
│       ├── overview/            role-aware dashboard
│       ├── calendar/            calendar board
│       ├── campaigns/           search and filters
│       ├── design/              Design queue
│       ├── emergency/           emergency queue
│       ├── final-view/          CRM-only consolidated view + export
│       ├── qc/                  final QC
│       ├── changes/             change request review
│       ├── segments/            audience library, offer factors, push tags
│       └── performance/         in-session monthly analytics
├── components/                  shell, drawer, queues, upload, charts
├── lib/                         supabase client, workflow, validation, formatting, parsing
├── services/                    auth, campaigns, export, targeting, pncc, gemini
├── types/                       user, campaign, targeting, pncc, performance
└── data/masterData.json         brands, offers, segments, categories, time slots
```

Business rules live in `src/lib/`, not in components:

- `workflow.ts` — `stageOf()`, the single derived-stage function every screen reads; stage labels
  and order; routing predicates; QC field list; character limits.
- `categoryValidation.ts` — every Category rule, shared by the grid and the drawer so they cannot drift.
- `deadlines.ts` — the launch-date-minus-seven rule.
- `excelDates.ts`, `sheetProfile.ts`, `columnMatch.ts` — the shared ingest layer.

### Where the rules are enforced

| Rule | Enforced by |
|---|---|
| Deadline = launch date − 7 days | `category_deadline` generated column (`01_schema.sql`) |
| Category can only edit unlocked rows | RLS `campaigns_update` restricts CATEGORY to `EMPTY`/`DRAFT` (`12_…sql`) |
| Category cannot unlock its own row | Same policy — only CRM can reopen a locked row |
| Locking one row is server-side and single-row | `submit_category(p_campaign_id)`, SECURITY DEFINER |
| Mandatory Category fields | `categoryValidation.ts` gates the Lock action |
| Changes go through a request | `apply_change_request()` with a column whitelist |
| Calendar requires full QC | `update_calendar()` re-checks `qc_status = 'PASSED'` server-side |
| Executive is read only | No write policy grants the EXECUTIVE role |

**Known limit:** RLS is row-scoped, not column-scoped. A permitted role can write any column on a
row it is allowed to touch; the per-field restriction is client-side only.

---

## 6. Design (the team)

Design has **one field: Creative Link, and it is optional.** Designers paste a URL to creative
they host elsewhere.

This app stores no binary assets. There is no file upload, no S3, no Supabase Storage, and
nothing generates a URL on a designer's behalf.

---

## 7. Performance Analytics

A separate, purely **in-session** monthly reporting tab. CRM uploads one `.xlsx`, it is parsed
entirely in the browser and held in React state. **Nothing is saved anywhere** — no Supabase
table, no migration, no cache. Refreshing clears it; re-upload and the view rebuilds.

### Expected upload format

One workbook per month, with these sheets (matched by name, case-insensitive; a missing sheet
produces an inline warning rather than breaking the page):

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
| `top 10 performing PN` | PN name, + metrics (no Month column) |

`CVR` is a decimal (`0.0157`, not `"1.57%"`) — formatted as a percentage only at render time.
`Revenue_INR`/`AOV_INR`/`RPV_INR` are raw numbers; ₹ Cr/L/K formatting is display-only.

### How the AI analysis works

Nothing raw reaches Gemini. `lib/performanceAnalysis.ts` runs first, in your own code: z-score
outlier detection on Revenue/CVR/RPV and a confidence tag per row from order volume (<50 Low,
50–500 Medium, >500 High). Only that pre-reasoned payload goes to Gemini via the serverless
route, which forces strict JSON output against a fixed schema — the UI never renders free-form
text. Only the Executive Summary panel calls Gemini.

**Deliberate limitation:** the workbook carries no user-level or overlap data, so audience
overlap and fatigue risk cannot be genuinely computed. Every prompt states
`overlap data available: false` and instructs the model to say so rather than guess.

---

## 8. What came out of the workbooks

- **Segment library** (`Segments_Moe.xlsx`) — live MoEngage segments with real base counts,
  behind the read-only Audiences page.
- **Offer logic** (`LOGIC SCENARIOS`) — offer factors and playbook: VIP and high-LTV targets get
  early access rather than discount, lapsed users get a win-back band, high-intent users get the
  smallest coupon that converts.
- **Push operations fields** — the 46-column export contract in `services/exportExcel.ts`.

### Still open with the CRM team

Recorded here rather than guessed at in code:

- What rule decides the Collapse ID value on a given row.
- What GL stands for, and whether it is Global Luxury.
- What `prp` means inside a tracking code.
- Who chooses `onetime` versus `earlyaccess`, and on what basis.
- Why the campaign sheet carries two slot columns.
- The finite PN template list — the app currently offers Basic, Bezel, Timer and Coloured BG.
- Official header and sub-copy limits per template type — currently 60 and 100 for all.
- Whether the MoEngage campaign ID should be pasted back against the slot after creation.

---

## 9. Troubleshooting

**"Signed in as DESIGN, but this account has no profile row"** — the auth user was created before
migration 08 added the DESIGN role, so the trigger never fired for it. Run
`supabase/13_backfill_missing_profiles.sql`.

**Category cannot save anything** — migration 12 has almost certainly not been run. Its
verification query is at the bottom of the file.

**Audiences screen is empty** — `04_crm_logic.sql` and `05_slot_restructure.sql` have not run.

**Campaigns appear before anyone uploaded anything** — `03_seed.sql` has been run against this
project. Use `RESET_ALL_DATA.sql`.

**Fonts fail at build time** — the build fetches Google Fonts and needs outbound network access,
which Vercel has and most sandboxes do not.

**Executive Summary returns an error** — check `GEMINI_MODEL` names a model that currently
exists; an invalid name makes the route return 502.

---

## 10. Not built, by design

No production API, no real push delivery, no CleverTap or MoEngage integration, no ML model, no
customer data, no binary asset storage. Export is CSV, not binary `.xlsx`.

Tracking Code, CID and Landing+Tracking URL generation are **explicitly deferred** — the CID
structure uses business-defined abbreviations rather than campaign names or free text, and no
spec has been agreed. Those fields are manual entry only.

For the full list of known issues and open items, see `PROJECT_STATE.md` §7.
