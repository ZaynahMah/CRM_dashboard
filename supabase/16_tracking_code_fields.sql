-- =====================================================================
-- CLiQ Push Ops — 16: tracking-code short-code columns
--
-- Run SIXTEENTH, after 15. Safe to run more than once.
--
-- WHY THESE COLUMNS
-- Every tracking field is a SHORT CODE chosen from a dropdown, and several
-- of them are not the same thing as the display value already stored:
--
--   category      "Westside"        -> westside
--   sub_category  "Kurtas & Suit"   -> suitset
--   brand         "US Polo Assn"    -> uspoloassn   (or multibrand)
--   offer         "Upto 60% off"    -> upto
--   landing       a full URL         -> plp | clp
--
-- The display values belong to Category and must not be overwritten, and
-- CRM must be able to override any suggested short code. That needs its own
-- column per field; recomputing at render time would discard the override.
--
-- The other tracking fields reuse existing CRM Part 3 columns, which
-- already hold CRM-owned values: campaign_type, channel_name,
-- channel_format, segment_1, segment_2, keywords.
-- =====================================================================

alter table campaigns add column if not exists tracking_category     text;
alter table campaigns add column if not exists tracking_sub_category text;
alter table campaigns add column if not exists tracking_brand        text;
alter table campaigns add column if not exists tracking_offer        text;
alter table campaigns add column if not exists tracking_landing      text;

-- campaign_name already holds the human campaign name ("Westside Festive"),
-- but the tracking code needs the fixed short code "prp". A separate column
-- keeps both.
alter table campaigns add column if not exists campaign_name_code    text;

-- ---------- defaults for the values that are genuinely fixed ----------
-- Only fills blanks; never overwrites a value CRM has already chosen.

update campaigns set campaign_type      = 'pn'      where campaign_type      is null and calendar_status <> 'UPDATED';
update campaigns set campaign_name_code = 'prp'     where campaign_name_code is null and calendar_status <> 'UPDATED';
update campaigns set channel_name       = 'push'    where channel_name       is null and calendar_status <> 'UPDATED';
update campaigns set keywords           = 'onetime' where keywords           is null and calendar_status <> 'UPDATED';
update campaigns set tracking_landing   = 'plp'     where tracking_landing   is null and calendar_status <> 'UPDATED';

-- ---------- VERIFY: all six columns present ----------
select column_name, data_type
from information_schema.columns
where table_schema = 'public' and table_name = 'campaigns'
  and column_name in ('tracking_category','tracking_sub_category','tracking_brand',
                      'tracking_offer','tracking_landing','campaign_name_code')
order by column_name;
-- Expect six rows.

-- ---------- How many rows still need CRM input? ----------
-- segment_2 and tracking_sub_category have no reliable rule in the source
-- sheet, so they are CRM's choice and start blank. These rows will show
-- "⚠️ Missing Data" until CRM fills them, which is intended — the old "na"
-- padding is gone and a missing field now blocks QC.
select
  count(*)                                               as total,
  count(*) filter (where segment_2 is null)              as needs_segment_2,
  count(*) filter (where tracking_sub_category is null)  as needs_sub_category,
  count(*) filter (where tracking_category is null)      as needs_category,
  count(*) filter (where tracking_offer is null)         as needs_offer
from campaigns
where calendar_status <> 'UPDATED';

-- =====================================================================
-- PART 2: clear tracking codes saved in the OLD 14-position format
--
-- Earlier builds wrote codes like
--   promotional_womensethnicfestive_pn_image_..._na_1930_121026
-- Those are not valid production codes. Because generation is
-- generate-once, a stale value would never be replaced — the app would skip
-- the row forever. Clearing it lets the new generator fill it.
--
-- Every real code starts with 'cid='. That prefix is the discriminator.
--
-- Idempotent: after the first run no non-'cid=' codes remain, so the
-- UPDATE matches nothing and the log insert is blocked by NOT EXISTS.
-- =====================================================================

-- ---------- 2.1 PREVIEW: what will be cleared ----------
select
  count(*)                                                     as old_format_total,
  count(*) filter (where calendar_status <> 'UPDATED')         as will_be_cleared,
  count(*) filter (where calendar_status =  'UPDATED')         as on_calendar_needs_manual_review
from campaigns
where tracking_code is not null
  and btrim(tracking_code) <> ''
  and tracking_code not like 'cid=%';

-- The rows themselves, so you can eyeball them before changing anything.
select
  id,
  campaign_name,
  launch_date,
  calendar_status,
  tracking_code                                                as old_code,
  left(coalesce(landing_plus_tracking, ''), 80)                as old_landing_plus_tracking
from campaigns
where tracking_code is not null
  and btrim(tracking_code) <> ''
  and tracking_code not like 'cid=%'
  and calendar_status <> 'UPDATED'
order by launch_date, id;

-- ---------- 2.2 MANUAL REVIEW: already pushed to calendar ----------
-- These are deliberately NOT touched. The code may already be live in
-- analytics and in a sent push, so replacing it silently would break the
-- link between the campaign and its reporting. Review and fix by hand.
select
  id,
  campaign_name,
  launch_date,
  calendar_updated_at,
  tracking_code                                                as old_code,
  'ON CALENDAR — left alone, fix manually'                     as action_required
from campaigns
where tracking_code is not null
  and btrim(tracking_code) <> ''
  and tracking_code not like 'cid=%'
  and calendar_status = 'UPDATED'
order by launch_date, id;

-- ---------- 2.3 AUDIT FIRST, so the old value is recorded ----------
-- Written before the UPDATE: once cleared the old code is gone, and an
-- audit row that cannot name what it replaced is not an audit row.
insert into activity_logs (campaign_id, actor_id, action, detail)
select
  c.id,
  null,
  'MIGRATION_TRACKING_CODE_CLEARED',
  'Migration 16: cleared old 14-position tracking code so the production '
    || 'cid= format can regenerate. Previous value: ' || c.tracking_code
from campaigns c
where c.tracking_code is not null
  and btrim(c.tracking_code) <> ''
  and c.tracking_code not like 'cid=%'
  and c.calendar_status <> 'UPDATED'
  and not exists (
    select 1 from activity_logs l
     where l.campaign_id = c.id
       and l.action = 'MIGRATION_TRACKING_CODE_CLEARED'
  );

-- ---------- 2.4 THE CLEAR ----------
-- landing_plus_tracking goes too: it embeds the old code, so leaving it
-- would keep a dead code in circulation.
update campaigns
   set tracking_code         = null,
       landing_plus_tracking = null,
       tracking_code_check   = null
 where tracking_code is not null
   and btrim(tracking_code) <> ''
   and tracking_code not like 'cid=%'
   and calendar_status <> 'UPDATED';

-- ---------- 2.5 VERIFY: must return ZERO rows ----------
select id, campaign_name, tracking_code, 'old-format code survived' as problem
from campaigns
where tracking_code is not null
  and btrim(tracking_code) <> ''
  and tracking_code not like 'cid=%'
  and calendar_status <> 'UPDATED';

-- Sanity: every remaining code is either null or a real cid= code.
select
  count(*) filter (where tracking_code is null or btrim(tracking_code) = '') as awaiting_generation,
  count(*) filter (where tracking_code like 'cid=%')                          as valid_cid_codes,
  count(*) filter (where tracking_code is not null
                     and btrim(tracking_code) <> ''
                     and tracking_code not like 'cid=%')                      as still_old_format
from campaigns
where calendar_status <> 'UPDATED';
-- Expect still_old_format = 0.
