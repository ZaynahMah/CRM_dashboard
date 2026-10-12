-- =====================================================================
-- CLiQ Push Ops — 24: Category SLA, Activities and shared Notifications
--
-- Run TWENTY-FOURTH, after 23. Idempotent; safe to rerun.
--
-- THE ONE DEADLINE RULE
--     deadline = business week START - 7 days
-- Business weeks are calendar buckets: 1-7, 8-14, 15-21, 22-28, 29-end.
-- Mirrors src/lib/businessWeeks.ts exactly; the two are kept in step by
-- scripts/db-qc-sla.sql, which checks both against the same dates.
--
-- SLA PROGRESSION — a missed deadline escalates before it defaults, so a
-- category is not condemned the moment the clock ticks over:
--     day 0 OVERDUE, day 1 REMINDER, day 2 ESCALATION, day 3+ DEFAULTED
--
-- ACTIVITIES AND NOTIFICATIONS ARE SEPARATE SYSTEMS, by requirement.
--   activities          — an operational event log, what happened and when
--   system_notifications— what people should be told, shared by all roles
-- They are not views of each other and neither reuses the existing
-- `notifications` table, which stays exactly as it is.
--
-- NOTHING HERE BLOCKS CAMPAIGN MOVEMENT. No trigger on campaigns, no
-- status column added, no policy changed. A default is recorded, surfaced
-- and escalated; it never stops work.
-- =====================================================================

-- ═════════ 1. SLA STATE: one row per category per business week ═════════
create table if not exists category_sla (
  id                 uuid primary key default gen_random_uuid(),
  -- "2026-11-W1"
  week_key           text not null,
  week_start         date not null,
  week_end           date not null,
  -- week_start - 7. Stored, not derived at read time, so a historical row
  -- keeps the deadline it was actually judged against.
  deadline           date not null,
  category           text not null,
  pn_count           integer not null default 0,
  submitted_count    integer not null default 0,
  -- SUBMITTED_ON_TIME | DUE_SOON | ON_TRACK | OVERDUE | REMINDER
  -- | ESCALATION | DEFAULTED | CRM_FILLED_AFTER_DEFAULT
  status             text not null default 'ON_TRACK',
  submitted_at       timestamptz,
  defaulted_at       timestamptz,
  crm_filled_by      uuid references profiles(id),
  crm_filled_at      timestamptz,
  last_evaluated_at  timestamptz not null default now(),
  unique (week_key, category)
);
create index if not exists category_sla_week_idx     on category_sla (week_start desc);
create index if not exists category_sla_status_idx   on category_sla (status);
create index if not exists category_sla_deadline_idx on category_sla (deadline);

-- ═════════ 2. ACTIVITIES — the operational event log ═════════
create table if not exists activities (
  id          uuid primary key default gen_random_uuid(),
  occurred_at timestamptz not null default now(),
  -- DEFAULT | OVERDUE | CRM_OVERRIDE | SUBMITTED_ON_TIME | DUE_SOON
  -- | REMINDER | ESCALATION
  event_type  text not null,
  category    text,
  week_key    text,
  details     text not null,
  actor_id    uuid references profiles(id),
  -- Lets the nightly job avoid writing the same event twice.
  dedupe_key  text unique
);
create index if not exists activities_time_idx  on activities (occurred_at desc);
create index if not exists activities_type_idx  on activities (event_type);

-- ═════════ 3. SYSTEM NOTIFICATIONS — shared by every role ═════════
-- Deliberately NOT the existing `notifications` table, which is per-role
-- and reserved for workflow assignments. These are system-wide: every role
-- sees the same list.
create table if not exists system_notifications (
  id          uuid primary key default gen_random_uuid(),
  created_at  timestamptz not null default now(),
  -- DEADLINE_SOON | DEADLINE_MISSED | CRM_OVERRIDE | SUBMITTED_EARLY
  kind        text not null,
  title       text not null,
  body        text not null,
  category    text,
  week_key    text,
  dedupe_key  text unique
);
create index if not exists system_notifications_time_idx on system_notifications (created_at desc);

-- Read state is per person, so one user dismissing does not hide it for all.
create table if not exists system_notification_reads (
  notification_id uuid not null references system_notifications(id) on delete cascade,
  profile_id      uuid not null references profiles(id) on delete cascade,
  read_at         timestamptz not null default now(),
  primary key (notification_id, profile_id)
);

-- ═════════ 4. RLS ═════════
alter table category_sla              enable row level security;
alter table activities                enable row level security;
alter table system_notifications      enable row level security;
alter table system_notification_reads enable row level security;

-- Everyone reads: the SLA must be "visible to everyone" by requirement.
do $$
declare t text;
begin
  foreach t in array array['category_sla','activities','system_notifications']
  loop
    execute format('drop policy if exists %1$s_read on %1$s', t);
    execute format('create policy %1$s_read on %1$s for select to authenticated using (true)', t);
  end loop;
end $$;

-- Only CRM may record an override; the nightly job runs SECURITY DEFINER.
drop policy if exists category_sla_crm_write on category_sla;
create policy category_sla_crm_write on category_sla for update to authenticated
  using (public.is_crm()) with check (public.is_crm());

-- A person manages only their own read marks.
drop policy if exists notif_reads_own on system_notification_reads;
create policy notif_reads_own on system_notification_reads for all to authenticated
  using (profile_id = auth.uid()) with check (profile_id = auth.uid());

-- ═════════ 5. THE WEEK FUNCTIONS (mirror of businessWeeks.ts) ═════════
create or replace function public.business_week_start(p_date date)
returns date language sql immutable set search_path = public as $$
  select make_date(
    extract(year from p_date)::int,
    extract(month from p_date)::int,
    case
      when extract(day from p_date) >= 29 then 29
      when extract(day from p_date) >= 22 then 22
      when extract(day from p_date) >= 15 then 15
      when extract(day from p_date) >= 8  then 8
      else 1
    end)
$$;

create or replace function public.business_week_end(p_date date)
returns date language sql immutable set search_path = public as $$
  select least(
    case when extract(day from public.business_week_start(p_date)) = 29
         then (date_trunc('month', p_date) + interval '1 month - 1 day')::date
         else public.business_week_start(p_date) + 6 end,
    (date_trunc('month', p_date) + interval '1 month - 1 day')::date)
$$;

create or replace function public.business_week_key(p_date date)
returns text language sql immutable set search_path = public as $$
  select to_char(p_date, 'YYYY-MM') || '-W' ||
    case
      when extract(day from p_date) >= 29 then '5'
      when extract(day from p_date) >= 22 then '4'
      when extract(day from p_date) >= 15 then '3'
      when extract(day from p_date) >= 8  then '2'
      else '1'
    end
$$;

-- THE deadline rule, in one place.
create or replace function public.category_week_deadline(p_date date)
returns date language sql immutable set search_path = public as $$
  select public.business_week_start(p_date) - 7
$$;

-- ═════════ 6. THE NIGHTLY JOB ═════════
-- Rebuilds category_sla from campaigns, then writes the activities and
-- notifications the new states imply. Idempotent: dedupe_key stops the same
-- event being written twice, so running it hourly or re-running it by hand
-- is harmless.
create or replace function public.recalculate_category_sla(p_as_of date default current_date)
returns integer language plpgsql security definer set search_path = public as $$
declare
  v_rows integer := 0;
  r record;
  v_status text;
  v_past integer;
begin
  -- One row per (business week, category) present in campaigns.
  insert into category_sla (week_key, week_start, week_end, deadline, category,
                            pn_count, submitted_count)
  select
    public.business_week_key(c.launch_date),
    public.business_week_start(c.launch_date),
    public.business_week_end(c.launch_date),
    public.category_week_deadline(c.launch_date),
    coalesce(nullif(btrim(c.category), ''), 'Uncategorised'),
    count(*),
    count(*) filter (where c.category_status in ('LOCKED','SUBMITTED'))
  from campaigns c
  group by 1,2,3,4,5
  on conflict (week_key, category) do update
    set pn_count        = excluded.pn_count,
        submitted_count = excluded.submitted_count,
        week_start      = excluded.week_start,
        week_end        = excluded.week_end,
        deadline        = excluded.deadline;

  -- Status for each row. Mirrors slaStatus() in businessWeeks.ts.
  for r in select * from category_sla loop
    v_past := p_as_of - r.deadline;

    if r.crm_filled_at is not null then
      v_status := 'CRM_FILLED_AFTER_DEFAULT';
    elsif r.pn_count > 0 and r.submitted_count >= r.pn_count then
      v_status := 'SUBMITTED_ON_TIME';
    elsif v_past < 0 then
      v_status := case when v_past >= -3 then 'DUE_SOON' else 'ON_TRACK' end;
    elsif v_past = 0 then v_status := 'OVERDUE';
    elsif v_past = 1 then v_status := 'REMINDER';
    elsif v_past = 2 then v_status := 'ESCALATION';
    else v_status := 'DEFAULTED';
    end if;

    update category_sla
       set status = v_status,
           submitted_at = case when v_status = 'SUBMITTED_ON_TIME'
                               then coalesce(submitted_at, now()) else submitted_at end,
           -- Recorded the first time it defaults, never overwritten.
           defaulted_at = case when v_status = 'DEFAULTED'
                               then coalesce(defaulted_at, now()) else defaulted_at end,
           last_evaluated_at = now()
     where id = r.id;

    -- ---- activity: one per category per week per status ----
    insert into activities (event_type, category, week_key, details, dedupe_key)
    values (
      v_status, r.category, r.week_key,
      case v_status
        when 'DEFAULTED' then format(
          'Category %s missed SLA for week %s (deadline %s). Default marked automatically. CRM may now fill the category details.',
          r.category, to_char(r.week_start,'DD Mon') || ' – ' || to_char(r.week_end,'DD Mon'), to_char(r.deadline,'DD Mon'))
        when 'SUBMITTED_ON_TIME' then format(
          'Category %s submitted on time for week %s.',
          r.category, to_char(r.week_start,'DD Mon') || ' – ' || to_char(r.week_end,'DD Mon'))
        when 'DUE_SOON' then format(
          'Category %s due in %s day(s) for week %s.',
          r.category, abs(v_past), to_char(r.week_start,'DD Mon') || ' – ' || to_char(r.week_end,'DD Mon'))
        else format(
          'Category %s is %s for week %s (deadline %s).',
          r.category, lower(replace(v_status,'_',' ')),
          to_char(r.week_start,'DD Mon') || ' – ' || to_char(r.week_end,'DD Mon'), to_char(r.deadline,'DD Mon'))
      end,
      v_status || ':' || r.week_key || ':' || r.category
    )
    on conflict (dedupe_key) do nothing;

    -- ---- notification: only states people must be told about ----
    if v_status in ('DUE_SOON','OVERDUE','REMINDER','ESCALATION','DEFAULTED','SUBMITTED_ON_TIME') then
      insert into system_notifications (kind, title, body, category, week_key, dedupe_key)
      values (
        case v_status
          when 'DUE_SOON' then 'DEADLINE_SOON'
          when 'SUBMITTED_ON_TIME' then 'SUBMITTED_EARLY'
          else 'DEADLINE_MISSED' end,
        case v_status
          when 'DUE_SOON' then format('Category %s inputs due in %s day(s)', r.category, abs(v_past))
          when 'SUBMITTED_ON_TIME' then format('Category %s submitted for %s', r.category, r.week_key)
          when 'DEFAULTED' then format('Category %s missed submission deadline', r.category)
          else format('Category %s is overdue for %s', r.category, r.week_key) end,
        case v_status
          when 'DEFAULTED' then format('CRM may proceed with defaults. Week %s, deadline was %s.',
            to_char(r.week_start,'DD Mon') || ' – ' || to_char(r.week_end,'DD Mon'), to_char(r.deadline,'DD Mon'))
          else format('Week %s. Deadline: %s.',
            to_char(r.week_start,'DD Mon') || ' – ' || to_char(r.week_end,'DD Mon'), to_char(r.deadline,'DD Mon')) end,
        r.category, r.week_key,
        v_status || ':' || r.week_key || ':' || r.category
      )
      on conflict (dedupe_key) do nothing;
    end if;

    v_rows := v_rows + 1;
  end loop;

  return v_rows;
end $$;
grant execute on function public.recalculate_category_sla(date) to authenticated;

-- ═════════ 7. CRM OVERRIDE ═════════
-- Records that CRM filled a defaulted week's category details. Does not
-- change any campaign; it only writes who did the work and when, which is
-- the whole point of the requirement.
create or replace function public.record_crm_sla_override(p_sla_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare r record;
begin
  if not public.is_crm() then
    raise exception 'Only CRM can record a default override.';
  end if;
  select * into r from category_sla where id = p_sla_id;
  if not found then raise exception 'No such SLA row.'; end if;
  if r.status <> 'DEFAULTED' and r.status <> 'CRM_FILLED_AFTER_DEFAULT' then
    raise exception 'This week has not defaulted (status %). CRM fill applies only after a default.', r.status;
  end if;

  update category_sla
     set crm_filled_by = auth.uid(), crm_filled_at = now(),
         status = 'CRM_FILLED_AFTER_DEFAULT'
   where id = p_sla_id;

  insert into activities (event_type, category, week_key, details, actor_id, dedupe_key)
  values ('CRM_OVERRIDE', r.category, r.week_key,
    format('CRM filled category details for %s after default. Week %s.',
           r.category, to_char(r.week_start,'DD Mon') || ' – ' || to_char(r.week_end,'DD Mon')),
    auth.uid(), 'CRM_OVERRIDE:' || r.week_key || ':' || r.category)
  on conflict (dedupe_key) do nothing;

  insert into system_notifications (kind, title, body, category, week_key, dedupe_key)
  values ('CRM_OVERRIDE',
    format('CRM completed default fill for %s', r.category),
    format('Week: %s', to_char(r.week_start,'DD Mon') || ' – ' || to_char(r.week_end,'DD Mon')),
    r.category, r.week_key, 'CRM_OVERRIDE_N:' || r.week_key || ':' || r.category)
  on conflict (dedupe_key) do nothing;
end $$;
grant execute on function public.record_crm_sla_override(uuid) to authenticated;

-- ═════════ 8. EXECUTIVE SUMMARY ═════════
-- Counts only, spanning every row regardless of the caller's role, exactly
-- like monthly_workflow_summary().
create or replace function public.category_sla_summary()
returns table (
  on_time integer, due_soon integer, overdue integer,
  defaults_created integer, crm_overrides integer, total integer
) language sql security definer set search_path = public stable as $$
  select
    count(*) filter (where status = 'SUBMITTED_ON_TIME')::int,
    count(*) filter (where status = 'DUE_SOON')::int,
    count(*) filter (where status in ('OVERDUE','REMINDER','ESCALATION'))::int,
    count(*) filter (where defaulted_at is not null)::int,
    count(*) filter (where crm_filled_at is not null)::int,
    count(*)::int
  from category_sla;
$$;
grant execute on function public.category_sla_summary() to authenticated;

-- On-time percentage by month, for the trend chart.
create or replace function public.category_sla_trend()
returns table (month text, on_time integer, total integer, on_time_pct numeric)
language sql security definer set search_path = public stable as $$
  select to_char(week_start,'YYYY-MM') as month,
         count(*) filter (where status = 'SUBMITTED_ON_TIME')::int,
         count(*)::int,
         round(100.0 * count(*) filter (where status = 'SUBMITTED_ON_TIME')
               / nullif(count(*),0), 1)
  from category_sla group by 1 order by 1;
$$;
grant execute on function public.category_sla_trend() to authenticated;

-- Categories with the most misses.
create or replace function public.category_sla_offenders()
returns table (category text, missed integer, defaults integer, total integer)
language sql security definer set search_path = public stable as $$
  select category,
         count(*) filter (where status in ('OVERDUE','REMINDER','ESCALATION','DEFAULTED','CRM_FILLED_AFTER_DEFAULT'))::int,
         count(*) filter (where defaulted_at is not null)::int,
         count(*)::int
  from category_sla group by category
  having count(*) filter (where status in ('OVERDUE','REMINDER','ESCALATION','DEFAULTED','CRM_FILLED_AFTER_DEFAULT')) > 0
  order by 2 desc, 1;
$$;
grant execute on function public.category_sla_offenders() to authenticated;

-- ═════════ VERIFY ═════════
select 'deadline rule' as check, public.category_week_deadline(date '2026-11-03') as value;
-- Expect 2026-10-25, matching the business example.

select c.relname, c.relrowsecurity as rls
from pg_class c join pg_namespace n on n.oid=c.relnamespace
where n.nspname='public'
  and c.relname in ('category_sla','activities','system_notifications','system_notification_reads')
order by 1;

notify pgrst, 'reload schema';
