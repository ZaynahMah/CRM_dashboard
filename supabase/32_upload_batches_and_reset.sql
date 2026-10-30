-- =====================================================================
-- CLiQ Push Ops — 32: upload batches + "Reset last upload"
--
-- Run THIRTY-SECOND, after 31. Idempotent; safe to rerun.
-- THIS MIGRATION DELETES NOTHING when you run it.
--
-- WHAT IT REPLACES
-- Uploads used `reset_campaigns_with_archive()`, which wiped the stream's
-- running PNs before inserting. Uploads become ADD-ONLY: `add_upload_batch()`
-- only inserts. The old function is left in the database, unreferenced.
--
-- WHAT IT ADDS
-- Every uploaded row is tagged with a batch, so the MOST RECENT batch of a
-- stream can be undone — and only its UNTOUCHED rows.
--
-- "UNTOUCHED" IS CONJUNCTIVE AND FAILS CLOSED. A row is untouched only if
-- ALL of these hold; anything unevaluable counts as TOUCHED:
--   * every status column still at its upload-time starting value
--   * no row in crm_decisions, change_requests, qc_checklists or
--     content_change_sets
--   * no activity_logs row other than the upload event itself
--   * defaulted_at is null
--   * calendar_status is not 'UPDATED'
--   * no human value in any Category / Part 2 / Content column
-- `category_status` is NEVER used alone: it is written inconsistently.
-- =====================================================================

-- ═════════ READ-ONLY CHECK — run this FIRST ═════════
select
  to_regclass('public.upload_batches') is not null            as batches_table_exists,
  (select count(*) from information_schema.columns
    where table_schema='public' and table_name='campaigns'
      and column_name='upload_batch_id')                      as batch_column_exists,
  (select count(*) from campaigns)                            as campaigns_total,
  (select count(*) from campaigns where true)                 as campaigns_untouched_by_this;
-- Expect false / 0 on a first run. campaigns_total must be IDENTICAL before
-- and after running this file — it inserts and alters only.

-- ═════════ 1. THE BATCH LOG ═════════
-- Survives any later deletion of PNs: no FK from here to campaigns.
create table if not exists upload_batches (
  id            uuid primary key default gen_random_uuid(),
  stream        text not null check (stream in ('CATEGORY_LED','CRM_SELF')),
  uploaded_by   uuid references profiles(id),
  uploaded_name text,
  file_name     text,
  file_sha256   text,
  row_count     integer not null default 0,
  min_date      date,
  max_date      date,
  created_at    timestamptz not null default now(),
  reset_at      timestamptz,
  reset_by_name text,
  rows_removed  integer,
  rows_kept     integer
);
create index if not exists upload_batches_stream_idx
  on upload_batches (stream, created_at desc);
create index if not exists upload_batches_hash_idx
  on upload_batches (file_sha256) where file_sha256 is not null;

-- Nullable on purpose: rows that pre-date this migration have no batch and
-- are therefore NOT resettable. They are never backfilled.
alter table campaigns add column if not exists upload_batch_id uuid
  references upload_batches(id) on delete set null;
create index if not exists campaigns_upload_batch_idx
  on campaigns (upload_batch_id) where upload_batch_id is not null;

alter table upload_batches enable row level security;
drop policy if exists upload_batches_read on upload_batches;
create policy upload_batches_read on upload_batches
  for select to authenticated using (public.is_crm());

-- ═════════ 2. AUDIT ═════════
create table if not exists upload_reset_audit (
  id             uuid primary key default gen_random_uuid(),
  batch_id       uuid,
  stream         text,
  performed_by   uuid references profiles(id),
  performed_name text not null,
  rows_removed   integer not null default 0,
  rows_kept      integer not null default 0,
  backup_sha256  text,
  backup_name    text,
  created_at     timestamptz not null default now()
);
alter table upload_reset_audit enable row level security;
drop policy if exists upload_reset_audit_read on upload_reset_audit;
create policy upload_reset_audit_read on upload_reset_audit
  for select to authenticated using (public.is_crm());

-- ═════════ 3. ADD-ONLY UPLOAD ═════════
-- Inserts and nothing else. No delete, no update of an existing row.
create or replace function public.add_upload_batch(
  p_rows        jsonb,
  p_is_crm_self boolean,
  p_file_name   text,
  p_file_sha256 text,
  p_by_name     text
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_batch  uuid;
  v_stream text := case when p_is_crm_self then 'CRM_SELF' else 'CATEGORY_LED' end;
  v_count  integer;
begin
  if not public.is_crm() then
    raise exception 'Only CRM can upload campaigns.';
  end if;
  if coalesce(btrim(p_by_name), '') = '' then
    raise exception 'Your name is required on an upload.';
  end if;
  if p_rows is null or jsonb_typeof(p_rows) <> 'array'
     or jsonb_array_length(p_rows) = 0 then
    raise exception 'Refusing to upload: the sheet contains no rows.';
  end if;
  if exists (select 1 from jsonb_array_elements(p_rows) e
             where coalesce(e->>'campaign_name','') = '' or (e->>'launch_date') is null) then
    raise exception
      'Every row needs a campaign_name and a launch_date. Check the Date column.';
  end if;

  insert into upload_batches (
    stream, uploaded_by, uploaded_name, file_name, file_sha256, row_count)
  values (v_stream, auth.uid(), btrim(p_by_name), p_file_name, p_file_sha256,
          jsonb_array_length(p_rows))
  returning id into v_batch;

  insert into campaigns (
    campaign_name, campaign_origin, launch_date, launch_time, slot_number, slot_label,
    pncc_segment_label, pncc_category_code, category, slot_type, is_crm_self,
    sub_category, brand, offer, title_brief, message_brief, pn_template,
    creative_requirements, category_status, crm_status, content_status,
    qc_status, production_status, priority, created_by, upload_batch_id)
  select
    r.campaign_name, coalesce(r.campaign_origin,'CRM_PLANNED')::campaign_origin,
    r.launch_date, r.launch_time, r.slot_number, r.slot_label,
    r.pncc_segment_label, r.pncc_category_code, r.category,
    coalesce(r.slot_type,'STANDARD'), p_is_crm_self,
    r.sub_category, r.brand, r.offer, r.title_brief, r.message_brief, r.pn_template,
    r.creative_requirements,
    coalesce(r.category_status,'EMPTY')::category_status,
    coalesce(r.crm_status, case when p_is_crm_self then 'IN_PLANNING'
                                else 'AWAITING_REVIEW' end)::crm_status,
    coalesce(r.content_status,'NOT_ASSIGNED')::content_status,
    coalesce(r.qc_status,'PENDING')::qc_status,
    coalesce(r.production_status,'NOT_READY')::production_status,
    coalesce(r.priority,'NORMAL')::priority_level,
    auth.uid(), v_batch
  from jsonb_to_recordset(p_rows) as r(
    campaign_name text, campaign_origin text, launch_date date, launch_time time,
    slot_number integer, slot_label text, pncc_segment_label text, pncc_category_code text,
    category text, slot_type text,
    sub_category text, brand text, offer text, title_brief text, message_brief text,
    pn_template text, creative_requirements text,
    category_status text, crm_status text, content_status text, qc_status text,
    production_status text, priority text);
  get diagnostics v_count = row_count;

  if v_count <> jsonb_array_length(p_rows) then
    raise exception 'Insert incomplete: % of % rows written. Aborting.',
      v_count, jsonb_array_length(p_rows);
  end if;

  update upload_batches
     set min_date = (select min(launch_date) from campaigns where upload_batch_id = v_batch),
         max_date = (select max(launch_date) from campaigns where upload_batch_id = v_batch)
   where id = v_batch;

  insert into activity_logs (campaign_id, user_id, action, description)
  values (null, auth.uid(), 'UPLOAD_BATCH',
    format('CRM (%s) uploaded %s %s PN(s) from "%s". Batch %s. Add-only: nothing existing was changed.',
      btrim(p_by_name), v_count, v_stream, coalesce(p_file_name,'a file'), v_batch));

  return v_batch;
end $$;
grant execute on function public.add_upload_batch(jsonb, boolean, text, text, text) to authenticated;

-- ═════════ 4. UNTOUCHED — conjunctive, fail-closed ═════════
create or replace function public.is_untouched_upload_row(p_campaign_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from campaigns c
    where c.id = p_campaign_id
      -- statuses still at their upload-time starting values
      and c.category_status  = 'EMPTY'::category_status
      and c.content_status   = 'NOT_ASSIGNED'::content_status
      and c.qc_status        = 'PENDING'::qc_status
      and c.production_status = 'NOT_READY'::production_status
      and c.crm_status in ('AWAITING_REVIEW'::crm_status, 'IN_PLANNING'::crm_status)
      and c.calendar_status is distinct from 'UPDATED'
      and c.defaulted_at is null
      -- no human value in any team-owned column
      and c.sub_category is null and c.brand is null and c.offer is null
      and c.brief is null and c.landing is null
      and c.expected_cvr is null and c.expected_rpv is null
      and c.additional_notes is null
      and c.title_brief is null and c.message_brief is null
      and c.pn_template is null and c.creative_requirements is null
      and c.header is null and c.sub_copy_text is null
      and c.reference_link is null and c.creative_link is null
      and c.tracking_code is null
      and coalesce(c.send_back_count, 0) = 0
      -- no child rows anywhere
      and not exists (select 1 from crm_decisions       x where x.campaign_id = c.id)
      and not exists (select 1 from change_requests     x where x.campaign_id = c.id)
      and not exists (select 1 from qc_checklists       x where x.campaign_id = c.id)
      and not exists (select 1 from content_change_sets x where x.campaign_id = c.id)
      -- no activity beyond the upload event
      and not exists (select 1 from activity_logs x
                      where x.campaign_id = c.id and x.action <> 'UPLOAD_BATCH')
  );
$$;
grant execute on function public.is_untouched_upload_row(uuid) to authenticated;

-- What a reset WOULD do. Read-only.
create or replace function public.reset_last_upload_preview(p_is_crm_self boolean)
returns table (
  batch_id uuid, file_name text, uploaded_at timestamptz, uploaded_name text,
  total integer, untouched integer, touched integer
) language sql security definer set search_path = public stable as $$
  with b as (
    select * from upload_batches
     where stream = case when p_is_crm_self then 'CRM_SELF' else 'CATEGORY_LED' end
       and reset_at is null
     order by created_at desc limit 1
  )
  select b.id, b.file_name, b.created_at, b.uploaded_name,
         count(c.id)::int,
         count(*) filter (where public.is_untouched_upload_row(c.id))::int,
         count(*) filter (where not public.is_untouched_upload_row(c.id))::int
  from b left join campaigns c on c.upload_batch_id = b.id
  group by b.id, b.file_name, b.created_at, b.uploaded_name;
$$;
grant execute on function public.reset_last_upload_preview(boolean) to authenticated;

-- ═════════ 5. RESET THE LAST UPLOAD ═════════
create or replace function public.reset_last_upload(
  p_is_crm_self boolean,
  p_batch_id    uuid,
  p_row_ids     uuid[],
  p_backup_sha  text,
  p_backup_name text,
  p_by_name     text
) returns integer
language plpgsql security definer set search_path = public as $$
declare
  v_stream text := case when p_is_crm_self then 'CRM_SELF' else 'CATEGORY_LED' end;
  v_latest uuid;
  v_removed integer := 0;
  v_kept    integer := 0;
  v_now     uuid[];
begin
  if not public.is_crm() then
    raise exception 'Only CRM can reset an upload.';
  end if;
  if coalesce(btrim(p_by_name), '') = '' then
    raise exception 'Your name is required on a reset.';
  end if;
  if coalesce(btrim(p_backup_sha), '') = '' then
    raise exception 'A backup must be downloaded before the rows can be removed.';
  end if;

  -- Only the MOST RECENT un-reset batch of this stream.
  select id into v_latest from upload_batches
   where stream = v_stream and reset_at is null
   order by created_at desc limit 1;

  if v_latest is null then
    raise exception 'There is no upload to reset for this stream.';
  end if;
  if v_latest is distinct from p_batch_id then
    raise exception
      'That is not the most recent upload. Only the latest batch can be reset.';
  end if;

  -- Lock, then re-evaluate untouched from the CURRENT state.
  perform 1 from campaigns where upload_batch_id = p_batch_id for update;

  select array_agg(c.id order by c.id) into v_now
    from campaigns c
   where c.upload_batch_id = p_batch_id
     and public.is_untouched_upload_row(c.id);

  -- The set must be exactly what was previewed and backed up.
  if coalesce(v_now, '{}') is distinct from coalesce(
       (select array_agg(x order by x) from unnest(p_row_ids) x), '{}') then
    raise exception
      'The data changed since your preview. Run the preview and backup again.';
  end if;

  select count(*) into v_kept from campaigns
   where upload_batch_id = p_batch_id and not public.is_untouched_upload_row(id);

  -- Children first. Every statement carries a predicate (pg_safeupdate).
  delete from notifications       where campaign_id = any(v_now);
  delete from activity_logs       where campaign_id = any(v_now);
  delete from change_requests     where campaign_id = any(v_now);
  delete from qc_checklists       where campaign_id = any(v_now);
  delete from crm_decisions       where campaign_id = any(v_now);
  delete from content_change_sets where campaign_id = any(v_now);
  delete from content_submissions where campaign_id = any(v_now);

  delete from campaigns where id = any(v_now);
  get diagnostics v_removed = row_count;

  update upload_batches
     set reset_at = now(), reset_by_name = btrim(p_by_name),
         rows_removed = v_removed, rows_kept = v_kept
   where id = p_batch_id;

  insert into upload_reset_audit (
    batch_id, stream, performed_by, performed_name,
    rows_removed, rows_kept, backup_sha256, backup_name)
  values (p_batch_id, v_stream, auth.uid(), btrim(p_by_name),
          v_removed, v_kept, p_backup_sha, p_backup_name);

  insert into activity_logs (campaign_id, user_id, action, description)
  values (null, auth.uid(), 'UPLOAD_BATCH_RESET',
    format('CRM (%s) reset upload batch %s: %s untouched PN(s) removed, %s kept because a team had touched them.',
      btrim(p_by_name), p_batch_id, v_removed, v_kept));

  return v_removed;
end $$;
revoke all on function public.reset_last_upload(boolean, uuid, uuid[], text, text, text) from public;
grant execute on function public.reset_last_upload(boolean, uuid, uuid[], text, text, text) to authenticated;

-- ═════════ VERIFY ═════════
select (select count(*) from campaigns) as campaigns_total_unchanged,
       (select count(*) from upload_batches) as batches,
       (select count(*) from campaigns where upload_batch_id is null) as pre_update_rows_not_resettable;

notify pgrst, 'reload schema';
