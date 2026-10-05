# CLiQ Push Ops — Repository Handoff

**Purpose:** this document lets a fresh Claude session understand the attached zip without access to the GitHub repository. Read this first, then read `PROJECT_STATE.md` in the zip, then open only the files a given task actually needs.

**Generated:** 30 September 2026, from the repository itself — file list, line counts, and dead-code findings below were produced by scanning the code, not recalled.

---

## 0. Read this before touching anything

1. **`PROJECT_STATE.md` (in the zip) is the authoritative record.** Where it and the README disagree, PROJECT_STATE wins. Where this handoff and PROJECT_STATE disagree, PROJECT_STATE wins.
2. **This is a live internal tool** used by real teams at Tata CLiQ. Changes need full understanding, not assumptions.
3. **No assistant session has ever had access to the live Supabase or Vercel.** Everything anyone has said about deployment state is inferred from reading code and SQL. Never assert that a migration has been applied — ask.
4. **Verify before building.** The habit that has caught the most bugs in this project is writing a throwaway script to check a claim (a sweep, a grep, a diff) rather than reasoning about it.
5. The user's working style: **propose first, wait for approval, then build.** They will say explicitly when to implement. They scope tightly and mean it — a "do not touch X" list is not advisory.

---

## 1. What the product is

An internal control centre for push-notification planning, review and production.

The honest description: **a shared spreadsheet with role-based permissions and a workflow, that exports back to Excel.** CRM uploads a sheet; each row becomes a campaign; teams fill their own columns in sequence; the result exports as CSV.

The test for any change: *does it get a row from the uploaded sheet to the exported sheet, with the right people filling the right columns in between?*

**Stack:** Next.js 14.2.15 (App Router), TypeScript strict, React 18.3, Tailwind with hand-authored tokens, Supabase (Postgres + Auth + RLS). Six runtime dependencies: `@supabase/ssr`, `@supabase/supabase-js`, `next`, `react`, `react-dom`, `xlsx`. Charts are hand-rolled SVG — there is no charting library. Dev dependencies add `eslint` and `eslint-config-next`.

**Infra:** Vercel project `crm-dashboard` (team TATA CLiQ), building from `main`. Supabase project ref `jofxdelfnyuaisdmzyuv`.

**Architecture shape:** almost everything is a client component talking straight to Supabase from the browser. Permissions live in Postgres RLS, not the UI. There is exactly **one** server route, `/api/performance-analysis`, which exists solely to keep `GEMINI_API_KEY` out of the browser bundle.

---

## 2. The workflow — memorise this

```
CRM Input → Category → CRM → Content → CRM → Design → CRM → Final QC → Calendar
```

**Content and Design are SEQUENTIAL, not parallel.** There is a CRM checkpoint between them. This was changed deliberately; older comments or docs suggesting a single "Send to Content & Design" action are stale.

`stageOf()` in `src/lib/workflow.ts` is the single derived-stage function every screen reads. Stages in order:

| Stage | Meaning | Owner |
|---|---|---|
| `AWAITING_CATEGORY` | uploaded, Category not filled | Category |
| `CATEGORY_SUBMITTED` | Category locked | Category |
| `CRM_REVIEW` | awaiting CRM approve/reject | CRM |
| `CRM_PROCESSING` | CRM filling Part 2 | CRM |
| `CONTENT_PENDING` | with Content | Content |
| `CONTENT_SUBMITTED` | Content back; CRM must route to Design | CRM |
| `DESIGN_PENDING` | with Design | Design |
| `DESIGN_SUBMITTED` | Design back; CRM must run Final QC | CRM |
| `FINAL_QC` | QC passed, awaiting Update Calendar | CRM |
| `READY` | `calendar_status = 'UPDATED'` | — |
| `BLOCKED` | `production_status = 'BLOCKED'` | CRM |

`calendar_status = 'UPDATED'` is the **one** explicit finalization gate. Final View and Calendar read it and nothing else.

**CRM Self flow** (`is_crm_self = true`) skips Category entirely: uploaded straight to Content, then the same sequence.

**Five roles:** CATEGORY, CRM, CONTENT, DESIGN, EXECUTIVE (read-only). These are **shared accounts** — one login per team, not per person. That caps what any audit trail can attribute.

---

## 3. Complete file structure

101 project files. Line counts are real.

### Config and docs (root)

| File | Lines | Purpose |
|---|---|---|
| `PROJECT_STATE.md` | 298 | **Authoritative record.** Architecture, bucket conditions, open items, deferred work, working agreements. Read second. |
| `README.md` | 319 | Setup, migrations, deployment, troubleshooting. Rewritten Sept 2026 against the actual repo. |
| `package.json` | 30 | 6 runtime deps, 2 dev (eslint). |
| `tsconfig.json` | 21 | Strict. Path alias `@/*` → `./src/*`. |
| `.eslintrc.json` | 7 | **`react-hooks/rules-of-hooks` as an error.** Added after a hooks violation crashed the app on login. `next build` runs lint, so violations now fail the build. |
| `tailwind.config.ts` | 41 | Hand-authored design tokens. |
| `next.config.mjs`, `postcss.config.mjs` | 3, 1 | Minimal. |
| `.env.example` | 7 | Four placeholders, no values. |
| `.gitignore` | 8 | node_modules, .next, .env*, tsbuildinfo. |

### Business logic — `src/lib/` (read these first)

**Rules live here, not in components.**

| File | Lines | Purpose |
|---|---|---|
| `workflow.ts` | 128 | **The spine.** `stageOf()`, stage labels/order, `awaitingDesignRouting()`, `awaitingFinalQc()`, the 10 QC field names, `HEADER_LIMIT`/`SUB_COPY_LIMIT`. |
| `crmBuckets.ts` | 81 | **Single source of truth for CRM dashboard bucket membership.** Pure functions. Never inline a bucket condition in a component. |
| `categoryValidation.ts` | 150 | Every Category rule — mandatory fields, the numeric regex, draft↔patch mapping. Imported by both the grid and the drawer so they cannot drift. |
| `apiGuard.ts` | 116 | Session check (`getSessionUserId`, Bearer token → `supabase.auth.getUser`) and in-memory rate limit (5/60s per user). |
| `supabase.ts` | 35 | Browser client via `createBrowserClient`. Uses `\|\|` not `??` for env fallback — this matters, don't "fix" it. |
| `format.ts` | 86 | Dates, times, currency, plus `weekStart`/`weekLabel`/`fmtWeekRange` for Category's weekly model. |
| `columnMatch.ts` | 156 | Fuzzy header matching for uploads. Matches by meaning, not exact text. |
| `sheetProfile.ts` | 122 | Finds the real header row in a messy workbook (title rows above it). |
| `excelDates.ts` | 96 | Decodes Excel serial dates via `XLSX.SSF.parse_date_code` — **never** through a JS `Date`, which shifts by timezone. |
| `deadlines.ts` | 56 | The launch-date-minus-7 rule. |
| `performanceAnalysis.ts` | 157 | Z-score outlier detection + confidence tags. Runs **before** anything reaches Gemini. |
| `performanceInsights.ts` | 126 | Derived insight text for the Performance tab. |

### Services — `src/services/`

| File | Lines | Purpose |
|---|---|---|
| `campaigns.ts` | 323 | **Every campaign write.** One `UPDATE` statement in the whole codebase, `.eq("id", id)`, behind a UUID guard. Routing, locks, QC, review markers. |
| `performanceUpload.ts` | 224 | Parses the monthly performance workbook, in-browser. |
| `exportExcel.ts` | 109 | The **46-column export contract**. CSV, not binary xlsx. |
| `geminiAnalysis.ts` | 82 | Calls the one server route. Attaches the Supabase access token. |
| `auth.ts` | 68 | Sign-in, role resolution. Single generic error for all auth failures. |
| `targeting.ts` | 46 | Audience library reads. |
| `pncc.ts` | 44 | PNCC segment/category reads. |
| `content.ts` | 39 | **DEAD CODE.** Zero imports. See §6. |
| `notifications.ts` | 20 | **DEAD CODE.** Zero imports. See §6. |

### Types — `src/types/`

| File | Lines | Purpose |
|---|---|---|
| `campaign.ts` | 205 | `Campaign` (89 fields), `QcChecklist`, `CrmDecision`, `ChangeRequest`, all status unions. |
| `performance.ts` | 97 | Uploaded workbook shapes. |
| `targeting.ts` | 38 | Segments, cohorts, offer factors. |
| `pncc.ts` | 31 | PNCC reference types. |
| `user.ts` | 26 | `Profile`, `AppRole`, `USERNAME_TO_EMAIL`, `HOME_FOR_ROLE`. **Small but critical** — a missing copy of this file broke a Vercel build. |
| `calendar.ts` | 27 | **DEAD CODE.** Legacy slot system. |

### Pages — `src/app/`

| File | Lines | Purpose |
|---|---|---|
| `(app)/overview/page.tsx` | 196 | **Role-aware dashboard.** Different content per role. CRM sees the flow board. |
| `(app)/segments/page.tsx` | 225 | Audiences — read-only reference library. |
| `(app)/emergency/page.tsx` | 157 | Emergency queue, scoped per role. |
| `(app)/design/page.tsx` | 148 | Design queue. Creative Link only, optional. |
| `(app)/performance/page.tsx` | 110 | In-session analytics. **No database at all.** |
| `(app)/campaigns/page.tsx` | 109 | Search and filters. |
| `(app)/qc/page.tsx` | 105 | Final QC. |
| `(app)/changes/page.tsx` | 104 | Change request review. |
| `(app)/calendar/page.tsx` | 102 | Calendar board. |
| `(app)/final-view/page.tsx` | 97 | CRM-only consolidated view + export. |
| `api/performance-analysis/route.ts` | 204 | **The only server code.** Auth + rate limit + Gemini. |
| `login/page.tsx` | 118 | Plain username/password. No credential hints (removed for go-live). |
| `layout.tsx`, `page.tsx`, `(app)/layout.tsx` | 22, 18, 5 | Shell and redirects. |
| `globals.css` | 81 | Base styles. |

### Components — `src/components/`

| File | Lines | Purpose |
|---|---|---|
| `CampaignDrawer.tsx` | 730 | **The actual product.** Every role's editing surface in five `<Block>` sections: CRM Part 1, Category Input, CRM Part 2, Content/Creative, CRM Part 3. Plus the QC checklist and Update Calendar. |
| `IncomingData.tsx` | 692 | Category's weekly buckets **and** Content's origin buckets. One component, two very different modes by `role` prop. |
| `CrmInputUpload.tsx` | 423 | Both uploads (standard and CRM Self). Parse, preview, scoped wipe, batched insert. |
| `CrmFlowBoard.tsx` | 399 | **The CRM dashboard.** One `FlowSection`/`Bucket` layout rendered six times. |
| `ChartsAdvanced.tsx` | 308 | Performance charts (5 importers). |
| `Charts.tsx` | 266 | Base SVG chart primitives. |
| `ui.tsx` | 257 | `Card`, `Button`, `Field`, `Pill`, `Tabs`, `Modal`, `Drawer`, `Loading`, `Empty`. |
| `AddCampaignModal.tsx` | 228 | Manual campaign creation. |
| `CampaignForm.tsx` | 195 | Shared create form. |
| `SearchSelect.tsx` | 179 | Searchable dropdown. `portal` prop escapes clipping containers; `allowCreate` adds "+ Add new value". |
| `TotalAnalysisPanel.tsx` | 120 | The only Gemini caller in the UI. |
| `DayDetail.tsx` | 100 | Calendar day panel. |
| `WeekDeadlines.tsx` | 93 | Deadline summary. |
| `ExecutiveScorecard.tsx` | 88 | Executive view. |
| `OpportunityMatrix.tsx` | 78 | Performance quadrant chart. |
| `AppShell.tsx` | 77 | Nav (role-filtered), header, notification bell. |
| `TopLeaderboard.tsx` | 75 | Top PN table. |
| `CategoryIntelligence.tsx` / `CustomerIntelligence.tsx` | 73 / 71 | Performance panels. |
| `PerformanceUpload.tsx` | 73 | Workbook picker. |
| `ProgressBar.tsx` | 70 | Stage progress. |
| `RecommendationPanel.tsx` | 59 | Performance suggestions. |
| `TrendSection.tsx` | 56 | Trend charts. |
| `PnTypeSection.tsx` | 43 | PN-type breakdown. |
| `StatusChip.tsx` | 43 | Stage → colour. |
| `SessionProvider.tsx` | 34 | Session context + `useSession()`. |
| `CrmFlowSection.tsx` | 32 | Performance section wrapper. **Unrelated to `CrmFlowBoard.tsx`** despite the name. |
| `useCampaigns.ts` | 24 | Campaign list hook. |
| `icons.tsx` | 23 | Inline SVG icons. |
| `WorkList.tsx` | 42 | **DEAD CODE.** Zero imports. |

### Data

`src/data/masterData.json` (678 lines) — 326 brands, 165 offers, 77 segments, 63 categories, 36 time slots. **The de facto dropdown authority**, and it disagrees with the `pncc_*` database tables (~30 segments). Known, unresolved.

### SQL — `supabase/`

Run in this order. **Numbering skips 07 — no such file exists or is needed.**

| File | Lines | Purpose |
|---|---|---|
| `01_schema.sql` | 288 | Tables, enums, the `launch_date - 7` generated column, the auth→profile trigger. |
| `02_rls.sql` | 196 | RLS policies + SECURITY DEFINER workflow functions. |
| `03_seed.sql` | 241 | **NEVER run in production.** ~250 demo campaigns. |
| `04_crm_logic.sql` | 285 | Segments, offer factors, push tags, channels. Contains the `campaigns_sync_group` trigger. |
| `05_slot_restructure.sql` | 216 | PNCC tables, approved pairs, fixed time slots. |
| `06_workflow_statuses.sql` | 79 | Workflow status columns, wide Final Ops set. |
| `08_production_workflow.sql` | 79 | **The DESIGN role**, design/emergency columns, `is_crm_self`. |
| `09_calendar_and_sync.sql` | 75 | `calendar_status`, `update_calendar()` RPC, `workflow_status` mirror. |
| `10_slot_dedup.sql` | 21 | Slot de-duplication. |
| `11_remove_slot_uniqueness.sql` | 20 | Removes one-campaign-per-slot. |
| `12_fix_category_content_update_rls.sql` | 34 | **Required.** Without it Category cannot save at all. |
| `13_backfill_missing_profiles.sql` | 54 | Fixes DESIGN login (missing profile row). |
| `RESET_ALL_DATA.sql` | 37 | Clears campaigns + children. Recovery from seed. |
| `VERIFY_SCHEMA.sql` | 96 | Schema check. |
| `FIX_SCHEMA_DRIFT.sql` | 307 | Drift repair. |

---

## 4. Database

**21 tables, all with RLS enabled.** Verified by scanning — note that policies for 11 reference tables are created by `execute format()` loops in migrations 04 and 05, which a naive regex over the SQL will miss.

`campaigns` is the wide operational row (**89 columns**). Six cascade-delete children: `crm_decisions`, `content_submissions`, `qc_checklists`, `change_requests`, `activity_logs`, `notifications`. Reference tables from 04 (`segments`, `channels`, `cohorts`, `offer_factors`, `offer_playbook`, `push_tags`, `segment_exclusions`) and 05 (`pncc_segments`, `pncc_categories`, `approved_pairs`, `fixed_time_slots`).

**Every read policy is `USING (true)`** — any authenticated user reads every row of every table. **No customer PII exists anywhere in the schema.**

**RLS is row-scoped, not column-scoped.** A permitted role can write *any* column on a row it may touch; the per-field restriction is client-side only and therefore advisory. A `BEFORE UPDATE` trigger to fix this is designed but **not built** — see PROJECT_STATE.

SECURITY DEFINER RPCs: `submit_category`, `submit_content`, `update_calendar`, `accept_emergency`, `reject_emergency`, `apply_change_request`. All scoped `where id = p_campaign_id`.

---

## 5. Conventions that are load-bearing

1. **Every write targets one UUID.** There is one `UPDATE` against `campaigns` in the codebase; it is `.eq("id", id)` behind a UUID guard. Bulk actions loop and write one id per call. A past bug that looked like cross-row writes was actually stale React state — see PROJECT_STATE §2.
2. **Hooks before returns, always.** `react-hooks/rules-of-hooks` is a build-failing error because a violation crashed the app on login.
3. **Saving ≠ locking.** Saving persists a draft. Locking is a separate explicit action.
4. **Don't refetch on save.** Patch the one row in memory from the confirmed response. Refetching remounts the table, closes dropdowns, loses input and resets scroll.
5. **Deterministic ordering.** `listCampaigns` orders by `launch_date, launch_time, slot_number, id`. Ordering by date alone made rows visibly reshuffle.
6. **Numbers stay strings where they're text columns.** CVR/RPV are validated by regex, never parsed — parsing turns `450.00` into `450`.
7. **No binary asset storage.** No S3, no Supabase Storage, no file upload in the Design flow. A previous implementation fabricated fake S3 URLs; it was removed. Do not reintroduce.

---

## 6. Dead code — verified, do not "wire it up" without asking

Zero imports anywhere:

- `src/services/content.ts` — plus the `content_submissions` table and `submit_content()` RPC. Content actually writes directly to `campaigns`. **Two content models exist; the documented one is dead.**
- `src/services/notifications.ts` — the `notify()` helper writes rows, but nothing reads them. The bell drawer in `AppShell` shows **two hardcoded demo alerts** and a hardcoded badge of 2.
- `src/types/calendar.ts` and the `calendar_days` / `calendar_slots` tables — legacy slot system.
- `src/components/WorkList.tsx`.

---

## 7. Known open items

Full list in PROJECT_STATE §7. The ones that bite first:

1. **Migrations 11, 12, 13 have never been confirmed applied.** Ask; don't assume. If Category can't save, 12 is missing. If DESIGN can't log in, 13 is.
2. **Column-level write enforcement doesn't exist.** Content can write `tracking_code` with a valid session token.
3. **Tracking Code / CID / Landing+Tracking are explicitly deferred.** The CID uses business-defined abbreviations, not campaign names. A field-concatenation generator was specified and **rejected**. Do not propose a format again without the abbreviation dictionary.
4. **`group_id` has two writers** — the `campaigns_sync_group` trigger and CRM's manual field. Trigger currently wins. **Open decision; do not change it.**
5. **Five shared accounts** cap audit attribution at the team level, permanently.
6. **`sync_workflow_status()` mirror lags** the sequential model. Nothing reads it.
7. Two segment sources disagree (`masterData.json` vs `pncc_*`).
8. `emergency_score` hardcoded to 90.

---

## 8. How to verify changes

There is no test runner. The pattern that has worked:

```bash
npm install                                    # required — eslint deps
npx tsc --noEmit                               # types
npx next build                                 # the check that matters; runs lint
npx next lint --dir src                        # hooks rules
```

For logic, write a throwaway TypeScript file importing the pure functions from `src/lib/`, compile it with `npx tsc --outDir /tmp/... --skipLibCheck`, and run it with node. Existing suites written this way cover Category validation (40 assertions), the workflow sequence (38), CRM Self column matching (29), CRM bucket journeys plus a 1,152-state exclusivity sweep (37), and the API guard (17).

**The sweep pattern is worth copying.** Enumerating every combination of status columns and asserting an invariant caught two bucket-ordering bugs that reasoning had missed.

**Build caveat in sandboxes:** `src/app/layout.tsx` loads Inter and Plus Jakarta Sans via `next/font/google`, so `next build` fails without outbound network. Stub the fonts **in a throwaway copy**, never in the delivered code.

---

## 9. Scope boundaries the user has set

Do not touch without an explicit request: Performance module, Audiences (`/segments`), export behaviour, tracking-code logic, the `campaigns_sync_group` trigger.

Closed areas — do not revisit unless a specific bug requires it: the row-contamination fix, the CRM flow board.

---

## 10. Deliverables

Work is delivered as a **zip**, not a PR — the user extracts and commits manually. Always:

1. `npx tsc --noEmit` and `npx next build` before packaging.
2. Confirm every `@/` import resolves to a file on disk (a missing `src/types/user.ts` once broke a Vercel build).
3. State files changed, tests performed, and anything that could not be verified without live access.
4. Update `PROJECT_STATE.md` when a change alters architecture, a decision, or an open item.

Before pushing, the user should run:

```bash
diff <(cd src && find . -type f | sort) <(git ls-files src | sed 's|^src/|./|' | sort)
```

Silence means Git has every file. Any output means a file is untracked — the exact state that has broken a deploy before.
