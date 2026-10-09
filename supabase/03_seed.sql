-- =====================================================================
-- CLiQ Push Operations - Seed data
-- Run this THIRD, after you have created the four auth users.
-- Safe to re-run: it clears operational tables first.
-- Dates are generated relative to today, so the board is always live.
-- =====================================================================

truncate table notifications, activity_logs, change_requests, qc_checklists,
               content_submissions, crm_decisions, campaigns,
               calendar_slots, calendar_days restart identity cascade;

do $$
declare
  v_crm       uuid := (select id from profiles where role = 'CRM' limit 1);
  v_cat       uuid := (select id from profiles where role = 'CATEGORY' limit 1);
  v_con       uuid := (select id from profiles where role = 'CONTENT' limit 1);
  d           date;
  day_id      uuid;
  slot_id     uuid;
  camp_id     uuid;
  i           int;
  n           int := 0;
  lead        int;
  slot_times  time[] := array['10:00','12:00','14:00','16:00','18:00','19:30','21:00']::time[];
  brands      text[] := array['Estée Lauder','Michael Kors','Tory Burch','Swarovski','Coach',
                              'Charles & Keith','Tommy Hilfiger','Jimmy Choo','Montblanc','Rado',
                              'Bobbi Brown','Furla','Calvin Klein','Kate Spade','Emporio Armani'];
  cats        text[] := array['Beauty','Fashion','Luxury','Watches','Footwear','Accessories','Jewellery'];
  subcats     text[] := array['Skincare','Womenswear','Handbags','Luxury Watches','Heels','Eyewear','Fine Jewellery'];
  themes      text[] := array['Edit','Flash Sale','New Arrivals','Festive Preview','Gifting Drop',
                              'Weekend Offer','Icons Restock','Season Close-Out'];
  offers      text[] := array['Flat 20% Off','Up to 40% Off','Buy 2 Get 1','Extra 15% on App','Gift With Purchase'];
  auds        text[] := array['Women · Beauty Buyers','Luxury Repeat Buyers','All App Users',
                              'High AOV · 180D','Lapsed · 90D','Men · Watch Intenders'];
  cohorts     text[] := array['Beauty Buyers · 90D','Luxury Browsers · 30D','Cart Abandoners · 7D','New Users · 14D'];
  ovr         text[] := array['Business Preference','Brand Request','Campaign Urgency','Calendar Conflict'];
begin
  -- ------------------------------------------------------------------
  -- CRM builds the calendar: 45 days back, 45 days forward, 7 slots each
  -- ------------------------------------------------------------------
  for d in select generate_series(current_date - 20, current_date + 40, '1 day')::date loop
    insert into calendar_days (date, month, year, created_by)
    values (d, extract(month from d), extract(year from d), v_crm)
    returning id into day_id;

    for i in 1..7 loop
      insert into calendar_slots (calendar_day_id, slot_number, slot_time, status)
      values (day_id, i, slot_times[i], 'AVAILABLE');
    end loop;
  end loop;

  -- ------------------------------------------------------------------
  -- Fill roughly 60% of slots with campaigns at realistic workflow stages
  -- ------------------------------------------------------------------
  for slot_id, d, i in
    select s.id, cd.date, s.slot_number
      from calendar_slots s
      join calendar_days cd on cd.id = s.calendar_day_id
     order by cd.date, s.slot_number
  loop
    n := n + 1;
    continue when (n % 5) in (0, 3);          -- leave ~40% of slots open
    lead := d - current_date;                  -- days until launch

    insert into campaigns (
      campaign_name, campaign_origin, category, sub_category, brand, offer, offer_details,
      campaign_type, brief, product_collection, business_objective, landing,
      calendar_slot_id, launch_date, launch_time, priority, audience, segment_1, segment_2,
      cohort, campaign_id_ext, cid, tracking_code,
      category_status, crm_status, content_status, qc_status, production_status,
      created_by, submitted_at
    ) values (
      brands[1 + (n % 15)] || ' ' || themes[1 + (n % 8)],
      case when n % 2 = 0 then 'CATEGORY_REQUEST' else 'CRM_PLANNED' end::campaign_origin,
      cats[1 + (n % 7)],
      subcats[1 + (n % 7)],
      brands[1 + (n % 15)],
      offers[1 + (n % 5)],
      offers[1 + (n % 5)] || ' on selected styles, app exclusive.',
      case when n % 3 = 0 then 'Offer' when n % 3 = 1 then 'Brand Launch' else 'Collection Drop' end,
      'Drive traffic to the ' || brands[1 + (n % 15)] || ' storefront and convert high-intent browsers.',
      themes[1 + (n % 8)] || ' Collection',
      case when n % 2 = 0 then 'Revenue' else 'Engagement' end,
      '/brand/' || lower(replace(brands[1 + (n % 15)], ' ', '-')),
      slot_id, d, (select slot_time from calendar_slots where id = slot_id),
      (case when n % 11 = 0 then 'HIGH' when n % 17 = 0 then 'CRITICAL' else 'NORMAL' end)::priority_level,
      auds[1 + (n % 6)],
      case when n % 2 = 0 then 'Women' else 'All Users' end,
      case when n % 3 = 0 then 'App Openers 30D' else 'Purchasers 180D' end,
      cohorts[1 + (n % 4)],
      'CMP-' || lpad(n::text, 5, '0'),
      'CID' || lpad(n::text, 4, '0'),
      'tc_' || lower(left(replace(brands[1 + (n % 15)], ' ', ''), 6)) || '_' || to_char(d, 'MMDD'),
      -- workflow stage is a function of how close the launch date is
      (case when lead > 14 and n % 4 = 0 then 'EMPTY' when lead > 14 then 'DRAFT' else 'LOCKED' end)::category_status,
      (case
        when lead < 0                then 'READY'
        when lead <= 2               then 'READY'
        when lead <= 5               then 'FINAL_QC'
        when lead <= 9               then 'SENT_TO_CONTENT'
        when lead <= 14              then 'IN_PLANNING'
        when lead <= 21              then 'AWAITING_REVIEW'
        else 'NOT_STARTED' end)::crm_status,
      (case
        when lead < 0                then 'SUBMITTED'
        when lead <= 5               then 'SUBMITTED'
        when lead <= 9 and n % 6 = 0 then 'NEEDS_CHANGES'
        when lead <= 9               then 'PENDING'
        else 'NOT_ASSIGNED' end)::content_status,
      (case when lead < 0 or lead <= 2 then 'PASSED' when lead <= 5 then 'IN_PROGRESS' else 'PENDING' end)::qc_status,
      (case when lead < 0 then 'PUSHED' when lead <= 2 then 'READY'
            when lead <= 9 and n % 13 = 0 then 'BLOCKED' else 'NOT_READY' end)::production_status,
      case when n % 2 = 0 then v_cat else v_crm end,
      case when lead <= 14 then (current_date - greatest(lead, 0) - 3)::timestamptz else null end
    ) returning id into camp_id;

    -- CRM decision + mocked recommendation for anything past planning
    if lead <= 14 then
      insert into crm_decisions (
        campaign_id, recommended_date, recommended_time, recommended_audience, recommended_cohort,
        confidence, recommendation_reason, selected_date, selected_time, selected_audience,
        selected_cohort, is_manual_override, override_reason, crm_notes, created_by
      ) values (
        camp_id, d, slot_times[1 + (n % 7)], auds[1 + (n % 6)], cohorts[1 + (n % 4)],
        0.62 + ((n % 30)::numeric / 100),
        'Comparable ' || cats[1 + (n % 7)] || ' pushes have historically converted best in this window.',
        d, (select slot_time from calendar_slots where id = slot_id), auds[1 + (n % 6)], cohorts[1 + (n % 4)],
        (n % 7 = 0), case when n % 7 = 0 then ovr[1 + (n % 4)] else null end,
        'Reviewed against the ' || to_char(d, 'Mon') || ' promo grid.', v_crm
      );
    end if;

    -- Content submission once the campaign has reached Content
    if lead <= 9 then
      insert into content_submissions (
        campaign_id, header, sub_copy, cta, pn_copy, creative_asset_url, creative_notes,
        status, submitted_by, submitted_at
      ) values (
        camp_id,
        brands[1 + (n % 15)] || ' is having a moment',
        offers[1 + (n % 5)] || '. Ends midnight — shop the edit before it goes.',
        'Shop now',
        brands[1 + (n % 15)] || ' — ' || offers[1 + (n % 5)],
        'https://assets.internal.local/push/' || lpad(n::text, 5, '0') || '.png',
        'Hero crop on the bag, warm grade to match the brand page.',
        (case when lead <= 5 then 'SUBMITTED' when n % 6 = 0 then 'NEEDS_CHANGES' else 'PENDING' end)::content_status,
        v_con,
        case when lead <= 5 then now() - (n || ' hours')::interval else null end
      );
    end if;

    -- QC checklist for everything in or past final QC
    if lead <= 5 then
      insert into qc_checklists (
        campaign_id, category_verified, brand_verified, offer_verified, landing_verified,
        date_verified, time_verified, audience_verified, creative_verified, copy_verified,
        tracking_verified, completed_by, completed_at
      ) values (
        camp_id, true, true, true, true, true, true, true,
        lead <= 2, lead <= 2, lead <= 2,
        case when lead <= 2 then v_crm else null end,
        case when lead <= 2 then now() - (n || ' hours')::interval else null end
      );
    end if;

    -- Audit trail
    insert into activity_logs (campaign_id, user_id, action, description, created_at) values
      (camp_id, v_crm, 'CRM_SLOT_CREATED', 'Slot opened on the ' || to_char(d,'FMMonth') || ' calendar.', now() - interval '21 days'),
      (camp_id, v_cat, 'CATEGORY_SUBMITTED', 'Category submitted campaign details.', now() - interval '14 days');
    if lead <= 14 then
      insert into activity_logs (campaign_id, user_id, action, description, created_at)
      values (camp_id, v_crm, 'CRM_REVIEWED', 'CRM reviewed and confirmed placement.', now() - interval '10 days');
    end if;
    if lead <= 9 then
      insert into activity_logs (campaign_id, user_id, action, description, created_at)
      values (camp_id, v_crm, 'SENT_TO_CONTENT', 'Campaign handed to Content.', now() - interval '7 days');
    end if;
    if lead < 0 then
      insert into activity_logs (campaign_id, user_id, action, description, created_at)
      values (camp_id, v_crm, 'PUSHED_TO_PRODUCTION', 'Campaign pushed to production.', d::timestamptz);
    end if;
  end loop;

  -- ------------------------------------------------------------------
  -- Emergency pushes: outside the 7-day rule, still fully validated
  -- ------------------------------------------------------------------
  for i in 1..4 loop
    insert into campaigns (
      campaign_name, campaign_origin, category, sub_category, brand, offer, offer_details,
      campaign_type, brief, landing, launch_date, launch_time, priority,
      category_status, crm_status, content_status, qc_status, production_status,
      is_emergency, emergency_reason, business_deadline, emergency_score, created_by
    ) values (
      brands[i * 3] || ' Flash Drop',
      'CATEGORY_REQUEST', cats[i], subcats[i], brands[i * 3], 'Flat 30% Off',
      'Unplanned inventory clearance approved by the brand this morning.',
      'Offer', 'Brand released additional stock and wants same-week visibility.',
      '/brand/' || lower(replace(brands[i * 3], ' ', '-')),
      current_date + i, slot_times[i + 2], 'CRITICAL',
      'LOCKED', 'AWAITING_REVIEW', 'PENDING', 'PENDING', 'NOT_READY',
      true, 'Brand-driven stock release with a fixed business deadline.',
      current_date + i, 95 - (i * 9), v_cat
    ) returning id into camp_id;

    insert into activity_logs (campaign_id, user_id, action, description)
    values (camp_id, v_cat, 'EMERGENCY_RAISED', 'Emergency push raised outside the 7-day window.');

    insert into notifications (target_role, campaign_id, type, title, message)
    values ('CRM', camp_id, 'EMERGENCY',
            'Emergency push awaiting a slot',
            brands[i * 3] || ' Flash Drop needs a slot for ' || to_char(current_date + i, 'DD Mon') || '.');
  end loop;

  -- ------------------------------------------------------------------
  -- Change requests against locked submissions
  -- ------------------------------------------------------------------
  insert into change_requests (campaign_id, requested_by, field_name, current_value, requested_value, reason, status)
  select c.id, v_cat, 'offer_details', c.offer_details, 'Flat 25% Off on selected styles, app exclusive.',
         'Brand revised the offer after the buying meeting.', 'PENDING'
    from campaigns c
   where c.category_status = 'LOCKED' and c.launch_date > current_date
   order by c.launch_date limit 3;

  insert into notifications (target_role, type, title, message)
  values ('CRM', 'CHANGE_REQUEST', 'Change requests waiting',
          '3 change requests are waiting on CRM approval.'),
         ('CATEGORY', 'DEADLINE', 'Submissions due today',
          'Campaign details are due today for pushes going live in 7 days.'),
         ('CONTENT', 'ASSIGNMENT', 'New campaigns in your queue',
          'CRM has handed over new campaigns for copy and creative.'),
         ('EXECUTIVE', 'BOTTLENECK', 'Final QC is the current bottleneck',
          'Campaigns are accumulating at the final QC stage.');
end $$;

-- Quick sanity check
select
  (select count(*) from calendar_days)  as days,
  (select count(*) from calendar_slots) as slots,
  (select count(*) from campaigns)      as campaigns,
  (select count(*) from campaigns where campaign_origin = 'CATEGORY_REQUEST') as category_requested,
  (select count(*) from campaigns where campaign_origin = 'CRM_PLANNED')      as crm_planned;
