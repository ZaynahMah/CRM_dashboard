# CLiQ Push Ops — Project Handoff

**Purpose:** everything a fresh assistant session needs to work on this project
without the conversation history. Read this first, then open only the files a
given task actually needs.

**Generated:** 9 October 2026, from the repository itself. Every file name, line
count and test count below was produced by scanning the code, not recalled.

**Current state:** 172 files · 345 tests passing · 98 database QC checks passing ·
typecheck clean · lint 0 errors · build 16/16 pages · 26 numbered migrations plus
5 tool scripts.

---

## 0. Read this before touching anything

1. **This is a live internal tool** used by real teams at Tata CLiQ. Changes need
   full understanding, not assumptions.
2. **No assistant session has ever had access to the live Supabase or Vercel.**
   Everything about deployment state is inferred from code and SQL. Never assert
   that a migration has been applied — ask.
3. **Verify, don't reason.** Every production bug in this project's history passed
   a confident code review and failed on live Supabase. The habit that catches
   them is writing a throwaway script to check a claim.
4. **`npm run db-qc` is the most valuable command here.** It builds a real
   PostgreSQL, emulates Supabase, applies every migration twice and runs 98
   scenario checks. It has caught bugs that `tsc`, lint, vitest and `next build`
   all passed.
5. **Working style:** propose before building anything non-trivial; wait for an
   explicit go-ahead. "Do not touch X" lists are instructions, not suggestions.
   Deliverables are zips, not PRs, with an exact ADDED/CHANGED/DELETED file list.

---

## 1. What the product is

An internal control centre for push-notification planning, review and production.

The honest description: **a shared spreadsheet with role-based permissions and a
workflow, that exports back to Excel.** CRM uploads a sheet; each row becomes a
campaign; teams fill their own columns in sequence; the result exports as CSV.

**Stack:** Next.js 14.2.15 (App Router), TypeScript strict, React 18.3, Tailwind
with hand-authored tokens, Supabase (Postgres + Auth + RLS + Storage). Charts are
hand-rolled SVG — no charting library. Dev deps add vitest and eslint.

**Infra:** Vercel project `crm-dashboard` (team TATA CLiQ). Supabase project ref
`jofxdelfnyuaisdmzyuv`.

**Architecture:** almost everything is a client component talking straight to
Supabase from the browser. Permissions live in Postgres RLS, not the UI. One
server route (`/api/performance-analysis`) keeps `GEMINI_API_KEY` off the client.
`src/middleware.ts` guards app routes server-side.

---

## 2. The workflow

```
CRM Input → Category → CRM → Content → CRM Final QC → Calendar
```

**Content is the only production team.** The Design team has left Tata CLiQ.
`design_status` and other design columns are RETAINED as history but **no code
path reads them for routing or visibility** — a test flips `design_status`
through all three values and asserts nothing changes.

**Two independent planning streams. They must never affect each other:**

| Stream | Flag | Flow |
|---|---|---|
| CRM Self | `is_crm_self = true` | CRM Upload → CRM sends → Content → CRM Final QC → Calendar |
| Category-led | `is_crm_self = false` | CRM Upload → Category → CRM → Content → CRM Final QC → Calendar |
| Emergency | `is_emergency = true` | Category raises → CRM accepts → Content → CRM Final QC → Calendar |

`stageOf()` in `src/lib/workflow.ts` is the single derived-stage function every
screen reads: `AWAITING_CATEGORY` → `CATEGORY_SUBMITTED` → `CRM_REVIEW` →
`CRM_PROCESSING` → `PRODUCTION_PENDING` → `PRODUCTION_SUBMITTED` → `FINAL_QC` →
`READY`, plus `BLOCKED`.

`calendar_status = 'UPDATED'` is the one explicit finalization gate. Final View
and Calendar read it and nothing else.

**Four roles, shared accounts:** CATEGORY, CRM, CONTENT, EXECUTIVE. (DESIGN
removed, account banned.) One login per team, not per person — this permanently
caps what any audit trail can attribute.

---

## 3. Features and where each lives

| Feature | Entry point | Roles |
|---|---|---|
| Role dashboards | `/overview` | all |
| CRM flow board (6 sections, two streams) | `/overview` | CRM |
| Category weekly queue | `/overview` | CATEGORY |
| Content queue + **bulk Excel** | `/overview` | CONTENT |
| **Changed Fields** (what Content edited) | `/overview` | CRM |
| Monthly workflow flowchart | `/overview` | all |
| Calendar · Campaigns · Changes · Emergency | `/calendar` `/campaigns` `/changes` `/emergency` | varies |
| Final QC + Show All PN workspace | `/qc` and the CRM board | CRM |
| Final View + CSV export | `/final-view` | CRM |
| Audiences | `/segments` | CRM |
| Performance (persisted) | `/performance` | CRM views, EXECUTIVE uploads |
| **Category SLA · Activities · Notifications · Default Rate** | `/sla` | all; Executive tab for EXECUTIVE |

---

## 4. File structure

### Business logic — `src/lib/` (read these first)

| File | Lines | Purpose |
|---|---|---|
| `workflow.ts` | 147 | **The spine.** `stageOf()`, stage labels, `qcComplete`, conditional `creative_verified`, QC fields, char limits |
| `crmBuckets.ts` | 178 | Single source of truth for CRM board buckets, plus `visibleSections`/`actionableSections` (the orphan guard) |
| `trackingCode.ts` | 311 | The `cid=` production tracking-code format |
| `trackingMasters.ts` | 199 | All tracking dropdowns and source mappings — one config file |
| `contentExcel.ts` | 288 | Content bulk Excel: export, parse, validate, 1-based ranges, diff |
| `businessWeeks.ts` | 166 | Business week buckets and THE deadline rule |
| `monthlyWorkflow.ts` | 120 | Shared workflow summary + Content-submitted split |
| `categoryValidation.ts` | 150 | Category field rules, shared by grid and drawer |
| `columnMatch.ts` | 156 | Fuzzy header matching for uploads |
| `sheetProfile.ts` | 122 | Finds the real header row under a title row |
| `excelDates.ts` | 96 | Excel serial dates via `XLSX.SSF.parse_date_code` — never a JS `Date` |
| `apiGuard.ts` | 116 | Bearer-token session check + in-memory rate limit |
| `uploadReset.ts` | 97 | Reset rules mirrored in TS for testing |
| `format.ts` | 86 | Dates, times, currency, Monday-week helpers |
| `accessPolicy.ts` | 73 | Read policy and route guards mirrored in TS |
| `deadlines.ts` | 56 | Per-campaign deadline (launch − 7) |
| `bulkOutcomes.ts` | 55 | Per-row outcome pattern for bulk actions |
| `paging.ts` | 21 | Pages past PostgREST's 1,000-row cap |
| `performanceAnalysis.ts` / `performanceInsights.ts` | 157 / 126 | Z-score outliers, insight text |
| `supabase.ts` | 35 | Browser client. Uses `\|\|` not `??` — do not "fix" |

### Services — `src/services/`

| File | Lines | Purpose |
|---|---|---|
| `campaigns.ts` | 443 | **Every campaign write.** One `UPDATE` in the codebase, `.eq("id", id)`, behind a UUID guard |
| `performanceReports.ts` | 262 | Performance persistence: storage + metrics + version history |
| `contentBulk.ts` | 231 | Content bulk import/send, diff capture, pending filter |
| `performanceUpload.ts` | 224 | Workbook parsing |
| `categorySla.ts` | 173 | SLA, activities, notifications, default rate |
| `exportExcel.ts` | 113 | The 46-column export contract (CSV) |
| `geminiAnalysis.ts` | 82 | The one Gemini caller |
| `auth.ts` | 68 | Sign-in, role resolution, single generic error |
| `targeting.ts` / `pncc.ts` | 46 / 44 | Reference reads |
| `content.ts` | 39 | **DEAD CODE** — zero imports |
| `notifications.ts` | 20 | **DEAD CODE** — zero imports |

### Components — `src/components/` (largest first)

`CampaignDrawer.tsx` 778 — **the actual product**, every role's editing surface in
five blocks · `BulkWorkspace.tsx` 709 — Show All PN spreadsheet, virtualized,
sticky, bulk fill, 500-row batches · `CrmInputUpload.tsx` 555 — both uploads,
scoped reset preview, typed RESET · `CrmFlowBoard.tsx` 503 — the CRM dashboard,
one layout six sections · `ChartsAdvanced.tsx` 308 · `ContentBulkExcel.tsx` 298 ·
`ContentImportPreview.tsx` 270 — full-text preview, inline edit, live validation ·
`Charts.tsx` 266 · `ui.tsx` 257 — Card/Button/Field/Pill/Tabs/Modal/Drawer/
Loading/Empty · `AddCampaignModal.tsx` 228 · `RoleQueue.tsx` 204 — Category and
Content work surfaces · `CampaignForm.tsx` 195 · `ExecutiveDefaultRate.tsx` 180 ·
`SearchSelect.tsx` 179 — `portal` and `allowCreate` props · `useCampaigns.ts` 161
— list hook + realtime + reset signal · `TotalAnalysisPanel.tsx` 120 ·
`CategorySlaTracker.tsx` 112 · `DayDetail.tsx` 100 · `MonthlyWorkflow.tsx` 99 —
original flowchart design, data from RPC · `WeekDeadlines.tsx` 98 ·
`ContentChangesForCrm.tsx` 97 · `PerformanceReportHistory.tsx` 96 ·
`ExecutiveSlaSummary.tsx` 89 · `ExecutiveScorecard.tsx` 88 · `ActivitiesPanel.tsx`
87 · `PerformanceUpload.tsx` 87 · `AppShell.tsx` 77 — role-filtered nav ·
`TopLeaderboard.tsx` 75 · `CategoryIntelligence.tsx` 73 ·
`CustomerIntelligence.tsx` 71 · `OpportunityMatrix.tsx` 78 · `ProgressBar.tsx` 68 ·
`SystemNotifications.tsx` 59 · `RecommendationPanel.tsx` 59 ·
`CategorySlaStrip.tsx` 58 · `TrendSection.tsx` 56 · `PerformanceReportMeta.tsx` 54 ·
`PnTypeSection.tsx` 43 · `WorkList.tsx` 42 **DEAD** · `StatusChip.tsx` 41 ·
`realtimeMerge.ts` 38 · `SessionProvider.tsx` 34 · `CrmFlowSection.tsx` 32 —
Performance wrapper, **unrelated to `CrmFlowBoard.tsx`** · `icons.tsx` 23

### Pages — `src/app/`

`(app)/overview/page.tsx` 235 · `(app)/segments/page.tsx` 225 ·
`api/performance-analysis/route.ts` 204 · `(app)/emergency/page.tsx` 154 ·
`(app)/performance/page.tsx` 153 · `login/page.tsx` 118 ·
`(app)/campaigns/page.tsx` 109 · `(app)/qc/page.tsx` 105 ·
`(app)/changes/page.tsx` 104 · `(app)/calendar/page.tsx` 102 ·
`(app)/final-view/page.tsx` 97 · `(app)/sla/page.tsx` 94 · `globals.css` 81 ·
`layout.tsx` 22 · `page.tsx` 18 · `(app)/layout.tsx` 5 · `src/middleware.ts` 97

### Types and data

`campaign.ts` 214 (the `Campaign` interface, ~95 fields) · `performance.ts` 97 ·
`targeting.ts` 38 · `pncc.ts` 31 · `calendar.ts` 27 **DEAD** · `user.ts` 24 —
small but critical; a missing copy once broke a Vercel build.

`src/data/masterData.json` 678 — 326 brands, 165 offers, 77 segments, 63
categories, 36 time slots. The de facto dropdown authority.

---

## 5. Migrations — run in this order

**Numbering skips 07. No `07_*.sql` exists or is needed.**

| # | File | What it does |
|---|---|---|
| 01 | `01_schema.sql` | Tables, enums, `launch_date - 7` generated column, auth→profile trigger |
| 02 | `02_rls.sql` | RLS policies + SECURITY DEFINER workflow functions |
| 03 | `03_seed.sql` | **NEVER in production.** ~250 demo campaigns |
| 04 | `04_crm_logic.sql` | Segments, offer factors, push tags, `campaigns_sync_group` trigger |
| 05 | `05_slot_restructure.sql` | PNCC tables, approved pairs, fixed time slots |
| 06 | `06_workflow_statuses.sql` | Workflow status columns, Final Ops set |
| 08 | `08_production_workflow.sql` | DESIGN role (since removed), design columns, `is_crm_self` |
| 09 | `09_calendar_and_sync.sql` | `calendar_status`, `update_calendar()` RPC |
| 10 | `10_slot_dedup.sql` | Slot de-duplication |
| 11 | `11_remove_slot_uniqueness.sql` | Removes one-campaign-per-slot |
| 12 | `12_fix_category_content_update_rls.sql` | **Required** — without it Category cannot save |
| 13 | `13_backfill_missing_profiles.sql` | Profile rows for pre-existing auth users |
| 14 | `14_remove_design_team.sql` | Unsticks campaigns after Design removal |
| 15 | `15_disable_design_user.sql` | Bans the DESIGN account, drops its policy |
| 16 | `16_tracking_code_fields.sql` | 6 tracking short-code columns; clears old-format codes |
| 17 | `17_security_hardening.sql` | Conditional creative QC, per-role reads, column-ownership trigger |
| 18 | `18_upload_reset_with_archive.sql` | Archive tables, reset RPC, preview |
| 19 | `19_tracking_prefill.sql` | Segment 2 pre-fill; lists ambiguous offers for review |
| 20 | `20_monthly_workflow_summary.sql` | Shared summary RPC + `reset_events` broadcast |
| 21 | `21_fix_archive_column_drift.sql` | Name-based archiving (fixes 42601) |
| 22 | `22_reset_timeout_and_speed.sql` | `where true` on deletes; role statement_timeout (fixes 57014) |
| 23 | `23_performance_reports.sql` | Performance persistence + storage policies |
| 24 | `24_category_sla.sql` | SLA, activities, shared notifications, nightly job |
| 25 | `25_scoped_reset_by_stream.sql` | **Reset scoped to one stream** |
| 26 | `26_default_rate.sql` | Default Rate reporting + threshold alerts |
| 27 | `27_content_change_sets.sql` | What Content changed, for CRM |

**Tools, run only when needed:** `VERIFY_APP_SCHEMA.sql` (expect zero rows),
`RESET_ALL_DATA.sql`, `ROLLBACK_14_TO_19.sql`, `FIX_SCHEMA_DRIFT.sql`,
`VERIFY_SCHEMA.sql`. Setup notes in `23_STORAGE_SETUP.md`.

### Manual Supabase steps (SQL cannot do these)

1. **Storage bucket `performance-reports`** — private, 50 MB limit, xlsx MIME
   types. See `supabase/23_STORAGE_SETUP.md`; rerun migration 23 afterwards so the
   policies attach.
2. **Realtime** enabled for `campaigns` and `reset_events` (Database →
   Replication), or live updates and the reset signal never fire.
3. **Nothing schedules `recalculate_category_sla()`.** Enable `pg_cron` or rely on
   the Recalculate button on `/sla`.

---

## 6. Rules that are load-bearing

1. **Every write targets one UUID.** One `UPDATE` against `campaigns` exists; it is
   `.eq("id", id)` behind a UUID guard. Bulk actions loop, 500 at a time.
2. **Hooks before returns, always.** `react-hooks/rules-of-hooks` is a
   build-failing error because a violation crashed the app on login.
3. **Every DELETE and UPDATE in SQL needs a WHERE.** Supabase runs
   `pg_safeupdate`; an unqualified statement fails with 21000 through the API but
   works in psql. `src/lib/sqlSafety.test.ts` enforces this.
4. **Saving ≠ locking ≠ submitting.** Three separate explicit actions.
5. **Don't refetch on save.** Patch the one row in memory from the confirmed
   response; refetching remounts tables and loses input.
6. **Deterministic ordering.** `listCampaigns` orders by
   `launch_date, launch_time, slot_number, id` and pages past 1,000 rows.
7. **Numbers stay strings where the column is text.** CVR/RPV validated by regex,
   never parsed — parsing turns `450.00` into `450`.
8. **No binary asset storage for creatives.** No S3, no upload in the Design flow.
   A previous build fabricated fake S3 URLs; removed. Do not reintroduce.
9. **One deadline rule:** business week start − 7. The old 9-day buffer is gone.
10. **Tracking codes use the `cid=` production format**, built from short codes
    chosen in dropdowns — never slugified free text, never `na` padding.

---

## 7. Tracking code format

```
cid={type}:{name}:{channelName}_{channelFormat}:{seg1}_{seg2}
    :{category}_{subCategory}_{brand}_{landing}_{offer}_{time}_{date}:{keywords}
```

Separators are part of the format: `=` after `cid`, `:` between the six groups,
`_` inside a group. Derived from the July'26 Fashion CRM Calendar (3,103 codes);
reproduces 3,083 exactly.

Reproduced byte-for-byte by the tests:
```
cid=pn:prp:push_text:wom_cat:westside_women_multibrand_plp_starts_h7_010726:onetime
```

Fixed values: `cid`, `pn`, `prp`, `push`. Dropdowns: channel format
(`text`/`img`), 27 Segment 1 codes, Segment 2 (`cat`/`int`), 20 categories, ~39
sub-categories, landing (`plp`/`clp`), 10 offers, keywords
(`onetime`/`earlyaccess`/`bday`).

**Time** is `h` + 24-hour hour; **midnight is `h24`, not `h0`**. **Date** is
`ddmmyy`, always six digits. **No `na` placeholders** — a missing field yields no
code, shows `⚠️ Missing Data` naming the field, and blocks QC.

**Landing + tracking:** code inserted as the FIRST query parameter, any `icid2`
removed, non-`https://www.tatacliq.com` rejected.

---

## 8. Category SLA

**Business weeks are calendar buckets**, not Monday–Sunday:
W1 = 1–7, W2 = 8–14, W3 = 15–21, W4 = 22–28, W5 = 29–end of month.

**Deadline is per campaign week:** week start − 7. Every campaign launching in
1–7 Nov inherits 25 Oct.

**Escalation ladder** — a missed deadline does not default immediately:
day 0 Overdue → day 1 Reminder → day 2 Escalation → **day 3+ Defaulted**.

**A default never blocks campaign movement.** It records the miss and lets CRM
proceed, recording that CRM, not Category, did the work.

**Partial fills:** a category counts as submitted only when every PN in the week
is filled. 35 of 40 means the whole category follows the date ladder. The tracker
shows `35 / 40` so the partial state is visible, but the status is binary. Known
limitation, deliberately left in place.

**Notification volume:** `dedupe_key = status:week_key:category`, so 100 pending
PNs produce ONE notification, not 100.

**Default Rate %** = defaulted weeks ÷ total weeks × 100. A week that defaulted
counts even if CRM later filled it. Threshold alerts fire once per crossing at 10%.

---

## 9. Verification

```bash
npm install          # required; eslint + vitest are dev deps
npm test             # 345 vitest cases
npx tsc --noEmit
npm run lint
npm run build        # the check that matters; runs lint
npm run db-qc        # 98 checks against a REAL PostgreSQL
npm run verify       # pre-push: every manifest file is tracked by git
npm run preflight    # verify + test + typecheck + build
```

### `npm run db-qc` — the one that catches real bugs

Expects PostgreSQL 16 present
(`apt-get install -y postgresql-16 postgresql-contrib`). `scripts/db-qc.sh`:

1. Builds a throwaway cluster, running as the `postgres` user (Postgres refuses
   root).
2. Emulates Supabase: `auth` schema, `auth.uid()` from a session setting,
   `anon`/`authenticated`/`service_role` roles, `supabase_realtime` publication,
   and `pg_safeupdate`.
3. Applies migrations 01→27 **twice**, each file as ONE transaction (mirroring the
   SQL Editor, so a mid-file failure rolls the whole file back).
4. Compares `campaigns` columns against the live schema.
5. Runs 98 scenario checks as each role under RLS.

Suites: `db-qc-scenarios.sql`, `db-qc-streams.sql`, `db-qc-sla.sql`,
`db-qc-defaultrate.sql`, `db-qc-performance.sql`, `db-qc-load.sql`,
`db-qc-archive-drift.sql`, `db-qc-columns.sql`, plus `static-qc.sh`.

### Test files — 345 cases

`trackingCode.test.ts` 92 · `contentExcel.test.ts` 47 · `productionFixes.test.ts`
37 · `sqlSafety.test.ts` 34 · `businessWeeks.test.ts` 31 · `accessPolicy.test.ts`
24 · `e2e.test.ts` 21 · `uploadReset.test.ts` 21 · `crmBuckets.test.ts` 11 ·
`realtimeMerge.test.ts` 10 · `qcGate.test.ts` 9 · `paging.test.ts` 8

**Build caveat in sandboxes:** `src/app/layout.tsx` loads Google Fonts, so
`next build` fails without outbound network. Stub the fonts **in a throwaway
copy**, never in delivered code.

---

## 10. Bugs already had — do not reintroduce

Each passed every local check and failed on live Supabase. This is why
`npm run db-qc` exists.

| Bug | Cause | Guard now |
|---|---|---|
| Migrations silently rolled back | Wrote `actor_id`/`detail`; real columns are `user_id`/`description` | `VERIFY_APP_SCHEMA.sql` |
| Upload could never work | `jsonb_populate_recordset` ignores column defaults | Explicit column list |
| Reset failed 21000 | `delete` with no WHERE under `pg_safeupdate` | `sqlSafety.test.ts` |
| Reset failed 42601 | Archive table created before later columns existed | Name-based archive, migration 21 |
| Reset failed 57014 | Whole RPC is one statement under an 8s role timeout. **An in-function `SET LOCAL statement_timeout` does NOT help** — the timer is already armed | Role-level timeout, migration 22 |
| Reset wiped both streams | `p_is_crm_self` recorded but never used as a filter | Migration 25 + 16 stream checks |
| 2,000 of 3,000 rows invisible | `listCampaigns` had no `.range()`; PostgREST caps at 1,000 silently | `lib/paging.ts` + tests |
| App crashed on login | Hooks placed below early returns | `rules-of-hooks` as build error |
| Content submitted 5, CRM saw 2 | Bare `for` loop; first throw aborted the rest | Per-row try/catch + outcomes |
| Vercel "Module not found" ×2 | Recently-edited files never reached GitHub | `npm run verify` + `MANIFEST.txt` |

---

## 11. Still open — do not silently resolve

1. **Notification bell is not wired.** `AppShell` shows two hardcoded demo alerts.
   `system_notifications` is only visible on `/sla`.
2. **Dead code:** `services/content.ts`, `services/notifications.ts`,
   `types/calendar.ts`, `components/WorkList.tsx`, the `content_submissions` table
   and `submit_content()` RPC. Zero imports. Do not "wire up" without asking.
3. **Four shared accounts** cap audit attribution permanently.
4. **Partial-fill SLA is binary** (see §8).
5. **Content "Close Preview" does not revert** imported values — they are saved as
   a draft on purpose. The UI says so in three places. Rollback was explicitly
   declined.
6. **No "resume last batch"** affordance for Content after closing a preview.
7. **Landing URL validation (Phase 3) is NOT built.** Agreed design:
   `/api/validate-landing`, statuses `VERIFIED` / `UNREACHABLE` / `NOT_CHECKED`;
   CORS, bot protection and rate limiting must NOT count as invalid; submission
   blocked only on `UNREACHABLE`; status stored for CRM and QC.
8. **Two segment sources disagree:** `masterData.json` (77) vs `pncc_*` (~30).
9. `emergency_score` hardcoded to 90. Export is CSV, not binary `.xlsx`.
10. **Group ID has two writers** — the `campaigns_sync_group` trigger and CRM's
    manual field. The trigger wins. **Open decision; do not change it.**
11. **RLS is row-scoped for most columns**; the migration-17 trigger adds
    column-level ownership for CONTENT and CATEGORY only.
12. **Credentials appear in `README.md` §1 and
    `13_backfill_missing_profiles.sql`** as setup instructions. Safe only while
    the repo is private; passwords were rotated after a public window.

---

## 12. Scope boundaries

Do not touch without an explicit request: the tracking-code engine, Calendar, QC
gates, the Performance dashboard's analysis logic, reset logic, the Monthly
Workflow UI design (restored to its original look deliberately), Audiences, or the
`campaigns_sync_group` trigger.

Closed — do not revisit unless a specific bug requires it: the row-contamination
fix, the CRM flow board, the scoped reset.

---

## 13. Delivery

Work is delivered as a **zip**; the user extracts and commits manually. Always:

1. `npx tsc --noEmit`, `npm test`, `npm run build`, `npm run db-qc`.
2. Confirm every `@/` import resolves and casing matches disk exactly — Vercel is
   case-sensitive and two deploys have failed on this.
3. Regenerate `MANIFEST.txt`.
4. State files changed, tests performed, and anything that could not be verified
   without live access.
5. Give an explicit ADDED / CHANGED / DELETED list with full paths and counts.
   No folders, no "etc".

Before pushing, the user runs `npm run verify`. Silence means Git has every file.
Any output means a file is untracked — the exact state that has broken a deploy
twice.
