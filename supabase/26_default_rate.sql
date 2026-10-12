-- =====================================================================
-- CLiQ Push Ops — 26: Default Rate reporting and threshold alerts
--
-- Run TWENTY-SIXTH, after 25. Idempotent; safe to rerun.
--
-- Reporting ONLY. No existing SLA logic is modified: every function here
-- reads category_sla and writes nothing back to it. Statuses, deadlines
-- and the escalation ladder are untouched.
--
--   Default Rate % = (defaulted campaign weeks / total campaign weeks) x 100
--
-- A week counts as defaulted once it reached DEFAULTED, whether or not CRM
-- later filled it — a CRM override does not erase the miss, it records who
-- did the work. `defaulted_at is not null` is therefore the test, not the
-- current status.
-- =====================================================================

-- Dropped first: `create or replace` cannot change a function's
-- return type, and an earlier draft of this file shipped a different
-- column list.
drop function if exists public.category_default_rate();
create function public.category_default_rate()
returns table (
  category     text,
  on_time      integer,
  overdue      integer,
  defaulted    integer,
  total_weeks  integer,
  default_rate numeric
) language sql security definer set search_path = public stable as $$
  select
    category,
    count(*) filter (where status = 'SUBMITTED_ON_TIME')::int,
    count(*) filter (where status in ('OVERDUE','REMINDER','ESCALATION'))::int,
    count(*) filter (where defaulted_at is not null)::int,
    count(*)::int,
    round(100.0 * count(*) filter (where defaulted_at is not null)
          / nullif(count(*), 0), 1)
  from category_sla
  group by category
  order by 6 desc nulls last, category;
$$;
grant execute on function public.category_default_rate() to authenticated;

-- Organisation-wide rate, plus the best and worst performers.
-- Dropped first: `create or replace` cannot change a function's
-- return type, and an earlier draft of this file shipped a different
-- column list.
drop function if exists public.org_default_rate();
create function public.org_default_rate()
returns table (
  total_weeks     integer,
  defaulted_weeks integer,
  default_rate    numeric,
  categories      integer,
  over_threshold  integer
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

-- Default rate by month, for the trend chart.
-- Dropped first: `create or replace` cannot change a function's
-- return type, and an earlier draft of this file shipped a different
-- column list.
drop function if exists public.default_rate_trend();
create function public.default_rate_trend()
returns table (month text, defaulted integer, total integer, default_rate numeric)
language sql security definer set search_path = public stable as $$
  select to_char(week_start, 'YYYY-MM'),
         count(*) filter (where defaulted_at is not null)::int,
         count(*)::int,
         round(100.0 * count(*) filter (where defaulted_at is not null)
               / nullif(count(*), 0), 1)
  from category_sla
  group by 1 order by 1;
$$;
grant execute on function public.default_rate_trend() to authenticated;

-- ═════════ THRESHOLD ALERTS ═════════
-- Crossing 10% raises an activity and a notification; dropping back below
-- raises the recovery one. State is held so each crossing fires once —
-- without it a daily job would repeat the same alert forever.
create table if not exists category_default_threshold (
  category        text primary key,
  over_threshold  boolean not null default false,
  last_rate       numeric,
  changed_at      timestamptz not null default now()
);
alter table category_default_threshold enable row level security;
drop policy if exists cdt_read on category_default_threshold;
create policy cdt_read on category_default_threshold
  for select to authenticated using (true);

-- Dropped first: `create or replace` cannot change a function's
-- return type, and an earlier draft of this file shipped a different
-- column list.
drop function if exists public.evaluate_default_thresholds(numeric);
create function public.evaluate_default_thresholds(p_threshold numeric default 10)
returns integer language plpgsql security definer set search_path = public as $$
declare r record; was boolean; fired integer := 0;
begin
  for r in select * from public.category_default_rate() loop
    select over_threshold into was
      from category_default_threshold where category = r.category;

    if was is null then
      insert into category_default_threshold (category, over_threshold, last_rate)
      values (r.category, coalesce(r.default_rate,0) > p_threshold, r.default_rate);
      was := false;
    end if;

    -- Crossed UP.
    if coalesce(r.default_rate, 0) > p_threshold and not was then
      insert into activities (event_type, category, details, dedupe_key)
      values ('DEFAULT_THRESHOLD_EXCEEDED', r.category,
        format('%s category exceeded default threshold (%s%%).', r.category, r.default_rate),
        'THRESHOLD_UP:' || r.category || ':' || r.default_rate)
      on conflict (dedupe_key) do nothing;

      insert into system_notifications (kind, title, body, category, dedupe_key)
      values ('DEFAULT_THRESHOLD',
        format('%s category default rate exceeds target threshold.', r.category),
        format('Default rate %s%% against a %s%% target, across %s campaign weeks.',
               r.default_rate, p_threshold, r.total_weeks),
        r.category, 'THRESHOLD_UP_N:' || r.category || ':' || r.default_rate)
      on conflict (dedupe_key) do nothing;
      fired := fired + 1;

    -- Crossed DOWN.
    elsif coalesce(r.default_rate, 0) <= p_threshold and was then
      insert into activities (event_type, category, details, dedupe_key)
      values ('DEFAULT_THRESHOLD_RECOVERED', r.category,
        format('%s category returned to acceptable default levels (%s%%).',
               r.category, r.default_rate),
        'THRESHOLD_DOWN:' || r.category || ':' || r.default_rate)
      on conflict (dedupe_key) do nothing;
      fired := fired + 1;
    end if;

    update category_default_threshold
       set over_threshold = coalesce(r.default_rate,0) > p_threshold,
           last_rate = r.default_rate, changed_at = now()
     where category = r.category;
  end loop;
  return fired;
end $$;
grant execute on function public.evaluate_default_thresholds(numeric) to authenticated;

-- ═════════ VERIFY ═════════
select * from public.org_default_rate();
select * from public.category_default_rate() limit 10;

notify pgrst, 'reload schema';
