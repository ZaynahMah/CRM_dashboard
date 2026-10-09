-- =====================================================================
-- CLiQ Push Ops — 17: security hardening (audit findings 7, 9, 10)
--
-- Run SEVENTEENTH, after 16. Safe to run more than once.
--
-- 7.  creative_verified becomes conditional inside update_calendar()
-- 9.  per-role read policies replace "using (true)"
-- 10. column-level ownership enforced by a BEFORE UPDATE trigger
--
-- Nothing here changes workflow, tracking codes, bucket logic or the upload
-- reset.
-- =====================================================================

-- ═════════ 7. CONDITIONAL CREATIVE VERIFICATION IN THE RPC ═════════
-- The client already treats creative_verified as required only when a
-- creative link exists. The server must agree, or the two disagree about
-- what "QC passed" means. update_calendar() now re-derives the rule itself
-- rather than trusting qc_status alone.

create or replace function public.update_calendar(p_campaign_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_qc        qc_status;
  v_creative  text;
  v_tracking  text;
  v_missing   text;
  v_row       qc_checklists%rowtype;
begin
  if not public.is_crm() then raise exception 'Only CRM can update the calendar.'; end if;

  select qc_status, creative_link, tracking_code
    into v_qc, v_creative, v_tracking
    from campaigns where id = p_campaign_id;

  if v_qc is distinct from 'PASSED'::qc_status then
    raise exception 'Final QC must pass before this campaign can be added to the calendar.';
  end if;

  -- Tracking code is mandatory on every path (audit finding 2).
  if v_tracking is null or btrim(v_tracking) = '' then
    raise exception 'A tracking code is required before this campaign can be added to the calendar.';
  end if;
  if v_tracking not like 'cid=%' then
    raise exception 'Tracking code is not in the cid= production format.';
  end if;

  select * into v_row from qc_checklists where campaign_id = p_campaign_id;
  if not found then
    raise exception 'Final QC checklist has not been started for this campaign.';
  end if;

  -- Every check except creative_verified is always required.
  v_missing := concat_ws(', ',
    case when not coalesce(v_row.category_verified, false) then 'Category verified' end,
    case when not coalesce(v_row.brand_verified,    false) then 'Brand verified' end,
    case when not coalesce(v_row.offer_verified,    false) then 'Offer verified' end,
    case when not coalesce(v_row.landing_verified,  false) then 'Landing verified' end,
    case when not coalesce(v_row.date_verified,     false) then 'Date verified' end,
    case when not coalesce(v_row.time_verified,     false) then 'Time verified' end,
    case when not coalesce(v_row.audience_verified, false) then 'Audience verified' end,
    case when not coalesce(v_row.copy_verified,     false) then 'Copy verified' end,
    case when not coalesce(v_row.tracking_verified, false) then 'Tracking verified' end,
    -- Creative verification applies ONLY when there is a creative link.
    case when v_creative is not null and btrim(v_creative) <> ''
          and not coalesce(v_row.creative_verified, false)
         then 'Creative verified' end
  );

  if v_missing <> '' then
    raise exception 'Final QC incomplete — missing: %', v_missing;
  end if;

  update campaigns
     set calendar_status     = 'UPDATED'::text,
         calendar_updated_at = now(),
         calendar_updated_by = auth.uid(),
         production_status   = 'READY'::production_status
   where id = p_campaign_id;
end $$;
grant execute on function public.update_calendar(uuid) to authenticated;


-- ═════════ 9. PER-ROLE READ POLICIES ═════════
-- "using (true)" let any authenticated role read every row of every table.
-- Reads are now scoped to what each role needs to do its job.
--
-- CRM and EXECUTIVE keep full read access: CRM runs the whole pipeline, and
-- EXECUTIVE reports on it (and has no write policy anywhere, so it stays
-- read-only).

drop policy if exists campaigns_read on campaigns;
create policy campaigns_read on campaigns for select to authenticated
using (
  public.is_crm()
  or public.current_app_role() = 'EXECUTIVE'::app_role
  -- CONTENT sees only what CRM has actually sent, plus its own history.
  -- content_status is the column the send writes, so an un-routed CRM Self
  -- row is invisible here — matching the dashboard rule exactly.
  or (public.current_app_role() = 'CONTENT'::app_role
      and content_status <> 'NOT_ASSIGNED')
  -- CATEGORY sees Category-relevant PNs only: never CRM Self (those skip
  -- Category entirely) and never rows CRM has not released.
  or (public.current_app_role() = 'CATEGORY'::app_role
      and is_crm_self = false
      and crm_status <> 'NOT_STARTED')
);

-- Children follow the parent: you may read a child row only if you may read
-- its campaign. EXISTS re-evaluates campaigns_read, so there is one rule.
do $$
declare t text;
begin
  foreach t in array array['crm_decisions','content_submissions','qc_checklists',
                           'change_requests','activity_logs']
  loop
    execute format('drop policy if exists %1$s_read on %1$s', t);
    execute format($f$
      create policy %1$s_read on %1$s for select to authenticated
      using (
        campaign_id is null
        or exists (select 1 from campaigns c where c.id = %1$s.campaign_id)
      )$f$, t);
  end loop;
end $$;

-- Reference data (segments, pncc_*, offer factors, push tags) stays readable
-- by everyone: it is a shared dictionary with nothing sensitive, and the
-- dropdowns in every role's UI depend on it.


-- ═════════ 10. COLUMN-LEVEL OWNERSHIP ═════════
-- Postgres has no column-level RLS: a policy sees the assembled row, not
-- which columns the statement named. A BEFORE UPDATE trigger can compare
-- OLD and NEW, so that is what enforces ownership.
--
-- CRM owns everything. The restriction applies to CATEGORY and CONTENT.

create or replace function public.enforce_column_ownership()
returns trigger language plpgsql as $$
declare
  v_role text := public.current_app_role()::text;
  v_bad  text;
begin
  -- CRM owns every column; service_role and migrations bypass entirely.
  if v_role is null or v_role in ('CRM', 'EXECUTIVE') then return new; end if;

  if v_role = 'CONTENT' then
    -- Content owns exactly five columns. Anything else is a violation.
    v_bad := concat_ws(', ',
      case when new.tracking_code    is distinct from old.tracking_code    then 'tracking_code' end,
      case when new.cid              is distinct from old.cid              then 'cid' end,
      case when new.campaign_id_ext  is distinct from old.campaign_id_ext  then 'campaign_id_ext' end,
      case when new.landing_plus_tracking is distinct from old.landing_plus_tracking then 'landing_plus_tracking' end,
      case when new.qc_status        is distinct from old.qc_status        then 'qc_status' end,
      case when new.calendar_status  is distinct from old.calendar_status  then 'calendar_status' end,
      case when new.crm_status       is distinct from old.crm_status       then 'crm_status' end,
      case when new.category_status  is distinct from old.category_status  then 'category_status' end,
      case when new.pn_template      is distinct from old.pn_template      then 'pn_template' end,
      case when new.title_brief      is distinct from old.title_brief      then 'title_brief' end,
      case when new.message_brief    is distinct from old.message_brief    then 'message_brief' end,
      case when new.brand            is distinct from old.brand            then 'brand' end,
      case when new.offer            is distinct from old.offer            then 'offer' end,
      case when new.landing          is distinct from old.landing          then 'landing' end,
      case when new.expected_cvr     is distinct from old.expected_cvr     then 'expected_cvr' end,
      case when new.expected_rpv     is distinct from old.expected_rpv     then 'expected_rpv' end,
      case when new.launch_date      is distinct from old.launch_date      then 'launch_date' end,
      case when new.launch_time      is distinct from old.launch_time      then 'launch_time' end
    );
    if v_bad <> '' then
      raise exception 'CONTENT may not modify: %', v_bad;
    end if;
  end if;

  if v_role = 'CATEGORY' then
    v_bad := concat_ws(', ',
      case when new.tracking_code    is distinct from old.tracking_code    then 'tracking_code' end,
      case when new.cid              is distinct from old.cid              then 'cid' end,
      case when new.campaign_id_ext  is distinct from old.campaign_id_ext  then 'campaign_id_ext' end,
      case when new.landing_plus_tracking is distinct from old.landing_plus_tracking then 'landing_plus_tracking' end,
      case when new.qc_status        is distinct from old.qc_status        then 'qc_status' end,
      case when new.calendar_status  is distinct from old.calendar_status  then 'calendar_status' end,
      case when new.crm_status       is distinct from old.crm_status       then 'crm_status' end,
      case when new.content_status   is distinct from old.content_status   then 'content_status' end,
      case when new.header           is distinct from old.header           then 'header' end,
      case when new.sub_copy_text    is distinct from old.sub_copy_text    then 'sub_copy_text' end,
      case when new.creative_link    is distinct from old.creative_link    then 'creative_link' end,
      case when new.pn_template      is distinct from old.pn_template      then 'pn_template' end,
      case when new.title_brief      is distinct from old.title_brief      then 'title_brief' end,
      case when new.message_brief    is distinct from old.message_brief    then 'message_brief' end,
      case when new.launch_date      is distinct from old.launch_date      then 'launch_date' end,
      case when new.launch_time      is distinct from old.launch_time      then 'launch_time' end
    );
    if v_bad <> '' then
      raise exception 'CATEGORY may not modify: %', v_bad;
    end if;
  end if;

  return new;
end $$;

drop trigger if exists campaigns_column_ownership on campaigns;
create trigger campaigns_column_ownership
  before update on campaigns
  for each row execute function public.enforce_column_ownership();


-- ═════════ VERIFY ═════════
-- 1. No policy anywhere references DESIGN. Zero rows expected.
select schemaname, tablename, policyname
from pg_policies
where schemaname = 'public'
  and (coalesce(qual,'') ilike '%DESIGN%' or coalesce(with_check,'') ilike '%DESIGN%'
       or policyname ilike '%design%');

-- 2. The ownership trigger is attached. One row expected.
select tgname, tgenabled
from pg_trigger
where tgrelid = 'public.campaigns'::regclass
  and tgname = 'campaigns_column_ownership';

-- 3. The read policy is no longer "true". Inspect the qual.
select policyname, cmd, qual
from pg_policies
where schemaname = 'public' and tablename = 'campaigns' and cmd = 'SELECT';
