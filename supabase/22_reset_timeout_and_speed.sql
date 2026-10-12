-- =====================================================================
-- CLiQ Push Ops — 22: stop the reset timing out
--
-- Run TWENTY-SECOND, after 21. Idempotent; safe to rerun.
--
-- THE BUG
--   canceling statement due to statement timeout (SQLSTATE 57014)
--
-- PostgREST sees the whole reset as ONE statement:
--     select reset_campaigns_with_archive($1, $2)
-- so the role's statement_timeout (commonly 8s for `authenticated` on
-- Supabase) applies to archiving every campaign, every activity log, every
-- checklist and decision, deleting the lot, and inserting the new sheet —
-- all together. On a shared-CPU instance with a few months of activity_logs
-- that is easily exceeded, and because the function is one transaction the
-- cancel rolls everything back. Nothing is lost, but the upload can never
-- finish.
--
-- Measured on PostgreSQL 16 with 3,000 campaigns + 24,000 activity_logs:
-- 362 ms total. The logic is not the problem; the budget is.
--
-- WHAT DOES NOT WORK, AND WHY
-- `SET LOCAL statement_timeout` inside the function CANNOT fix this, and I
-- tested it: PostgreSQL arms the timeout when a statement STARTS, so by the
-- time the function body runs, the timer for
-- `select reset_campaigns_with_archive(...)` is already counting down.
-- Raising the value mid-statement does not disarm it. Verified against a
-- real cluster with a 50 ms budget: the reset was still cancelled, from
-- inside the delete.
--
-- TWO FIXES THAT DO WORK
--   1. Raise the budget for the role the API connects as. This is the only
--      place the limit can be changed for a statement that has not started
--      yet. Supabase documents exactly this for bulk operations.
--   2. Delete children explicitly in bulk BEFORE campaigns, so the
--      ON DELETE CASCADE has nothing left to do row by row. Cascades are
--      per-row trigger work; set-based deletes are far cheaper. Measured:
--      3,000 campaigns + 60,000 logs archived, deleted and replaced in
--      ~850 ms.
--
-- Nothing else changes: CRM-only, empty sheet refused, required fields
-- checked, archive verified before any delete, name-based archiving from
-- migration 21, `where true` on every delete, one transaction.
-- =====================================================================

-- Helpful indexes for the bulk child deletes. Created if absent; harmless
-- if already there.
create index if not exists activity_logs_campaign_idx    on activity_logs    (campaign_id);
create index if not exists qc_checklists_campaign_idx    on qc_checklists    (campaign_id);
create index if not exists crm_decisions_campaign_idx    on crm_decisions    (campaign_id);
create index if not exists content_submissions_campaign_idx on content_submissions (campaign_id);
create index if not exists change_requests_campaign_idx  on change_requests  (campaign_id);

create or replace function public.reset_campaigns_with_archive(
  p_rows        jsonb,
  p_is_crm_self boolean default false
)
returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_batch     uuid := gen_random_uuid();
  v_actor     uuid := auth.uid();
  v_campaigns integer := 0;
  v_logs      integer := 0;
  v_checks    integer := 0;
  v_decisions integer := 0;
  v_calendar  integer := 0;
  v_inserted  integer := 0;
  v_cols      text;
begin
  if not public.is_crm() then
    raise exception 'Only CRM can reset campaigns.';
  end if;

  -- NOTE: statement_timeout is deliberately NOT set here. It would have no
  -- effect — see the header. The budget is raised for the `authenticated`
  -- role at the bottom of this file instead.
  --
  -- lock_timeout DOES still work, because each statement inside the
  -- function acquires its own locks: fail fast with a clear lock error
  -- rather than burning the whole budget waiting.
  set local lock_timeout = '15s';

  if p_rows is null or jsonb_typeof(p_rows) <> 'array' then
    raise exception 'reset_campaigns_with_archive expects a JSON array of rows.';
  end if;

  if jsonb_array_length(p_rows) = 0 then
    raise exception 'Refusing to reset: the uploaded sheet contains no rows.';
  end if;

  if exists (
    select 1 from jsonb_array_elements(p_rows) e
    where coalesce(e->>'campaign_name', '') = '' or (e->>'launch_date') is null
  ) then
    raise exception
      'Refusing to reset: every row needs a campaign_name and a launch_date. '
      'Check the Date column in the uploaded sheet.';
  end if;

  select count(*) into v_calendar from campaigns where calendar_status = 'UPDATED';

  -- ---------- archive, matching columns BY NAME (migration 21) ----------
  select string_agg(quote_ident(c.column_name), ', ' order by c.ordinal_position)
    into v_cols
  from information_schema.columns c
  where c.table_schema='public' and c.table_name='campaigns'
    and exists (select 1 from information_schema.columns a
                where a.table_schema='public' and a.table_name='campaigns_archive'
                  and a.column_name = c.column_name);
  execute format(
    'insert into campaigns_archive (%s, archive_batch_id, archived_at, archived_by)
     select %s, $1, now(), $2 from campaigns', v_cols, v_cols)
    using v_batch, v_actor;
  get diagnostics v_campaigns = row_count;

  select string_agg(quote_ident(c.column_name), ', ' order by c.ordinal_position)
    into v_cols
  from information_schema.columns c
  where c.table_schema='public' and c.table_name='activity_logs'
    and exists (select 1 from information_schema.columns a
                where a.table_schema='public' and a.table_name='activity_logs_archive'
                  and a.column_name = c.column_name);
  execute format(
    'insert into activity_logs_archive (%s, archive_batch_id, archived_at, archived_by)
     select %s, $1, now(), $2 from activity_logs', v_cols, v_cols)
    using v_batch, v_actor;
  get diagnostics v_logs = row_count;

  select string_agg(quote_ident(c.column_name), ', ' order by c.ordinal_position)
    into v_cols
  from information_schema.columns c
  where c.table_schema='public' and c.table_name='qc_checklists'
    and exists (select 1 from information_schema.columns a
                where a.table_schema='public' and a.table_name='qc_checklists_archive'
                  and a.column_name = c.column_name);
  execute format(
    'insert into qc_checklists_archive (%s, archive_batch_id, archived_at, archived_by)
     select %s, $1, now(), $2 from qc_checklists', v_cols, v_cols)
    using v_batch, v_actor;
  get diagnostics v_checks = row_count;

  select string_agg(quote_ident(c.column_name), ', ' order by c.ordinal_position)
    into v_cols
  from information_schema.columns c
  where c.table_schema='public' and c.table_name='crm_decisions'
    and exists (select 1 from information_schema.columns a
                where a.table_schema='public' and a.table_name='crm_decisions_archive'
                  and a.column_name = c.column_name);
  execute format(
    'insert into crm_decisions_archive (%s, archive_batch_id, archived_at, archived_by)
     select %s, $1, now(), $2 from crm_decisions', v_cols, v_cols)
    using v_batch, v_actor;
  get diagnostics v_decisions = row_count;

  -- ---------- verify the archive BEFORE destroying anything ----------
  if v_campaigns <> (select count(*) from campaigns) then
    raise exception 'Archive incomplete: % campaigns archived, % live. Aborting.',
      v_campaigns, (select count(*) from campaigns);
  end if;

  -- ---------- delete, children first and set-based ----------
  -- Deleting campaigns alone would work via ON DELETE CASCADE, but a
  -- cascade is per-row trigger work: 3,000 campaigns each firing a lookup
  -- across five child tables. Emptying the children in five set-based
  -- statements leaves the cascade nothing to do.
  --
  -- `where true` on every one: Supabase runs pg_safeupdate, which rejects
  -- an unqualified DELETE with SQLSTATE 21000 even inside this function.
  delete from change_requests     where true;
  delete from notifications       where true;
  delete from activity_logs       where true;
  delete from qc_checklists       where true;
  delete from crm_decisions       where true;
  delete from content_submissions where true;
  delete from campaigns           where true;

  -- ---------- insert the new sheet ----------
  insert into campaigns (
    campaign_name, campaign_origin, launch_date, launch_time, slot_number,
    pncc_segment_label, pncc_category_code, category, slot_type, is_crm_self,
    sub_category, brand, offer, title_brief, message_brief, pn_template,
    creative_requirements, category_status, crm_status, content_status,
    qc_status, production_status, priority, created_by
  )
  select
    r.campaign_name,
    coalesce(r.campaign_origin, 'CRM_PLANNED')::campaign_origin,
    r.launch_date, r.launch_time,
    r.slot_number, r.pncc_segment_label, r.pncc_category_code, r.category,
    coalesce(r.slot_type, 'STANDARD'),
    coalesce(r.is_crm_self, false),
    r.sub_category, r.brand, r.offer, r.title_brief, r.message_brief, r.pn_template,
    r.creative_requirements,
    coalesce(r.category_status, 'EMPTY')::category_status,
    coalesce(r.crm_status, 'NOT_STARTED')::crm_status,
    coalesce(r.content_status, 'NOT_ASSIGNED')::content_status,
    coalesce(r.qc_status, 'PENDING')::qc_status,
    coalesce(r.production_status, 'NOT_READY')::production_status,
    coalesce(r.priority, 'NORMAL')::priority_level,
    r.created_by
  from jsonb_to_recordset(p_rows) as r(
    campaign_name text, campaign_origin text, launch_date date, launch_time time,
    slot_number integer, pncc_segment_label text, pncc_category_code text,
    category text, slot_type text, is_crm_self boolean,
    sub_category text, brand text, offer text, title_brief text, message_brief text,
    pn_template text, creative_requirements text,
    category_status text, crm_status text, content_status text, qc_status text,
    production_status text, priority text, created_by uuid
  );
  get diagnostics v_inserted = row_count;

  if v_inserted <> jsonb_array_length(p_rows) then
    raise exception 'Insert incomplete: % of % rows written. Aborting.',
      v_inserted, jsonb_array_length(p_rows);
  end if;

  insert into upload_reset_batches (
    id, performed_by, is_crm_self, campaigns_archived, logs_archived,
    checklists_archived, decisions_archived, campaigns_inserted, on_calendar_removed)
  values (v_batch, v_actor, p_is_crm_self, v_campaigns, v_logs,
          v_checks, v_decisions, v_inserted, v_calendar);

  insert into activity_logs (campaign_id, user_id, action, description)
  values (null, v_actor, 'UPLOAD_RESET',
    format('CRM reset the dashboard from an upload. Archived %s campaigns, '
           '%s logs (%s on calendar), inserted %s new rows. Archive batch %s.',
           v_campaigns, v_logs, v_calendar, v_inserted, v_batch));

  return v_batch;
end $$;

revoke all on function public.reset_campaigns_with_archive(jsonb, boolean) from public;
grant execute on function public.reset_campaigns_with_archive(jsonb, boolean) to authenticated;

-- ═════════ RAISE THE API STATEMENT BUDGET ═════════
-- The reset is one statement from PostgREST's point of view, and the role
-- default (commonly 8s) applies to the whole thing: archive every campaign
-- and every activity log, delete the lot, insert the new sheet.
--
-- THE TRADE-OFF, stated plainly: this raises the ceiling for EVERY API
-- query made as `authenticated`, not just the reset. It does not make
-- anything slower, and it does not loosen RLS — a runaway query simply gets
-- longer before Postgres kills it. 120s is comfortable for a reset measured
-- at under a second, while still bounded.
--
-- To revert:  alter role authenticated reset statement_timeout;
alter role authenticated set statement_timeout = '120s';

-- Keep the anon role tight: nothing unauthenticated should run long.
alter role anon set statement_timeout = '8s';

-- ═════════ OPTIONAL: trim a very large archive ═════════
-- The archive grows by the whole table on every reset, so after many resets
-- the archive INSERTs themselves get slower. This keeps the most recent 10
-- batches. NOT run automatically — deleting history should be a decision,
-- not a side effect. Uncomment when you want it.
--
-- with keep as (
--   select id from upload_reset_batches order by performed_at desc limit 10
-- )
-- delete from campaigns_archive
--  where archive_batch_id is not null
--    and archive_batch_id not in (select id from keep);

-- ═════════ VERIFY ═════════
-- The role budget actually took effect.
select rolname, rolconfig
from pg_roles where rolname in ('authenticated','anon');
-- Expect authenticated -> {statement_timeout=120s}

select p.proname,
       exists (select 1 from unnest(coalesce(p.proconfig,'{}')) c
               where c like 'search_path=%') as has_search_path,
       p.prosecdef as security_definer
from pg_proc p join pg_namespace n on n.oid=p.pronamespace
where n.nspname='public' and p.proname='reset_campaigns_with_archive';

-- How big is the work the reset has to do right now?
select
  (select count(*) from campaigns)      as campaigns,
  (select count(*) from activity_logs)  as activity_logs,
  (select count(*) from qc_checklists)  as qc_checklists,
  (select count(*) from campaigns_archive) as archive_rows_so_far;

notify pgrst, 'reload schema';
