-- =====================================================================
-- CLiQ Push Ops — 28: per-PN TAT, per-PN default, raw slot label
--
-- Run TWENTY-EIGHTH, after 27. Idempotent; safe to rerun.
--
-- THREE CHANGES
--
-- 1. slot_label — stores EXACTLY what CRM uploaded. `slot_number` is an
--    integer, so "0" became NULL and "h3" was unstorable. Nothing CRM
--    uploads may be altered, so the raw string is now kept alongside.
--    slot_number is left untouched for everything already using it.
--
-- 2. Per-PN defaulting. A PN defaults on ITS OWN deadline — campaign date
--    minus 7 days, 23:59:59 IST — not on a week-level Day 0/1/2/3 ladder.
--    The ladder is removed; there is one definition of "defaulted".
--
-- 3. Default Rate % = defaulted PNs / PNs past their deadline, Category-led
--    only. Week-level rate functions are replaced, not left beside it.
--
-- HISTORY IS NOT REWRITTEN. PNs already past their deadline when this runs
-- are recorded in `default_grace_before` and are NEVER auto-defaulted. Only
-- deadlines passing AFTER this deploy default.
-- =====================================================================

-- ═════════ 1. SLOT LABEL ═════════
alter table campaigns add column if not exists slot_label text;

-- Backfill, exactly as specified. Only rows with no label and a number.
update campaigns
   set slot_label = slot_number::text
 where slot_label is null
   and slot_number is not null;

-- COUNT NOTE: run this before and after to see what was backfilled.
select
  count(*)                                                as total_campaigns,
  count(*) filter (where slot_label is not null)          as has_slot_label,
  count(*) filter (where slot_label is null
                     and slot_number is not null)         as still_unlabelled,
  count(*) filter (where slot_label is null
                     and slot_number is null)             as no_slot_at_all
from campaigns;
-- still_unlabelled must be 0 after this migration.
-- no_slot_at_all is the set whose original Slot was lost by the old
-- integer parse ("0" or a non-numeric value). Those cannot be recovered
-- from the database and need a re-upload if the value matters.

-- ═════════ 2. PER-PN DEFAULT COLUMNS ═════════
alter table campaigns add column if not exists defaulted_at    timestamptz;
alter table campaigns add column if not exists default_reason  text;

create index if not exists campaigns_defaulted_idx
  on campaigns (defaulted_at) where defaulted_at is not null;

-- ═════════ 3. THE PN DEADLINE, IN SQL ═════════
-- Mirrors src/lib/deadlines.ts exactly: campaign date - 7 at 23:59:59 IST.
-- `category_deadline` is already a generated column of launch_date - 7;
-- this adds the time-of-day and the timezone so "has it passed?" is exact.
create or replace function public.pn_deadline_instant(p_launch date)
returns timestamptz language sql immutable set search_path = public as $$
  select ((p_launch - 7) + time '23:59:59.999') at time zone 'Asia/Kolkata'
$$;

create or replace function public.pn_deadline_passed(p_launch date, p_now timestamptz default now())
returns boolean language sql stable set search_path = public as $$
  select p_launch is not null and p_now > public.pn_deadline_instant(p_launch)
$$;

-- ═════════ 4. THE GRACE CUT-OFF — history is not rewritten ═════════
-- One row, written once. Every PN whose deadline had already passed when
-- this migration first ran is grandfathered and will never be
-- auto-defaulted.
create table if not exists default_grace_before (
  id            boolean primary key default true check (id),
  deployed_at   timestamptz not null default now(),
  grandfathered integer not null default 0
);

do $$
declare n integer;
begin
  if not exists (select 1 from default_grace_before) then
    select count(*) into n
      from campaigns
     where not is_crm_self
       and category_status not in ('LOCKED','SUBMITTED')
       and public.pn_deadline_passed(launch_date);
    insert into default_grace_before (id, grandfathered) values (true, n);
    raise notice 'Grandfathered % PN(s) already past deadline; they will not auto-default.', n;
  end if;
end $$;

-- HOW MANY PNs REMAIN PENDING (not grandfathered, will default in future):
select
  (select grandfathered from default_grace_before)                      as grandfathered_never_default,
  count(*) filter (where not public.pn_deadline_passed(launch_date))    as pending_future_deadline,
  count(*)                                                              as category_led_unsubmitted
from campaigns
where not is_crm_self and category_status not in ('LOCKED','SUBMITTED');

-- ═════════ 5. THE PER-PN DEFAULT JOB ═════════
-- Replaces the week-level Day 0/1/2/3 progression. Category-led only:
-- CRM Self PNs have no Category input to miss.
--
-- Sends the PN to CRM with the Category fields LEFT BLANK — nothing is
-- invented or auto-filled.
create or replace function public.default_overdue_pns(p_now timestamptz default now())
returns integer language plpgsql security definer set search_path = public as $$
declare
  v_cutoff timestamptz;
  v_count  integer := 0;
  r        record;
begin
  select deployed_at into v_cutoff from default_grace_before;
  if v_cutoff is null then v_cutoff := p_now; end if;

  -- Mark each eligible PN individually.
  with eligible as (
    select id, category, launch_date
      from campaigns
     where not is_crm_self
       and defaulted_at is null
       and category_status not in ('LOCKED','SUBMITTED')
       and calendar_status <> 'UPDATED'
       and public.pn_deadline_passed(launch_date, p_now)
       -- Grandfathered: its deadline had already passed at deploy time.
       and public.pn_deadline_instant(launch_date) > v_cutoff
  )
  update campaigns c
     set defaulted_at   = now(),
         default_reason = 'TAT missed: Category did not submit by '
                          || to_char(public.pn_deadline_instant(c.launch_date)
                             at time zone 'Asia/Kolkata', 'DD Mon HH12:MI AM') || ' IST',
         -- Handed to CRM with Category fields untouched and blank.
         crm_status     = 'AWAITING_REVIEW'::crm_status
    from eligible e
   where c.id = e.id;
  get diagnostics v_count = row_count;

  if v_count = 0 then return 0; end if;

  -- ONE activity per category per day, not one per row.
  for r in
    select category, count(*) as n, current_date as d
      from campaigns
     where defaulted_at::date = current_date and not is_crm_self
     group by category
  loop
    insert into activities (event_type, category, details, dedupe_key)
    values ('DEFAULTED', r.category,
      format('%s: %s PN(s) defaulted (TAT missed). Sent to CRM with Category fields blank.',
             r.category, r.n),
      'PN_DEFAULT:' || r.d || ':' || coalesce(r.category, 'Uncategorised'))
    on conflict (dedupe_key) do update
      set details = excluded.details;

    -- ONE notification per category per day.
    insert into system_notifications (kind, title, body, category, dedupe_key)
    values ('DEADLINE_MISSED',
      format('%s: %s PNs defaulted (TAT missed)', r.category, r.n),
      'CRM may now fill the Category fields. Nothing was auto-filled.',
      r.category,
      'PN_DEFAULT_N:' || r.d || ':' || coalesce(r.category, 'Uncategorised'))
    on conflict (dedupe_key) do update
      set title = excluded.title;
  end loop;

  return v_count;
end $$;
grant execute on function public.default_overdue_pns(timestamptz) to authenticated;

-- ═════════ 6. DEFAULT RATE, PER PN ═════════
-- Replaces the week-level rate. Denominator is PNs whose deadline has
-- passed: a PN not yet due cannot be counted against a team.
drop function if exists public.category_default_rate();
create function public.category_default_rate()
returns table (
  category     text,
  on_time      integer,
  overdue      integer,
  defaulted    integer,
  total_weeks  integer,   -- name kept: now "PNs past deadline"
  default_rate numeric
) language sql security definer set search_path = public stable as $$
  select
    coalesce(nullif(btrim(category), ''), 'Uncategorised'),
    count(*) filter (where category_status in ('LOCKED','SUBMITTED'))::int,
    count(*) filter (where defaulted_at is null
                       and category_status not in ('LOCKED','SUBMITTED'))::int,
    count(*) filter (where defaulted_at is not null)::int,
    count(*)::int,
    round(100.0 * count(*) filter (where defaulted_at is not null)
          / nullif(count(*), 0), 1)
  from campaigns
  where not is_crm_self
    and public.pn_deadline_passed(launch_date)
  group by 1
  order by 6 desc nulls last, 1;
$$;
grant execute on function public.category_default_rate() to authenticated;

drop function if exists public.org_default_rate();
create function public.org_default_rate()
returns table (
  total_weeks integer, defaulted_weeks integer,
  default_rate numeric, categories integer, over_threshold integer
) language sql security definer set search_path = public stable as $$
  with per as (select * from public.category_default_rate())
  select
    coalesce(sum(total_weeks), 0)::int,
    coalesce(sum(defaulted), 0)::int,
    round(100.0 * coalesce(sum(defaulted), 0) / nullif(sum(total_weeks), 0), 1),
    count(*)::int,
    count(*) filter (where default_rate > 10)::int
  from per;
$$;
grant execute on function public.org_default_rate() to authenticated;

drop function if exists public.default_rate_trend();
create function public.default_rate_trend()
returns table (month text, defaulted integer, total integer, default_rate numeric)
language sql security definer set search_path = public stable as $$
  select to_char(launch_date, 'YYYY-MM'),
         count(*) filter (where defaulted_at is not null)::int,
         count(*)::int,
         round(100.0 * count(*) filter (where defaulted_at is not null)
               / nullif(count(*), 0), 1)
  from campaigns
  where not is_crm_self and public.pn_deadline_passed(launch_date)
  group by 1 order by 1;
$$;
grant execute on function public.default_rate_trend() to authenticated;

-- ═════════ 7. REMOVE THE WEEK-LEVEL LADDER ═════════
-- `recalculate_category_sla` kept the Day 0 Overdue -> Day 3 Defaulted
-- progression. That is now the only other definition of "defaulted", so it
-- is replaced: the SLA rows still summarise each category-week, but their
-- status is derived from the PNs' own default state.
create or replace function public.recalculate_category_sla(p_as_of date default current_date)
returns integer language plpgsql security definer set search_path = public as $$
declare v_rows integer := 0; r record; v_status text;
begin
  insert into category_sla (week_key, week_start, week_end, deadline, category,
                            pn_count, submitted_count)
  select
    public.business_week_key(c.launch_date),
    public.business_week_start(c.launch_date),
    public.business_week_end(c.launch_date),
    -- The week's EARLIEST PN deadline, for display only. Each PN is judged
    -- on its own deadline.
    min(c.launch_date - 7),
    coalesce(nullif(btrim(c.category), ''), 'Uncategorised'),
    count(*),
    count(*) filter (where c.category_status in ('LOCKED','SUBMITTED'))
  from campaigns c
  where not c.is_crm_self
  group by 1,2,3,5
  on conflict (week_key, category) do update
    set pn_count = excluded.pn_count,
        submitted_count = excluded.submitted_count,
        week_start = excluded.week_start,
        week_end = excluded.week_end,
        deadline = excluded.deadline;

  for r in select * from category_sla loop
    -- Status now follows the PNs, not a day counter.
    select case
             when r.pn_count > 0 and r.submitted_count >= r.pn_count then 'SUBMITTED_ON_TIME'
             when exists (select 1 from campaigns c
                           where not c.is_crm_self
                             and c.defaulted_at is not null
                             and public.business_week_key(c.launch_date) = r.week_key
                             and coalesce(nullif(btrim(c.category),''),'Uncategorised') = r.category)
               then 'DEFAULTED'
             when p_as_of >= r.deadline then 'OVERDUE'
             when p_as_of >= r.deadline - 3 then 'DUE_SOON'
             else 'ON_TRACK'
           end into v_status;

    update category_sla
       set status = v_status,
           defaulted_at = case when v_status = 'DEFAULTED'
                               then coalesce(defaulted_at, now()) else defaulted_at end,
           last_evaluated_at = now()
     where id = r.id;
    v_rows := v_rows + 1;
  end loop;

  return v_rows;
end $$;
grant execute on function public.recalculate_category_sla(date) to authenticated;

-- ═════════ VERIFY ═════════
select 'deadline 1 Nov PN' as check,
       public.pn_deadline_instant(date '2026-11-01') at time zone 'Asia/Kolkata' as due_ist;
-- Expect 2026-10-25 23:59:59.999

select proname, prosecdef from pg_proc p join pg_namespace n on n.oid=p.pronamespace
where n.nspname='public'
  and proname in ('default_overdue_pns','pn_deadline_passed','category_default_rate')
order by 1;

notify pgrst, 'reload schema';
