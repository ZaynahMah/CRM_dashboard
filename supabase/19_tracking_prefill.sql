-- =====================================================================
-- CLiQ Push Ops — 19: tracking pre-fill corrections
--
-- Run NINETEENTH, after 18. Idempotent: every statement is narrowed to the
-- rows still needing the change, so a second run finds nothing to do.
--
-- Migration 16 is NOT edited here — it may already have run.
--
-- EVERY statement excludes calendar_status = 'UPDATED'. A published PN's
-- tracking code is live in analytics and in a push that has shipped;
-- changing it would break the link between the campaign and its reporting.
-- =====================================================================

-- ═════════ 1. SEGMENT 2 PRE-FILL ═════════
-- Confirmed rule: CRM Self -> int, everything that came through Category
-- (including emergencies) -> cat.
--
-- Only NULL or empty values are touched. A value CRM has chosen is never
-- overwritten, which is why the predicate tests for blank rather than for
-- "not the expected value".

-- 1.1 PREVIEW
select
  count(*) filter (where segment_2 is null or btrim(segment_2) = '')              as blank_total,
  count(*) filter (where (segment_2 is null or btrim(segment_2) = '') and is_crm_self)       as will_set_int,
  count(*) filter (where (segment_2 is null or btrim(segment_2) = '') and not is_crm_self)   as will_set_cat,
  count(*) filter (where segment_2 in ('cat','int'))                             as already_set_by_crm
from campaigns
where calendar_status <> 'UPDATED';

-- 1.2 CHANGE
update campaigns
   set segment_2 = case when is_crm_self then 'int' else 'cat' end
 where (segment_2 is null or btrim(segment_2) = '')
   and calendar_status <> 'UPDATED';

-- 1.3 VERIFY — zero rows expected
select id, campaign_name, is_crm_self, segment_2, 'segment_2 still blank' as problem
from campaigns
where (segment_2 is null or btrim(segment_2) = '')
  and calendar_status <> 'UPDATED';


-- ═════════ 2. OFFERS SET BY THE OLD "FIRST OFFER WINS" RULE ═════════
-- The old pre-fill picked the first offer type it matched, so
-- "Upto 60% + Extra 10%" silently became 'upto'. The new rule leaves
-- multi-type offers blank for CRM to choose.
--
-- WHAT THIS DOES NOT DO
-- It does not clear anything automatically. activity_logs records WHICH
-- campaign changed and by whom, but not WHICH COLUMN — so there is no
-- reliable way in SQL to tell a value the old rule guessed from one CRM
-- deliberately chose. Clearing a deliberate choice would be worse than
-- leaving a guessed one.
--
-- These rows are therefore LISTED FOR MANUAL REVIEW. Work through the list
-- in the Show All PN workspace, where the offer text sits beside the
-- dropdown, and use Apply to selected for the common cases.

-- 2.1 Rows whose offer TEXT contains more than one offer type while
--     tracking_offer is set. These are the suspects.
with typed as (
  select
    c.id, c.campaign_name, c.launch_date, c.offer as offer_text, c.tracking_offer,
    (
      (case when c.offer ~* '\mupto\M|\mup to\M'        then 1 else 0 end) +
      (case when c.offer ~* '\mstart(s|ing)\M'           then 1 else 0 end) +
      (case when c.offer ~* '\mmin\M|\mminimum\M'        then 1 else 0 end) +
      (case when c.offer ~* '\munder\M'                  then 1 else 0 end) +
      (case when c.offer ~* '\mflat\M'                   then 1 else 0 end) +
      (case when c.offer ~* 'buy\s*\d*\s*get'            then 1 else 0 end) +
      (case when c.offer ~* 'cliq\s*cash|\mccash\M'      then 1 else 0 end) +
      (case when c.offer ~* '\mcoupon\M'                 then 1 else 0 end) +
      (case when c.offer ~* '\mextra\M'                  then 1 else 0 end)
    ) as offer_types
  from campaigns c
  where c.calendar_status <> 'UPDATED'
    and c.tracking_offer is not null
    and btrim(c.tracking_offer) <> ''
)
select
  id, campaign_name, launch_date, offer_text, tracking_offer, offer_types,
  'MANUAL REVIEW — offer text has several types; confirm the code is right'
    as action_required
from typed
where offer_types > 1
order by launch_date, id;

-- 2.2 How many need review, and how many are unambiguous.
select
  count(*) as ambiguous_offers_for_manual_review
from campaigns c
where c.calendar_status <> 'UPDATED'
  and c.tracking_offer is not null and btrim(c.tracking_offer) <> ''
  and (
    (case when c.offer ~* '\mupto\M|\mup to\M'   then 1 else 0 end) +
    (case when c.offer ~* '\mstart(s|ing)\M'      then 1 else 0 end) +
    (case when c.offer ~* '\mmin\M|\mminimum\M'   then 1 else 0 end) +
    (case when c.offer ~* '\munder\M'             then 1 else 0 end) +
    (case when c.offer ~* '\mflat\M'              then 1 else 0 end) +
    (case when c.offer ~* 'buy\s*\d*\s*get'       then 1 else 0 end) +
    (case when c.offer ~* 'cliq\s*cash|\mccash\M' then 1 else 0 end) +
    (case when c.offer ~* '\mcoupon\M'            then 1 else 0 end) +
    (case when c.offer ~* '\mextra\M'             then 1 else 0 end)
  ) > 1;


-- ═════════ 3. SECURITY: search_path on SECURITY DEFINER functions ═════════
-- Audited across migrations 01-18: all 23 SECURITY DEFINER functions
-- already declare `set search_path = public`, including
-- reset_campaigns_with_archive, upload_reset_preview and update_calendar.
-- Nothing needed fixing. This query proves it against the live database
-- rather than against the files.
--
-- Expect ZERO rows. Any row is a function an attacker could redirect by
-- creating a same-named object in a schema earlier on the search path.
select
  n.nspname as schema,
  p.proname as function_name,
  'SECURITY DEFINER without a fixed search_path' as problem
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.prosecdef
  and not exists (
    select 1 from unnest(coalesce(p.proconfig, '{}')) cfg
    where cfg like 'search_path=%'
  );


-- ═════════ 4. FINAL COUNTS ═════════
select
  count(*) filter (where tracking_code is null or btrim(tracking_code) = '')     as awaiting_generation,
  count(*) filter (where tracking_code like 'cid=%')                             as valid_cid_codes,
  count(*) filter (where tracking_code is not null
                     and btrim(tracking_code) <> ''
                     and tracking_code not like 'cid=%')                          as still_old_format,
  count(*) filter (where segment_2 is null or btrim(segment_2) = '')             as missing_segment_2,
  count(*) filter (where tracking_sub_category is null
                     or btrim(tracking_sub_category) = '')                        as missing_sub_category
from campaigns
where calendar_status <> 'UPDATED';
-- still_old_format MUST be 0. missing_sub_category is expected to be high:
-- Sub Category has no auto-derivation rule and is CRM's to pick.
