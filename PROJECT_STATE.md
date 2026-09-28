# CLiQ Push Ops — Project State (Baseline)

**Last updated:** 28 September 2026 (iteration 5 — current baseline, plus hooks hotfix)
**Status:** current baseline. Treat the GitHub repo (`ZaynahMah/CRM_dashboard`) and the handoff document as source of truth; this file records state that post-dates the handoff.

---

## 0. What this is

A shared spreadsheet with role-based permissions and a workflow, that exports back to Excel. A CRM sheet (Date, Time, Slot, Segment, Category) is uploaded; each row becomes a campaign; teams fill their own columns in sequence; the result exports as CSV. The test for any change: *does it get a row from the uploaded sheet to the exported sheet, with the right people filling the right columns in between?*

Stack: Next.js 14.2.15 App Router, TypeScript, React 18.3, Tailwind (hand-authored tokens), Supabase (Postgres + Auth + RLS), hand-rolled SVG charts, `xlsx` for parsing, Gemini via one server route. Six runtime dependencies.

Infra: Vercel project `crm-dashboard` (team TATA CLiQ); Supabase project ref `jofxdelfnyuaisdmzyuv`. No live access from any assistant session — every claim about schema or deployment comes from reading code and SQL.

---

## 1. Workflow sequence (current, authoritative)

```
CRM Input → Category → CRM → Content → CRM → Design → CRM → Final QC → Calendar
```

**Content and Design are sequential, not parallel.** CRM routes to Content only; Content submits; CRM reviews and *then* routes to Design; Design submits; CRM does Final QC; CRM clicks Update Calendar.

This required no migration. `design_status` simply stays `NOT_ASSIGNED` until CRM routes the campaign onward, which makes "Content done, not yet with Design" an already-distinguishable state.

`stageOf()` in `src/lib/workflow.ts` is the single derived-stage function every screen reads. Stages, in order:

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

Helper predicates: `awaitingDesignRouting(c)` and `awaitingFinalQc(c)`.

`calendar_status = 'UPDATED'` remains the one explicit finalization gate. Final View and Calendar read it and nothing else.

**Known drift:** the `sync_workflow_status()` trigger (migration 09) still mirrors the old parallel model — it writes `CRM_QC` when *either* content or design is submitted. Nothing in the app reads `workflow_status`, so this is cosmetic. Fixing it is a migration and has not been done.

---

## 2. Row-cross-contamination bug — root cause (RESOLVED)

**Symptom:** saving one Category row appeared to update other rows with similar values.

**It was never a query problem.** Every write path was audited and every one targets a single UUID. There is exactly one `UPDATE` statement against `campaigns` in the whole client codebase, and it is `.eq("id", id)`. Every RPC is `where id = p_campaign_id`. Three client-side causes:

1. **Stale form state across campaign switch.** `CampaignDrawer` is rendered unconditionally on every page and returns `null` internally, so its instance survives switching campaigns. `CategoryForm` seeded its state from the `campaign` prop *once* via a `useState` initialiser and never resynced. Because `load()` is async, there was always a window where `campaignId` was row B while `campaign` was still row A — so the form held A's values and wrote them to B. Correct UUID, wrong payload.
   **Fix:** drawer clears `campaign`/`qc`/`logs` before every load; `key={campaign.id}` on `CategoryForm` and `ContentForm`.

2. **Non-deterministic list order.** `listCampaigns` ordered by `launch_date` alone. Dozens of rows share a date and Postgres gives no guaranteed order for ties, so rows visibly moved after every refetch.
   **Fix:** order by `launch_date`, `launch_time`, `slot_number`, `id`.

3. **Auto-lock on save.** Saving set `category_status: 'LOCKED'` as soon as brand and offer were present, locking rows the user had not finished.
   **Fix:** saving saves; locking is a separate explicit action.

**Do not revisit this area unless a future bug specifically requires it.**

---

## 3. Category behaviour (current)

**Validation** — `src/lib/categoryValidation.ts` is the single source of truth, imported by both the grid and the drawer so they cannot drift.

- Mandatory (red asterisk, blocks Lock): **Brand, Offer, Brief, Landing Link, Expected CVR, Expected RPV**
- Optional: Sub Category, Comments, Date/Time Brief
- Numeric rule for CVR/RPV: `/^\d+(\.\d+)?$/`, validated **as a string, never parsed** — so `450.00` stays `450.00` rather than collapsing to `450`. Columns are `text`.
- Rejected examples: `2.5%`, `₹450`, `2.5.1`, `-3`, `1,000`, `2e3`
- Blanks still save as a draft. The gate is on locking, not on typing.

**Open / Lock, per row**
- Open expands that row's editor. Drafts are held in a map keyed by campaign UUID; nothing is shared between rows.
- Lock Input runs the existing `submit_category(id)` RPC — SECURITY DEFINER, role-checked, single row server-side. Sets `category_status = 'LOCKED'`, `crm_status = 'AWAITING_REVIEW'`.
- **Unlock is CRM-only**, not by UI choice: RLS policy 12 only permits CATEGORY to update rows whose `category_status` is `EMPTY`/`DRAFT`, so a Category user physically cannot reopen a locked row. The button is hidden for them rather than shown and then failing.

**Weekly working model**
- Rows are grouped by the **Monday** of their launch week (`weekStart()` in `lib/format.ts`).
- Each week card holds two buckets: **Pending from Category** and **Submitted back to CRM**.
- Per-week bulk submit locks every *complete* row in that week, one UUID at a time, skipping anything still missing a mandatory field. Rows can equally be locked one at a time.

**Inputs**
- Brand: searchable dropdown **with "+ Add new value"**. The typed value is stored as-is; `masterData.json` stays the curated list and is not written to.
- Offer: **free text** (dropdown removed — the fixed list was rejecting legitimate values).
- Date/Time Brief: `datetime-local` picker. Pre-existing free text is surfaced beside the picker rather than discarded.

**Scroll and re-render fixes**
- Saving no longer refetches. Each save patches the one row in memory from the confirmed server response. The old code called `loadData()` on every field blur, which set `loading=true` and replaced the whole table with a spinner — that was the cause of lost input, closed dropdowns, remounted rows, and scroll position jumping to the top after every field.
- The Category grid no longer uses a 1100px horizontal scroll container; the editor opens full-width beneath its own row.
- `SearchSelect` gained an opt-in `portal` prop rendering the menu into `document.body` at fixed coordinates, so it escapes `overflow-hidden` / `overflow-x-auto` ancestors. Default off, so untouched surfaces stay untouched.

---

## 4. Content behaviour (current)

- Inline rows are **functional**. They previously had `defaultValue=""` with no handler and saved nothing.
- Two buckets: **PNs with Category Input** (`is_crm_self = false`) and **CRM-Owned PNs** (`is_crm_self = true`).
- **H Count and S Count are derived** from Header and Sub Copy and are read-only. Content never types them.
- Submit: shows a spinner, disables the button, writes `content_status = 'SUBMITTED'`, and updates the UI immediately from the confirmed row. Status reads "Content Submitted".
- Content still writes directly to `campaigns`. The `content_submissions` table, the `submit_content()` RPC and `services/content.ts` remain **dead code** — a known gap, not resolved.
- RLS consequence: after submitting, policy 12 blocks CONTENT from editing again until CRM sets `NEEDS_CHANGES`.

---

## 5. Design behaviour (current)

- Two buckets by origin, same split as Content.
- **Creative Link is optional.** A batch can be sent back to CRM whether or not every row has one; previously only rows *with* a link could be sent, silently stranding the rest.
- Campaigns reach Design only after Content submits and CRM routes them onward.
- **Creative Link is the only Design field**, and it is a plain text input. Designers paste a URL to creative they host elsewhere.
- **No file upload exists anywhere in the Design flow.** The previous implementation fabricated a plausible `s3.ap-south-1.amazonaws.com/...` URL without uploading anything; it has been removed entirely, along with the file inputs, the blob preview and the `_localPreview` field. This app stores no binary assets: no S3, no Supabase Storage, no upload of any kind. Do not reintroduce one.

---

## 6. Files owned by this baseline

| File | Role |
|---|---|
| `src/lib/workflow.ts` | `stageOf()`, stage labels/order, routing predicates, QC field list, char limits |
| `src/lib/categoryValidation.ts` | all Category validation, draft↔patch mapping |
| `src/lib/format.ts` | dates, times, plus `weekStart` / `weekLabel` / `fmtWeekRange` |
| `src/services/campaigns.ts` | every campaign write; UUID guard; deterministic ordering; `lockCategoryInput`, `unlockCategoryInput`, `sendBatchToContent`, `sendBatchToDesign`, `submitContentRow`, `saveContentRow` |
| `src/components/IncomingData.tsx` | Category weekly buckets + Content origin buckets |
| `src/components/CampaignDrawer.tsx` | per-campaign detail; Category, CRM Part 2/3, Content, QC blocks |
| `src/components/CrmOwnCampaigns.tsx` | CRM's two-step routing (→ Content, then → Design) |
| `src/components/SearchSelect.tsx` | `portal` and `allowCreate` props |
| `src/app/(app)/design/page.tsx` | Design queue |

---

## 5a. CRM dashboard — the flow board (CURRENT BASELINE)

The CRM dashboard is **one reusable layout rendered six times**, in handoff order, so the chain is visually obvious:

```
CATEGORY-LED FLOW
  1. Incoming Inputs From Category   -> Bulk Send Selected to Content
  2. Incoming Inputs From Content    -> Mark Content as reviewed / Bulk Send Selected to Design
  3. Incoming Inputs From Design     -> Mark Design as reviewed / on to Final QC

CRM SELF FLOW  (is_crm_self = true; skips Category)
  1. CRM Self Upload                 -> Bulk Send Selected to Content
  2. CRM Self - Incoming From Content-> Mark Content as reviewed / Bulk Send Selected to Design
  3. CRM Self - Incoming From Design -> Mark Design as reviewed / on to Final QC
```

Every section has a Pending bucket and a Completed bucket, each with a live count, Select All plus individual checkboxes, an action disabled while nothing is selected, and explicit loading / success / real-error states.

**No new status values and no migration were introduced.** CRM's review is recorded in two fields that already existed:

| Concept | Existing field |
|---|---|
| CRM Part 2 complete | `campaigns.pn_template` is non-null |
| CRM reviewed Content | `qc_checklists.copy_verified` |
| CRM reviewed Design | `qc_checklists.creative_verified` |

`copy_verified` and `creative_verified` are two of the ten Final QC checklist fields. Ticking one on the dashboard is the same tick CRM would make in Final QC, so the board and Final QC read the same row and cannot disagree.

**Bucket conditions** live as pure functions in `src/lib/crmBuckets.ts` — the single definition both the board and the tests read.

| Bucket | Condition |
|---|---|
| Category / Pending | `category_status = LOCKED` · no `pn_template` · `content_status = NOT_ASSIGNED` |
| Category / Completed | `category_status = LOCKED` · `pn_template` set · `content_status = NOT_ASSIGNED` |
| Content / Pending | `content_status = SUBMITTED` · `design_status = NOT_ASSIGNED` · `copy_verified` false |
| Content / Completed | `content_status = SUBMITTED` · `design_status = NOT_ASSIGNED` · `copy_verified` true |
| Design / Pending | `content_status = SUBMITTED` · `design_status = SUBMITTED` · `qc_status ≠ PASSED` · `creative_verified` false |
| Design / Completed | same, `creative_verified` true — these are the rows Final QC shows |
| CRM Self Upload / Pending | `content_status = NOT_ASSIGNED` · no `pn_template` |
| CRM Self Upload / Completed | `content_status = NOT_ASSIGNED` · `pn_template` set |

The Design buckets also require `content_status = SUBMITTED`. Design is only reachable after Content submits, so this never changes which rows appear in practice — but without it a row in an impossible-but-not-prevented state would show in two buckets at once. Verified by sweep: across all 1,152 combinations of the six status columns plus both QC flags and both flow types, **no campaign appears in more than one bucket**.

Bulk actions iterate the selected ids and write one UUID per call. `CrmOwnCampaigns.tsx` was replaced by `CrmFlowBoard.tsx` and deleted.

**`src/lib/crmBuckets.ts` is the single source of truth for bucket membership.** Every condition in the table above lives there as a pure function over a campaign and its QC row. The board imports them; the tests import the same ones. Do not inline a bucket condition in a component — if a screen needs to know which bucket a campaign is in, it calls the function. A second definition anywhere is a bug waiting to happen, because the two will drift.

**Decision: review flags are never backfilled.** When this board shipped, campaigns already past Content had no `qc_checklists` row, so they surface in a Pending bucket awaiting a review tick that was not previously required. A backfill of `copy_verified` was considered and **rejected**:

- It would change nothing on the board. Content/Pending requires `design_status = NOT_ASSIGNED`, so a row already routed to Design cannot appear there; it sits in Design/Pending awaiting `creative_verified`, which is real unreviewed work.
- `copy_verified` is a Final QC checklist line. Pre-ticking it would assert that CRM reviewed copy it never saw, and that tick carries forward into Final QC.

In-flight rows landing in Pending on first load are correct. CRM reviews them. **Do not backfill `copy_verified` or `creative_verified`, now or later.**

This area is closed. Do not revisit or redesign it unless a specific bug requires it.

---

## 6a. Explicitly deferred — do not implement

**Tracking Code, CID, and Landing + Tracking URL generation are on hold by decision, not by oversight.**

A draft generator was specified (a thirteen-field concatenation of Campaign Type, Campaign Name, Channel Name, Channel Format, Segment 1, Segment 2, Category, Sub Category, Brand, Landing, Offer, Time, Date) and **rejected after review of real production examples**. The actual CID structure is built from business-defined abbreviations and codes, not from campaign names or free-text fields, so a concatenation of those fields would produce plausible-looking but wrong values.

Leave untouched until a real spec is supplied:

- `campaigns.tracking_code`
- `campaigns.cid`
- `campaigns.campaign_id_ext`
- `campaigns.landing_plus_tracking`
- `campaigns.tracking_code_check`

These remain **manual entry only** in Part 3 of the drawer. Do not auto-generate, auto-fill, validate, or derive any of them. Do not propose a format again without the abbreviation dictionary.

---

## 7. Still open (do not silently resolve)

1. ~~README contradicts the handoff.~~ **Resolved (iteration 4).** Rewritten against the actual repo: full migration list 01–13 with 03 and 07 explained, five users including DESIGN, sequential workflow, duplicated Troubleshooting and Performance sections removed, dead Recommendation-engine section removed, every referenced file verified to exist.
2. ~~Design page fabricates S3 URLs.~~ **Resolved (iteration 4).** Removed entirely; see §5.
3. Notifications write-only: `services/notifications.ts` is unimported; the bell drawer shows two hardcoded demo alerts and a hardcoded badge of 2.
4. Two content models; the documented one (`content_submissions` + `submit_content()`) is dead.
5. RLS is row-scoped, not column-scoped — CATEGORY/CONTENT/DESIGN can write any column on a permitted row; the restriction is client-side only.
6. `sync_workflow_status()` mirror now lags the sequential model.
7. Migration 11's verify query false-positives on `campaigns_calendar_slot_id_key`.
8. Orphaned legacy: `calendar_days`, `calendar_slots`, `sync_slot_status`, `types/calendar.ts`.
9. `/api/performance-analysis` is unauthenticated and unthrottled.
10. Two segment sources: `masterData.json` (77 segments, de facto authority) vs `pncc_*` tables (~30).
11. Repo has a single commit — no history, no diffs, no revert.
12. Migrations 11 and 12 have never been *confirmed* applied to `jofxdelfnyuaisdmzyuv`. Ask; don't assume.
13. `emergency_score` hardcoded to 90. Export is CSV, not binary `.xlsx`.
14. **Group ID: open decision, pending CRM confirmation.** `campaigns.group_id` has two writers. The `campaigns_sync_group` trigger (migration 04) derives it from `push_tags` on every insert or update of `push_tag`; CRM can also type it directly in Part 3. The trigger currently wins — editing Push Tag silently overwrites a manually entered Group ID. **The trigger and its priority have deliberately not been changed.** The Part 3 field carries the warning "Editing Push Tag overwrites a manually entered Group ID" so the behaviour is visible rather than surprising. Do not change the trigger, its priority, or the field until the CRM team confirms which value should win.

---

## 7a. Hotfix: Rules of Hooks (login crash)

**Symptom:** "Application error: a client-side exception has occurred" immediately on login, for every role.

**Cause:** React's Rules of Hooks were broken in three components — a `useMemo`/`useCallback` placed *below* an early `return`. The hook count therefore changed between the render where the guard was true and the render where it was false, and React threw "Rendered more hooks than during the previous render".

| File | Guard | Hook below it |
|---|---|---|
| `components/IncomingData.tsx` | `if (loading) return <Loading/>` | weekly-bucket `useMemo` + `useCallback` |
| `app/(app)/overview/page.tsx` | `if (!profile) return null` | `execPie` `useMemo` |
| `components/OpportunityMatrix.tsx` | `if (available.length === 0) return null` | `classified` `useMemo` |

The overview one fires on every login, because `profile` is null on the first render after sign-in and set on the next. All three hooks were moved above their guards.

**Why neither `tsc` nor `next build` caught it:** this is a runtime rule, not a type or compile error, and the test suites cover pure functions rather than component renders.

**The guard against it recurring:** `.eslintrc.json` now enables `react-hooks/rules-of-hooks` as an **error**, and `next build` runs lint, so this class of bug now fails the build rather than reaching production. `eslint` and `eslint-config-next` were added as devDependencies — **`npm install` is required** after pulling. Four pre-existing unescaped-apostrophe lint errors were fixed at the same time, since enabling lint would otherwise have broken the build.

**Do not move a hook below a conditional return.** Every hook runs on every render, or React crashes.

---

## 8. Working agreements

- Propose before building anything non-trivial; wait for explicit go-ahead.
- Prefer deleting over adding. Smallest change that explains the symptom.
- No validation layers, safety nets, or pre-flight checks that weren't asked for.
- Say "I don't know, here's how to find out" rather than asserting anything about a system that can't be seen.
- Scope discipline: do not touch Performance, Audiences (`/segments`), exports, tracking-code logic, or the CRM Self upload flow without an explicit request.
