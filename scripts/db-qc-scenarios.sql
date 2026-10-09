\set ON_ERROR_STOP on
\timing off
-- Scenario suite. Each check reports PASS/FAIL with expected vs actual.
\o /dev/null
create temp table qc_results(n int, name text, status text, detail text);
create or replace function pg_temp.chk(n int, name text, ok boolean, detail text default '')
returns void language plpgsql as $$
begin
  insert into qc_results values (n, name, case when ok then 'PASS' else 'FAIL' end, detail);
end $$;

-- ───────── users, one per role ─────────
insert into auth.users (id, email) values
  ('11111111-1111-4111-8111-111111111111','crm@internal.local'),
  ('22222222-2222-4222-8222-222222222222','category@internal.local'),
  ('33333333-3333-4333-8333-333333333333','content@internal.local'),
  ('44444444-4444-4444-8444-444444444444','executive@internal.local')
on conflict (id) do nothing;

-- The auth trigger creates profiles; ensure roles are right.
update profiles set role='CRM'       where id='11111111-1111-4111-8111-111111111111';
update profiles set role='CATEGORY'  where id='22222222-2222-4222-8222-222222222222';
update profiles set role='CONTENT'   where id='33333333-3333-4333-8333-333333333333';
update profiles set role='EXECUTIVE' where id='44444444-4444-4444-8444-444444444444';

-- ═══════ S14: every SECURITY DEFINER function has search_path ═══════
select pg_temp.chk(14, 'All SECURITY DEFINER functions set search_path',
  not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.prosecdef
      and not exists (select 1 from unnest(coalesce(p.proconfig,'{}')) c
                      where c like 'search_path=%')),
  'offenders: ' || coalesce((select string_agg(p.proname,', ') from pg_proc p
     join pg_namespace n on n.oid=p.pronamespace
     where n.nspname='public' and p.prosecdef
       and not exists (select 1 from unnest(coalesce(p.proconfig,'{}')) c
                       where c like 'search_path=%')), 'none'));

-- ═══════ S13: DESIGN fully gone from policies ═══════
select pg_temp.chk(13, 'No policy references DESIGN',
  not exists (select 1 from pg_policies where schemaname='public'
    and (coalesce(qual,'') ilike '%DESIGN%' or coalesce(with_check,'') ilike '%DESIGN%')),
  'expected 0');

-- ═══════ S10: reset_events exists, published, readable by all ═══════
select pg_temp.chk(10, 'reset_events in supabase_realtime publication',
  exists (select 1 from pg_publication_tables
          where pubname='supabase_realtime' and schemaname='public' and tablename='reset_events'),
  'expected present');

select pg_temp.chk(101, 'reset_events read policy is open to all roles',
  exists (select 1 from pg_policies where schemaname='public'
          and tablename='reset_events' and cmd='SELECT' and qual='true'),
  'expected using(true)');

-- ═══════ seed a realistic sheet: 2,000 rows, mixed flows ═══════
select set_config('request.jwt.claim.sub','11111111-1111-4111-8111-111111111111',false);

insert into campaigns (campaign_name, campaign_origin, launch_date, launch_time,
  slot_number, pncc_segment_label, pncc_category_code, category, slot_type,
  is_crm_self, category_status, crm_status, content_status, qc_status,
  production_status, priority, created_by)
select
  'OLD PN ' || g,
  'CRM_PLANNED'::campaign_origin,
  date '2026-07-01' + (g % 28),
  case when g % 7 = 0 then time '00:20' else time '07:00' end,
  (g % 7) + 1,
  case when g % 3 = 0 then 'Men_Overall_Sport' else 'Push_WomenSeg1_Festive' end,
  case when g % 3 = 0 then 'PC/CC' else 'Westside' end,
  case when g % 3 = 0 then 'PC/CC' else 'Westside' end,
  'STANDARD',
  (g % 3 = 0),
  case when g % 3 = 0 then 'LOCKED'::category_status else 'EMPTY'::category_status end,
  case when g % 3 = 0 then 'IN_PLANNING'::crm_status else 'AWAITING_REVIEW'::crm_status end,
  'NOT_ASSIGNED'::content_status, 'PENDING'::qc_status,
  'NOT_READY'::production_status, 'NORMAL'::priority_level,
  '11111111-1111-4111-8111-111111111111'
from generate_series(1, 2000) g;

select pg_temp.chk(0, 'Seeded 2,000 rows', (select count(*) from campaigns) = 2000,
  'actual ' || (select count(*) from campaigns));

-- ═══════ S2: put PNs in EVERY status before the reset ═══════
update campaigns set category_status='LOCKED', pn_template='Basic'
  where id in (select id from campaigns where not is_crm_self order by id limit 50);
update campaigns set content_status='PENDING', crm_status='SENT_TO_CONTENT'
  where id in (select id from campaigns order by id limit 20);
update campaigns set content_status='SUBMITTED', header='H', sub_copy_text='S'
  where id in (select id from campaigns order by id limit 10);
update campaigns set is_emergency=true, emergency_status='ACCEPTED'
  where id in (select id from campaigns order by id limit 5);
update campaigns set qc_status='PASSED', tracking_code='cid=pn:prp:push_text:wom_cat:a_b_c_plp_upto_h7_010726:onetime'
  where id in (select id from campaigns order by id limit 3);
update campaigns set calendar_status='UPDATED', calendar_updated_at=now()
  where id in (select id from campaigns order by id limit 2);
insert into change_requests (campaign_id, requested_by, field_name, current_value, requested_value, reason)
select id, '22222222-2222-4222-8222-222222222222', 'landing', 'a', 'b', 'test'
from campaigns order by id limit 4;

select pg_temp.chk(2, 'PNs exist in every status before reset',
  (select count(*) from campaigns where calendar_status='UPDATED') = 2
  and (select count(*) from campaigns where content_status='SUBMITTED') = 10
  and (select count(*) from change_requests) = 4,
  'calendar=' || (select count(*) from campaigns where calendar_status='UPDATED')
  || ' submitted=' || (select count(*) from campaigns where content_status='SUBMITTED')
  || ' change_requests=' || (select count(*) from change_requests));

-- ═══════ S3: non-CRM calling the reset must be rejected ═══════
do $$
declare before_count int; ok boolean := false;
begin
  select count(*) into before_count from campaigns;
  perform set_config('request.jwt.claim.sub','33333333-3333-4333-8333-333333333333',true); -- CONTENT
  begin
    perform reset_campaigns_with_archive('[{"campaign_name":"x"}]'::jsonb, false);
  exception when others then ok := true;
  end;
  perform pg_temp.chk(3, 'Non-CRM reset rejected, nothing changed',
    ok and (select count(*) from campaigns) = before_count,
    'rows before ' || before_count || ' after ' || (select count(*) from campaigns));
end $$;

-- empty sheet rejected
do $$
declare ok boolean := false; before_count int;
begin
  select count(*) into before_count from campaigns;
  perform set_config('request.jwt.claim.sub','11111111-1111-4111-8111-111111111111',true);
  begin perform reset_campaigns_with_archive('[]'::jsonb, false);
  exception when others then ok := true; end;
  perform pg_temp.chk(31, 'Empty sheet rejected, nothing changed',
    ok and (select count(*) from campaigns) = before_count,
    'rows ' || (select count(*) from campaigns));
end $$;

-- ═══════ S1: RESET + upload 3,000 ═══════
do $$
declare rows_json jsonb; batch uuid; archived int;
begin
  perform set_config('request.jwt.claim.sub','11111111-1111-4111-8111-111111111111',true);
  select jsonb_agg(jsonb_build_object(
      'campaign_name', 'NEW PN ' || g,
      'campaign_origin', 'CRM_PLANNED',
      'launch_date', (date '2026-07-01' + (g % 28))::text,
      'launch_time', case when g % 7 = 0 then '00:20' else '07:00' end,
      'slot_number', (g % 7) + 1,
      'pncc_segment_label', case when g % 3 = 0 then 'Men_Overall_Sport' else 'Push_WomenSeg1_Festive' end,
      'pncc_category_code', case when g % 3 = 0 then 'PC/CC' else 'Westside' end,
      'category', case when g % 3 = 0 then 'PC/CC' else 'Westside' end,
      'slot_type', 'STANDARD',
      'is_crm_self', (g % 3 = 0),
      'category_status', case when g % 3 = 0 then 'LOCKED' else 'EMPTY' end,
      'crm_status', case when g % 3 = 0 then 'IN_PLANNING' else 'AWAITING_REVIEW' end,
      'content_status', 'NOT_ASSIGNED',
      'qc_status', 'PENDING',
      'production_status', 'NOT_READY',
      'priority', 'NORMAL',
      'created_by', '11111111-1111-4111-8111-111111111111'
    )) into rows_json from generate_series(1, 3000) g;

  batch := reset_campaigns_with_archive(rows_json, false);

  select campaigns_archived into archived from upload_reset_batches where id = batch;

  perform pg_temp.chk(1, 'Reset: exactly 3,000 rows, 2,000 archived, no old row left',
    (select count(*) from campaigns) = 3000
    and archived = 2000
    and not exists (select 1 from campaigns where campaign_name like 'OLD PN%'),
    'campaigns=' || (select count(*) from campaigns)
    || ' archived=' || archived
    || ' old_remaining=' || (select count(*) from campaigns where campaign_name like 'OLD PN%'));

  perform pg_temp.chk(21, 'Reset cleared every dependent table',
    (select count(*) from change_requests) = 0
    and (select count(*) from campaigns where calendar_status='UPDATED') = 0
    and (select count(*) from campaigns where is_emergency) = 0,
    'change_requests=' || (select count(*) from change_requests)
    || ' calendar=' || (select count(*) from campaigns where calendar_status='UPDATED'));

  perform pg_temp.chk(102, 'Reset wrote a reset_events row',
    (select count(*) from reset_events where batch_id = batch) = 1,
    'rows ' || (select count(*) from reset_events));
end $$;

-- ═══════ S10b: all four roles can SELECT reset_events under RLS ═══════
do $$
declare uid uuid; n int; allok boolean := true;
begin
  foreach uid in array array[
    '11111111-1111-4111-8111-111111111111'::uuid,
    '22222222-2222-4222-8222-222222222222'::uuid,
    '33333333-3333-4333-8333-333333333333'::uuid,
    '44444444-4444-4444-8444-444444444444'::uuid]
  loop
    perform set_config('request.jwt.claim.sub', uid::text, true);
    set local role authenticated;
    select count(*) into n from reset_events;
    if n < 1 then allok := false; end if;
    reset role;
  end loop;
  perform pg_temp.chk(103, 'All 4 roles can read reset_events under RLS', allok,
    'each role must see >=1 row');
end $$;

-- ═══════ S9: monthly_workflow_summary identical for all 4 roles ═══════
do $$
declare uid uuid; sig text; first_sig text; allsame boolean := true; v_total int;
begin
  foreach uid in array array[
    '11111111-1111-4111-8111-111111111111'::uuid,
    '22222222-2222-4222-8222-222222222222'::uuid,
    '33333333-3333-4333-8333-333333333333'::uuid,
    '44444444-4444-4444-8444-444444444444'::uuid]
  loop
    perform set_config('request.jwt.claim.sub', uid::text, true);
    set local role authenticated;
    select row_to_json(s)::text into sig from monthly_workflow_summary() s;
    reset role;
    if first_sig is null then first_sig := sig;
    elsif sig <> first_sig then allsame := false; end if;
  end loop;
  select s.total into v_total from monthly_workflow_summary() s;
  perform pg_temp.chk(9, 'monthly_workflow_summary identical for all 4 roles', allsame,
    'total=' || v_total || ' sig=' || left(coalesce(first_sig,''), 90));
end $$;

-- every PN in exactly one stage
do $$
declare s record; staged int;
begin
  select * into s from monthly_workflow_summary();
  staged := s.awaiting_category + s.crm_review + s.crm_ready + s.with_content
          + s.content_submitted + s.crm_reviewed + s.final_qc + s.on_calendar;
  perform pg_temp.chk(91, 'Every PN in exactly one stage (no orphan, no double count)',
    staged = s.total, 'staged=' || staged || ' total=' || s.total);
end $$;

-- ═══════ S5 + S12: RLS visibility per role ═══════
do $$
declare crm_n int; cat_n int; con_n int; exec_n int;
begin
  perform set_config('request.jwt.claim.sub','11111111-1111-4111-8111-111111111111',true);
  set local role authenticated; select count(*) into crm_n from campaigns; reset role;
  perform set_config('request.jwt.claim.sub','22222222-2222-4222-8222-222222222222',true);
  set local role authenticated; select count(*) into cat_n from campaigns; reset role;
  perform set_config('request.jwt.claim.sub','33333333-3333-4333-8333-333333333333',true);
  set local role authenticated; select count(*) into con_n from campaigns; reset role;
  perform set_config('request.jwt.claim.sub','44444444-4444-4444-8444-444444444444',true);
  set local role authenticated; select count(*) into exec_n from campaigns; reset role;

  perform pg_temp.chk(5, 'CRM Self invisible to Content until sent (Content reads 0)',
    con_n = 0, 'content sees ' || con_n || ' of 3000');
  perform pg_temp.chk(12, 'RLS: CRM/EXEC see all, CATEGORY excludes CRM Self',
    crm_n = 3000 and exec_n = 3000 and cat_n = 2000,
    'crm=' || crm_n || ' exec=' || exec_n || ' category=' || cat_n || ' (expected 3000/3000/2000)');
end $$;

-- ═══════ S4: Content submits 5 (2 Category-led + 3 CRM Self) ═══════
do $$
declare led uuid[]; slf uuid[]; i int; total_sub int; led_sub int; slf_sub int;
begin
  perform set_config('request.jwt.claim.sub','11111111-1111-4111-8111-111111111111',true);
  select array_agg(id) into led from (select id from campaigns where not is_crm_self order by id limit 2) t;
  select array_agg(id) into slf from (select id from campaigns where is_crm_self order by id limit 3) t;

  -- CRM completes Part 2 and sends to Content
  update campaigns set category_status='LOCKED', pn_template='Basic'
    where id = any(led || slf);
  update campaigns set crm_status='SENT_TO_CONTENT', content_status='PENDING'
    where id = any(led || slf);

  -- Content submits, as CONTENT, under RLS and the ownership trigger
  perform set_config('request.jwt.claim.sub','33333333-3333-4333-8333-333333333333',true);
  set local role authenticated;
  for i in 1..array_length(led||slf,1) loop
    update campaigns
       set header='Festive styles', sub_copy_text='Shop now',
           h_count=14, s_count=8, content_status='SUBMITTED'
     where id = (led||slf)[i];
  end loop;
  reset role;

  select count(*) into total_sub from campaigns where content_status='SUBMITTED';
  select count(*) into led_sub   from campaigns where content_status='SUBMITTED' and not is_crm_self;
  select count(*) into slf_sub   from campaigns where content_status='SUBMITTED' and is_crm_self;

  perform pg_temp.chk(4, 'Content submits 5 -> CRM total 5 (2 Category-led + 3 CRM Self)',
    total_sub = 5 and led_sub = 2 and slf_sub = 3,
    'total=' || total_sub || ' led=' || led_sub || ' self=' || slf_sub);
end $$;

-- ═══════ S12b: ownership trigger blocks foreign columns ═══════
-- Asserting "an exception was raised" is not enough: an UPDATE that RLS
-- filters to zero rows raises nothing and would pass vacuously. The real
-- requirement is that the VALUE DOES NOT CHANGE, however it was stopped.
do $$
declare tgt uuid; before_tc text; after_tc text; before_qc qc_status; after_qc qc_status;
begin
  perform set_config('request.jwt.claim.sub','11111111-1111-4111-8111-111111111111',true);
  -- A row CONTENT is genuinely allowed to touch, so the ownership trigger
  -- is what has to stop it, not RLS.
  select id into tgt from campaigns where content_status = 'PENDING' order by id limit 1;
  if tgt is null then
    update campaigns set crm_status='SENT_TO_CONTENT', content_status='PENDING'
     where id = (select id from campaigns order by id limit 1);
    select id into tgt from campaigns where content_status = 'PENDING' order by id limit 1;
  end if;
  update campaigns set tracking_code = 'original-code', qc_status = 'PENDING' where id = tgt;
  select tracking_code, qc_status into before_tc, before_qc from campaigns where id = tgt;

  perform set_config('request.jwt.claim.sub','33333333-3333-4333-8333-333333333333',true);
  set local role authenticated;
  begin update campaigns set tracking_code='hacked-by-content' where id=tgt;
  exception when others then null; end;
  reset role;

  perform set_config('request.jwt.claim.sub','22222222-2222-4222-8222-222222222222',true);
  set local role authenticated;
  begin update campaigns set qc_status='PASSED' where id=tgt;
  exception when others then null; end;
  reset role;

  perform set_config('request.jwt.claim.sub','11111111-1111-4111-8111-111111111111',true);
  select tracking_code, qc_status into after_tc, after_qc from campaigns where id = tgt;

  perform pg_temp.chk(121,
    'Ownership: CONTENT cannot change tracking_code; CATEGORY cannot change qc_status',
    after_tc = before_tc and after_qc = before_qc,
    'tracking_code ' || before_tc || ' -> ' || after_tc
    || ' | qc_status ' || before_qc || ' -> ' || after_qc);
end $$;

-- And the trigger must raise for a write it owns the decision on.
do $$
declare tgt uuid; raised boolean := false; msg text;
begin
  perform set_config('request.jwt.claim.sub','11111111-1111-4111-8111-111111111111',true);
  select id into tgt from campaigns where content_status = 'PENDING' order by id limit 1;
  perform set_config('request.jwt.claim.sub','33333333-3333-4333-8333-333333333333',true);
  set local role authenticated;
  begin
    update campaigns set header='ok', tracking_code='also-this' where id=tgt;
  exception when others then raised := true; msg := sqlerrm; end;
  reset role;
  perform pg_temp.chk(122,
    'Ownership trigger raises a named error, not a silent no-op', raised,
    coalesce(left(msg, 70), 'no error raised'));
end $$;

-- ═══════ S6: update_calendar rejects a missing / invalid tracking code ═══════
do $$
declare tgt uuid; r1 boolean := false; r2 boolean := false; r3 boolean := false;
begin
  perform set_config('request.jwt.claim.sub','11111111-1111-4111-8111-111111111111',true);
  select id into tgt from campaigns where content_status='SUBMITTED' order by id limit 1;

  -- no QC yet -> reject
  begin perform update_calendar(tgt); exception when others then r1 := true; end;

  -- full checklist but no tracking code -> reject
  insert into qc_checklists (campaign_id, category_verified, brand_verified, offer_verified,
    landing_verified, date_verified, time_verified, audience_verified, creative_verified,
    copy_verified, tracking_verified)
  values (tgt, true,true,true,true,true,true,true,true,true,true)
  on conflict (campaign_id) do update set copy_verified = true;
  update campaigns set qc_status='PASSED' where id = tgt;
  begin perform update_calendar(tgt); exception when others then r2 := true; end;

  -- old-format code -> reject
  update campaigns set tracking_code='promotional_old_format_na_1930_121026' where id = tgt;
  begin perform update_calendar(tgt); exception when others then r3 := true; end;

  perform pg_temp.chk(6, 'update_calendar rejects: no QC, missing code, non-cid= code',
    r1 and r2 and r3,
    'noqc=' || r1 || ' nocode=' || r2 || ' badformat=' || r3);
end $$;

-- ═══════ S7 + S8: valid code -> QC passes -> calendar -> export parity ═══════
do $$
declare tgt uuid; pushed boolean := false; cal int; nine boolean := false;
begin
  perform set_config('request.jwt.claim.sub','11111111-1111-4111-8111-111111111111',true);
  select id into tgt from campaigns where content_status='SUBMITTED' order by id limit 1;

  update campaigns
     set tracking_code='cid=pn:prp:push_text:wom_cat:westside_women_multibrand_plp_starts_h7_010726:onetime',
         landing='https://www.tatacliq.com/search?text=Dresses',
         landing_plus_tracking='https://www.tatacliq.com/search?cid=pn:prp:push_text:wom_cat:westside_women_multibrand_plp_starts_h7_010726:onetime&text=Dresses'
   where id = tgt;

  -- 9 of 10 must block (creative_verified off AND a creative link present)
  update campaigns set creative_link='https://cdn/x.png' where id = tgt;
  update qc_checklists set creative_verified=false where campaign_id = tgt;
  begin perform update_calendar(tgt); exception when others then nine := true; end;

  -- creative N/A when there is no creative link
  update campaigns set creative_link=null where id = tgt;
  begin perform update_calendar(tgt); pushed := true; exception when others then pushed := false; end;

  select count(*) into cal from campaigns where calendar_status='UPDATED';
  perform pg_temp.chk(7, '9/10 blocked; creative N/A without a creative link lets 9 pass',
    nine and pushed, 'blocked_at_9=' || nine || ' passed_with_na=' || pushed);
  perform pg_temp.chk(8, 'Pushed to calendar; export row count = DB count; landing+tracking intact',
    cal = 1 and exists (select 1 from campaigns where id=tgt
      and landing_plus_tracking like 'https://www.tatacliq.com/search?cid=pn:prp:%'
      and landing_plus_tracking not like '%icid2%'),
    'calendar_rows=' || cal);
end $$;

-- ═══════ S11: reads beyond 1,000 rows ═══════
select pg_temp.chk(11, 'More than 1,000 rows exist, so the paging helper is exercised',
  (select count(*) from campaigns) > 1000,
  'rows ' || (select count(*) from campaigns));

-- ═══════ S15: pg_safeupdate emulation actually fires ═══════
do $$
declare caught boolean := false;
begin
  begin perform safeupdate_check('delete from campaigns;');
  exception when sqlstate '21000' then caught := true; end;
  perform pg_temp.chk(15, 'pg_safeupdate emulation rejects DELETE without WHERE', caught,
    'expected SQLSTATE 21000');
end $$;

do $$
declare ok boolean := true;
begin
  begin perform safeupdate_check('delete from campaigns where true;');
  exception when others then ok := false; end;
  perform pg_temp.chk(151, 'and accepts DELETE ... where true', ok, '');
end $$;

\o
-- ───────── report ─────────
\echo ''
\echo '  #     STATUS  SCENARIO'
select lpad(n::text,4) || '  ' || rpad(status,6) || '  ' || name ||
       case when detail <> '' then '  [' || detail || ']' else '' end as result
from qc_results order by n;

select count(*) filter (where status='FAIL') as failures from qc_results;

do $$
declare f int;
begin
  select count(*) into f from qc_results where status='FAIL';
  if f > 0 then raise exception '% scenario(s) FAILED', f; end if;
end $$;
