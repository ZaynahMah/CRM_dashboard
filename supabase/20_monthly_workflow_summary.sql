-- =====================================================================
-- CLiQ Push Ops — 20: shared monthly workflow summary
--
-- Run TWENTIETH, after 19. Safe to run more than once.
--
-- WHY A FUNCTION AND NOT A CLIENT QUERY
-- Every role must see IDENTICAL numbers in "Monthly workflow — per team".
-- Migration 17 scoped reads per role: CONTENT cannot read a PN CRM has not
-- sent, CATEGORY cannot read CRM Self rows. A client-side count would
-- therefore differ per login — which is exactly the bug this fixes.
--
-- SECURITY DEFINER lets the counts span the full table. It returns COUNTS
-- ONLY, never row data, so no role learns anything it should not: a total
-- is not a leak, a row is.
--
-- Column names verified against 01_schema.sql and migrations 14-19.
-- Content is the only production team; design_status is not read.
-- =====================================================================

create or replace function public.monthly_workflow_summary()
returns table (
  total                integer,
  awaiting_category    integer,
  crm_review           integer,
  crm_ready            integer,
  with_content         integer,
  content_submitted    integer,
  crm_reviewed         integer,
  final_qc             integer,
  on_calendar          integer,
  emergencies          integer,
  crm_self             integer,
  category_led         integer
)
language sql
security definer
set search_path = public
stable
as $$
  with c as (
    -- copy_verified is how CRM records "I have reviewed Content's copy"
    -- (migration 17 / crmBuckets.ts). Joined here so the summary and the
    -- dashboard buckets agree.
    select
      ca.*,
      coalesce(q.copy_verified, false) as copy_reviewed
    from campaigns ca
    left join qc_checklists q on q.campaign_id = ca.id
  )
  select
    count(*)::int,
    -- These three partition every unrouted, live row EXACTLY ONCE. Keep in
    -- step with summariseLocally() in src/lib/monthlyWorkflow.ts.
    count(*) filter (
      where calendar_status <> 'UPDATED' and qc_status <> 'PASSED'
        and content_status = 'NOT_ASSIGNED'
        and not is_crm_self and category_status <> 'LOCKED')::int,
    count(*) filter (
      where calendar_status <> 'UPDATED' and qc_status <> 'PASSED'
        and content_status = 'NOT_ASSIGNED' and pn_template is null
        and (is_crm_self or category_status = 'LOCKED'))::int,
    count(*) filter (
      where calendar_status <> 'UPDATED' and qc_status <> 'PASSED'
        and content_status = 'NOT_ASSIGNED' and pn_template is not null)::int,
    count(*) filter (
      where calendar_status <> 'UPDATED' and qc_status <> 'PASSED'
        and content_status in ('PENDING', 'NEEDS_CHANGES'))::int,
    count(*) filter (
      where calendar_status <> 'UPDATED' and qc_status <> 'PASSED'
        and content_status = 'SUBMITTED' and not copy_reviewed)::int,
    count(*) filter (
      where calendar_status <> 'UPDATED' and qc_status <> 'PASSED'
        and content_status = 'SUBMITTED' and copy_reviewed)::int,
    count(*) filter (where qc_status = 'PASSED' and calendar_status <> 'UPDATED')::int,
    count(*) filter (where calendar_status = 'UPDATED')::int,
    count(*) filter (where is_emergency)::int,
    count(*) filter (where is_crm_self)::int,
    count(*) filter (where not is_crm_self)::int
  from c;
$$;

-- All four roles. The function returns counts only.
revoke all on function public.monthly_workflow_summary() from public;
grant execute on function public.monthly_workflow_summary() to authenticated;

-- ───────── VERIFY ─────────
select p.proname, p.prosecdef as security_definer,
       exists (select 1 from unnest(coalesce(p.proconfig,'{}')) cfg
               where cfg like 'search_path=%') as has_search_path
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.proname = 'monthly_workflow_summary';
-- Expect one row: security_definer = true, has_search_path = true.

select * from public.monthly_workflow_summary();
-- The stage counts plus on_calendar should add up to total. Any PN counted
-- in no column is an orphan; any counted twice is an overlap.

-- =====================================================================
-- PART 2: reset signal for every open session
--
-- After a reset, other logged-in users kept seeing old rows until they
-- refreshed. Two reasons: a mass DELETE does not reliably deliver one
-- realtime event per row, and migration 18's `upload_reset_batches` is
-- readable by CRM only (its RLS uses is_crm()) — realtime respects RLS, so
-- Category, Content and Executive would never receive the signal.
--
-- `reset_events` is therefore a small, readable-by-everyone broadcast table.
-- Migration 18 is NOT modified: a trigger on upload_reset_batches writes
-- the event, so the signal is emitted server-side on every reset however it
-- was triggered.
--
-- It carries no campaign data — just "a reset happened, at this time".
-- =====================================================================

create table if not exists reset_events (
  id           uuid primary key default gen_random_uuid(),
  batch_id     uuid,
  performed_by uuid,
  performed_at timestamptz not null default now(),
  row_count    integer
);

create index if not exists reset_events_time_idx on reset_events (performed_at desc);

alter table reset_events enable row level security;

-- Every role must receive this, so every role must be able to read it.
-- It contains counts and timestamps only.
drop policy if exists reset_events_read on reset_events;
create policy reset_events_read on reset_events
  for select to authenticated using (true);

-- No client writes it; the trigger does, and the trigger runs as the table
-- owner. Without an INSERT policy, a client attempting to forge a reset
-- signal is refused.

create or replace function public.emit_reset_event()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into reset_events (batch_id, performed_by, row_count)
  values (new.id, new.performed_by, new.campaigns_inserted);
  return new;
end $$;

drop trigger if exists upload_reset_broadcast on upload_reset_batches;
create trigger upload_reset_broadcast
  after insert on upload_reset_batches
  for each row execute function public.emit_reset_event();

-- Realtime must publish this table or no session is notified. Idempotent:
-- adding a table already in the publication raises, so it is guarded.
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public' and tablename = 'reset_events'
  ) then
    execute 'alter publication supabase_realtime add table reset_events';
  end if;
exception when undefined_object then
  -- No supabase_realtime publication in this environment; nothing to do.
  null;
end $$;

-- ───────── VERIFY PART 2 ─────────
select 'reset_events missing' as problem
where not exists (select 1 from information_schema.tables
                  where table_schema='public' and table_name='reset_events')
union all
select 'broadcast trigger missing'
where not exists (select 1 from pg_trigger
                  where tgrelid='public.upload_reset_batches'::regclass
                    and tgname='upload_reset_broadcast')
union all
select 'reset_events not published to realtime'
where not exists (select 1 from pg_publication_tables
                  where pubname='supabase_realtime' and schemaname='public'
                    and tablename='reset_events');
-- Zero rows = every session will be notified.

notify pgrst, 'reload schema';
