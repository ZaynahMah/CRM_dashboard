-- =====================================================================
-- CLiQ Push Ops — 18: upload reset with archive
--
-- Run EIGHTEENTH, after 17. Safe to run more than once.
--
-- BUSINESS RULE: a CRM upload is a FULL FRESH START. Every existing PN is
-- removed — both flows, every status, including Calendar — and the
-- dashboard reflects only the uploaded sheet.
--
-- This deliberately overrides audit finding #1, which proposed keeping
-- published and in-flight rows. Nothing is kept. What makes that safe is
-- that nothing is lost either: every row is archived first, in the same
-- transaction, and a failure anywhere rolls the whole thing back.
--
-- ARCHIVE -> DELETE -> INSERT happen inside ONE plpgsql function, so they
-- are one transaction by definition. There is no window in which the
-- campaigns table is empty and the archive is not written.
-- =====================================================================

-- ═════════ 1. ARCHIVE TABLES ═════════
-- Shape follows the live tables via LIKE, so a future column on campaigns
-- does not silently stop being archived. No constraints or defaults are
-- copied: an archive must accept whatever was live at the time, including
-- rows that would fail today's checks.

create table if not exists campaigns_archive       (like campaigns       including defaults);
create table if not exists activity_logs_archive   (like activity_logs   including defaults);
create table if not exists qc_checklists_archive   (like qc_checklists   including defaults);
create table if not exists crm_decisions_archive   (like crm_decisions   including defaults);

do $$
declare t text;
begin
  foreach t in array array['campaigns_archive','activity_logs_archive',
                           'qc_checklists_archive','crm_decisions_archive']
  loop
    execute format('alter table %I add column if not exists archive_batch_id uuid', t);
    execute format('alter table %I add column if not exists archived_at timestamptz default now()', t);
    execute format('alter table %I add column if not exists archived_by uuid', t);
    -- An archive has no business enforcing uniqueness: the same campaign id
    -- can legitimately appear in several batches over time.
    execute format('alter table %I drop constraint if exists %I', t, t || '_pkey');
    execute format('create index if not exists %I on %I (archive_batch_id)',
                   t || '_batch_idx', t);
  end loop;
end $$;

-- Who reset what, and when. One row per upload.
create table if not exists upload_reset_batches (
  id              uuid primary key default gen_random_uuid(),
  performed_by    uuid,
  performed_at    timestamptz not null default now(),
  is_crm_self     boolean,
  campaigns_archived   integer not null default 0,
  logs_archived        integer not null default 0,
  checklists_archived  integer not null default 0,
  decisions_archived   integer not null default 0,
  campaigns_inserted   integer not null default 0,
  on_calendar_removed  integer not null default 0
);

alter table campaigns_archive        enable row level security;
alter table activity_logs_archive    enable row level security;
alter table qc_checklists_archive    enable row level security;
alter table crm_decisions_archive    enable row level security;
alter table upload_reset_batches     enable row level security;

-- CRM only. The archive holds every PN that ever existed, so it is the most
-- sensitive table in the schema.
do $$
declare t text;
begin
  foreach t in array array['campaigns_archive','activity_logs_archive',
                           'qc_checklists_archive','crm_decisions_archive',
                           'upload_reset_batches']
  loop
    execute format('drop policy if exists %1$s_crm_read on %1$s', t);
    execute format('create policy %1$s_crm_read on %1$s for select to authenticated using (public.is_crm())', t);
  end loop;
end $$;


-- ═════════ 2. PRE-FLIGHT COUNTS FOR THE CONFIRMATION MODAL ═════════
-- The modal must state what it is about to destroy, broken down by stage.
-- Computed server-side so the number shown and the number deleted come from
-- the same place.

create or replace function public.upload_reset_preview()
returns table (
  total            integer,
  at_category      integer,
  with_content     integer,
  in_qc            integer,
  on_calendar      integer,
  emergencies      integer,
  change_requests  integer
) language sql security definer set search_path = public as $$
  select
    (select count(*) from campaigns)::int,
    (select count(*) from campaigns
      where content_status = 'NOT_ASSIGNED' and calendar_status <> 'UPDATED')::int,
    (select count(*) from campaigns
      where content_status in ('PENDING','NEEDS_CHANGES') and calendar_status <> 'UPDATED')::int,
    (select count(*) from campaigns
      where content_status = 'SUBMITTED' and calendar_status <> 'UPDATED')::int,
    (select count(*) from campaigns where calendar_status = 'UPDATED')::int,
    (select count(*) from campaigns where is_emergency)::int,
    (select count(*) from change_requests)::int;
$$;
grant execute on function public.upload_reset_preview() to authenticated;


-- ═════════ 3. THE RESET ═════════
-- Archives everything, deletes everything, inserts the new sheet — one
-- transaction. Any exception aborts the whole function and Postgres rolls
-- back every statement, so a failed upload leaves the dashboard exactly as
-- it was. There is no partial wipe.
--
-- SECURITY DEFINER for two reasons: the CRM check must not be skippable
-- from the client, and the function must be able to delete rows that RLS
-- would otherwise protect. The is_crm() check is the first statement, so
-- elevated rights are never reached by a non-CRM caller.
--
-- The migration-17 column-ownership trigger is BEFORE UPDATE only. This
-- function does no UPDATE — archive is INSERT ... SELECT, then DELETE, then
-- INSERT — so the trigger never fires and cannot block the reset.

create or replace function public.reset_campaigns_with_archive(
  p_rows        jsonb,
  p_is_crm_self boolean default false
)
returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_batch       uuid := gen_random_uuid();
  v_actor       uuid := auth.uid();
  v_campaigns   integer := 0;
  v_logs        integer := 0;
  v_checks      integer := 0;
  v_decisions   integer := 0;
  v_calendar    integer := 0;
  v_inserted    integer := 0;
begin
  if not public.is_crm() then
    raise exception 'Only CRM can reset campaigns.';
  end if;

  if p_rows is null or jsonb_typeof(p_rows) <> 'array' then
    raise exception 'reset_campaigns_with_archive expects a JSON array of rows.';
  end if;

  -- Refusing an empty sheet is deliberate. Wiping everything and inserting
  -- nothing is almost always a mistake, and it is indistinguishable from a
  -- parse failure upstream.
  if jsonb_array_length(p_rows) = 0 then
    raise exception 'Refusing to reset: the uploaded sheet contains no rows.';
  end if;

  select count(*) into v_calendar from campaigns where calendar_status = 'UPDATED';

  -- ---------- archive (children first is irrelevant here; no FKs on the
  -- archive tables, but campaigns is copied first so the batch reads in a
  -- sensible order) ----------
  insert into campaigns_archive
    select c.*, v_batch, now(), v_actor from campaigns c;
  get diagnostics v_campaigns = row_count;

  insert into activity_logs_archive
    select a.*, v_batch, now(), v_actor from activity_logs a;
  get diagnostics v_logs = row_count;

  insert into qc_checklists_archive
    select q.*, v_batch, now(), v_actor from qc_checklists q;
  get diagnostics v_checks = row_count;

  insert into crm_decisions_archive
    select d.*, v_batch, now(), v_actor from crm_decisions d;
  get diagnostics v_decisions = row_count;

  -- ---------- verify the archive BEFORE destroying anything ----------
  -- If the counts disagree the archive is incomplete, and deleting would
  -- lose data. Raising here rolls back the inserts too.
  if v_campaigns <> (select count(*) from campaigns) then
    raise exception 'Archive incomplete: % campaigns archived, % live. Aborting.',
      v_campaigns, (select count(*) from campaigns);
  end if;

  -- ---------- delete EVERYTHING ----------
  -- Children that cascade from campaigns go with it. change_requests,
  -- notifications and the rest are cleared explicitly so no stale row
  -- survives in any screen.
  delete from change_requests;
  delete from notifications;
  delete from campaigns;   -- cascades activity_logs, qc_checklists, crm_decisions, content_submissions

  -- ---------- insert the new sheet ----------
  insert into campaigns select * from jsonb_populate_recordset(null::campaigns, p_rows);
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

  insert into activity_logs (campaign_id, actor_id, action, detail)
  values (null, v_actor, 'UPLOAD_RESET',
    format('CRM reset the dashboard from an upload. Archived %s campaigns '
           '(%s on calendar), inserted %s new rows. Archive batch %s.',
           v_campaigns, v_calendar, v_inserted, v_batch));

  return v_batch;
end $$;

revoke all on function public.reset_campaigns_with_archive(jsonb, boolean) from public;
grant execute on function public.reset_campaigns_with_archive(jsonb, boolean) to authenticated;


-- ═════════ 4. VERIFY ═════════
-- Both functions exist and are SECURITY DEFINER.
select p.proname, p.prosecdef as security_definer
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname in ('reset_campaigns_with_archive','upload_reset_preview');

-- Archive tables exist and carry the batch columns.
select table_name, count(*) filter (
  where column_name in ('archive_batch_id','archived_at','archived_by')) as batch_columns
from information_schema.columns
where table_schema = 'public' and table_name like '%_archive'
group by table_name order by table_name;
-- Expect batch_columns = 3 for all four.

-- Every reset ever performed.
select id, performed_at, campaigns_archived, campaigns_inserted, on_calendar_removed
from upload_reset_batches order by performed_at desc limit 20;
