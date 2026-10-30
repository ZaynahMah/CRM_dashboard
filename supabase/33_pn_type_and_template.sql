-- =====================================================================
-- CLiQ Push Ops — 33: PN Type (Content's fifth input)
--
-- Run THIRTY-THIRD, after 32, in the EXISTING project via the SQL Editor.
-- Idempotent; safe to run twice. NO DATA IS DELETED OR CHANGED.
--
-- Existing rows keep pn_type = NULL and display as "—". Nothing is
-- back-filled and no PN already submitted or on the calendar is
-- re-validated.
--
-- 'Coloured BG' is deliberately NOT auto-mapped to Background Coloured or
-- Title Coloured: only CRM knows which was meant, so the old value is shown
-- as-is with a "not in list" hint and CRM re-picks when convenient.
--
-- PN Template needs NO migration: `pn_template` is already plain `text`
-- with no constraint, so the ten new values store as they are and old
-- values such as 'Coloured BG' keep working untouched.
-- =====================================================================

-- ═════════ READ-ONLY CHECKS — run these FIRST ═════════
select
  (select count(*) from campaigns)                                  as campaigns_total,
  (select count(*) from information_schema.columns
    where table_schema='public' and table_name='campaigns'
      and column_name='pn_type')                                    as pn_type_exists,
  (select count(*) from campaigns where pn_template is not null
     and pn_template not in ('Basic','Bezel','Timer','Background Coloured',
       'Title Coloured','Carousel','Video','Multi CTA','Icons','Rating'))
                                                                    as legacy_template_rows;
-- Expect: pn_type_exists = 0 on a first run, 1 on a rerun.
-- legacy_template_rows tells you how many PNs hold an old template value
-- (e.g. 'Coloured BG'). They are NOT changed by this migration.

-- Which old values exist, and how many of each:
select pn_template, count(*) as rows
from campaigns
where pn_template is not null
  and pn_template not in ('Basic','Bezel','Timer','Background Coloured',
    'Title Coloured','Carousel','Video','Multi CTA','Icons','Rating')
group by pn_template order by 2 desc;

-- ═════════ 1. THE COLUMN ═════════
-- Nullable, so every existing row is valid as it stands.
alter table campaigns add column if not exists pn_type text;

-- NULL allowed; only SALE and BAU are accepted when a value is present.
do $$ begin
  alter table campaigns add constraint campaigns_pn_type_chk
    check (pn_type is null or pn_type in ('SALE','BAU'));
exception when duplicate_object then null; end $$;

-- ═════════ 2. CONTENT OWNS IT ═════════
-- Added to the Content-owned set in enforce_column_ownership(), so Category
-- cannot write it. CRM and the service role still bypass, as before.
create or replace function public.enforce_column_ownership()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_role app_role := public.current_app_role();
  v_bad  text[];
begin
  -- Service role / migrations (no app role) and CRM bypass, unchanged.
  if v_role is null or v_role = 'CRM'::app_role then
    return new;
  end if;

  if v_role = 'CONTENT'::app_role then
    -- Columns CONTENT may write. `pn_type` is NEW here.
    v_bad := array_remove(array[
      case when new.sub_category    is distinct from old.sub_category    then 'sub_category' end,
      case when new.brand           is distinct from old.brand           then 'brand' end,
      case when new.offer           is distinct from old.offer           then 'offer' end,
      case when new.brief           is distinct from old.brief           then 'brief' end,
      case when new.landing         is distinct from old.landing         then 'landing' end,
      case when new.expected_cvr    is distinct from old.expected_cvr    then 'expected_cvr' end,
      case when new.expected_rpv    is distinct from old.expected_rpv    then 'expected_rpv' end,
      case when new.title_brief     is distinct from old.title_brief     then 'title_brief' end,
      case when new.message_brief   is distinct from old.message_brief   then 'message_brief' end,
      case when new.pn_template     is distinct from old.pn_template     then 'pn_template' end,
      case when new.qc_status       is distinct from old.qc_status       then 'qc_status' end,
      case when new.calendar_status is distinct from old.calendar_status then 'calendar_status' end
    ], null);
  elsif v_role = 'CATEGORY'::app_role then
    v_bad := array_remove(array[
      case when new.header          is distinct from old.header          then 'header' end,
      case when new.sub_copy_text   is distinct from old.sub_copy_text   then 'sub_copy_text' end,
      case when new.reference_link  is distinct from old.reference_link  then 'reference_link' end,
      -- Category must NOT write Content's new field.
      case when new.pn_type         is distinct from old.pn_type         then 'pn_type' end,
      case when new.title_brief     is distinct from old.title_brief     then 'title_brief' end,
      case when new.message_brief   is distinct from old.message_brief   then 'message_brief' end,
      case when new.pn_template     is distinct from old.pn_template     then 'pn_template' end,
      case when new.qc_status       is distinct from old.qc_status       then 'qc_status' end,
      case when new.calendar_status is distinct from old.calendar_status then 'calendar_status' end
    ], null);
  else
    -- EXECUTIVE and anything else: read-only.
    raise exception 'Your role may not change campaign fields.';
  end if;

  if array_length(v_bad, 1) is not null then
    raise exception '% may not change: %', v_role, array_to_string(v_bad, ', ');
  end if;
  return new;
end $$;

drop trigger if exists campaigns_column_ownership on campaigns;
create trigger campaigns_column_ownership
  before update on campaigns
  for each row execute function public.enforce_column_ownership();

-- ═════════ 3. SERVER-SIDE VALUE CHECK ═════════
-- A direct API call with any other value is rejected here, not only in the UI.
create or replace function public.enforce_pn_type_value()
returns trigger language plpgsql set search_path = public as $$
begin
  if new.pn_type is not null and new.pn_type not in ('SALE','BAU') then
    raise exception 'PN Type must be SALE or BAU (got %).', new.pn_type;
  end if;
  return new;
end $$;

drop trigger if exists campaigns_pn_type_value on campaigns;
create trigger campaigns_pn_type_value
  before insert or update on campaigns
  for each row execute function public.enforce_pn_type_value();

-- ═════════ VERIFY ═════════
select
  (select count(*) from campaigns)                                as campaigns_total_after,
  (select count(*) from information_schema.columns
    where table_schema='public' and table_name='campaigns'
      and column_name='pn_type')                                  as pn_type_exists,
  (select count(*) from campaigns where pn_type is not null)      as rows_with_pn_type,
  (select count(*) from pg_trigger
    where tgrelid='campaigns'::regclass
      and tgname in ('campaigns_column_ownership','campaigns_pn_type_value'))
                                                                  as triggers_installed;
-- Expect: campaigns_total_after IDENTICAL to campaigns_total above,
--         pn_type_exists = 1, rows_with_pn_type = 0, triggers_installed = 2.

-- ═════════ ROLLBACK ═════════
-- To undo (no PN data is lost):
--   drop trigger if exists campaigns_pn_type_value on campaigns;
--   drop function if exists public.enforce_pn_type_value();
--   alter table campaigns drop constraint if exists campaigns_pn_type_chk;
--   alter table campaigns drop column if exists pn_type;
-- Then re-run migration 17 to restore the previous enforce_column_ownership().

notify pgrst, 'reload schema';
