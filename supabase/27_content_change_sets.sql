-- =====================================================================
-- CLiQ Push Ops — 27: what Content changed, so CRM need not open every row
--
-- Run TWENTY-SEVENTH, after 26. Idempotent; safe to rerun.
--
-- WHY A TABLE
-- CRM must see "Header Updated, Sub Copy Updated" at a glance. That cannot
-- be derived after the fact: once Content's copy is written, the previous
-- value is gone, and activity_logs records WHICH campaign changed but not
-- WHICH COLUMN. So the diff is captured at import time, when both the old
-- and the new value are in hand.
--
-- Content-owned fields only: header, sub_copy_text, reference_link.
-- Nothing here changes the workflow; it is a record CRM reads.
-- =====================================================================

create table if not exists content_change_sets (
  id           uuid primary key default gen_random_uuid(),
  campaign_id  uuid not null references campaigns(id) on delete cascade,
  -- Groups one Excel import or one bulk send together.
  batch_id     uuid,
  -- {header, sub_copy_text, reference_link}
  changed_fields text[] not null default '{}',
  changed_by   uuid references profiles(id),
  changed_at   timestamptz not null default now(),
  -- "IMPORT" when it arrived from a workbook, "PREVIEW_EDIT" for an inline
  -- correction. Lets CRM tell a bulk change from a one-off fix.
  source       text not null default 'IMPORT',
  -- Cleared when CRM has reviewed, so the diff shows only what is new.
  acknowledged_at timestamptz,
  acknowledged_by uuid references profiles(id)
);

create index if not exists content_change_sets_campaign_idx
  on content_change_sets (campaign_id, changed_at desc);
create index if not exists content_change_sets_batch_idx
  on content_change_sets (batch_id);
-- The common CRM query: what is still unreviewed.
create index if not exists content_change_sets_open_idx
  on content_change_sets (changed_at desc) where acknowledged_at is null;

alter table content_change_sets enable row level security;

-- Everyone reads: CRM needs it, and Content should see what it recorded.
drop policy if exists content_change_sets_read on content_change_sets;
create policy content_change_sets_read on content_change_sets
  for select to authenticated using (true);

-- CONTENT writes its own changes; CRM acknowledges them.
drop policy if exists content_change_sets_write on content_change_sets;
create policy content_change_sets_write on content_change_sets
  for insert to authenticated
  with check (public.current_app_role() = 'CONTENT'::app_role
           or public.is_crm());

drop policy if exists content_change_sets_ack on content_change_sets;
create policy content_change_sets_ack on content_change_sets
  for update to authenticated
  using (public.is_crm()) with check (public.is_crm());

-- ═════════ CRM-facing summary ═════════
-- One row per campaign with unreviewed Content changes, fields merged.
create or replace function public.content_changes_for_review()
returns table (
  campaign_id    uuid,
  campaign_name  text,
  changed_fields text[],
  changed_at     timestamptz,
  change_count   integer
) language sql security definer set search_path = public stable as $$
  select
    cs.campaign_id,
    c.campaign_name,
    -- Merged and de-duplicated: three edits to the Header are one
    -- "Header Updated", not three.
    array(select distinct unnest(array_agg(f.field))) as changed_fields,
    max(cs.changed_at),
    count(*)::int
  from content_change_sets cs
  join campaigns c on c.id = cs.campaign_id
  cross join lateral unnest(cs.changed_fields) as f(field)
  where cs.acknowledged_at is null
  group by cs.campaign_id, c.campaign_name
  order by max(cs.changed_at) desc;
$$;
grant execute on function public.content_changes_for_review() to authenticated;

-- CRM marks a campaign's changes as seen.
create or replace function public.acknowledge_content_changes(p_campaign_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_crm() then
    raise exception 'Only CRM can acknowledge content changes.';
  end if;
  update content_change_sets
     set acknowledged_at = now(), acknowledged_by = auth.uid()
   where campaign_id = p_campaign_id and acknowledged_at is null;
end $$;
grant execute on function public.acknowledge_content_changes(uuid) to authenticated;

-- ═════════ VERIFY ═════════
select c.relname, c.relrowsecurity as rls,
       (select count(*) from pg_policies p
        where p.schemaname='public' and p.tablename=c.relname) as policies
from pg_class c join pg_namespace n on n.oid=c.relnamespace
where n.nspname='public' and c.relname = 'content_change_sets';

notify pgrst, 'reload schema';
