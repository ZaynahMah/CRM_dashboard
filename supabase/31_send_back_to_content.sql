-- =====================================================================
-- CLiQ Push Ops — 31: CRM "Send back to Content"
--
-- Run THIRTY-FIRST, after 30. Idempotent; safe to rerun. Deletes nothing.
--
-- WHY A FUNCTION RATHER THAN A CLIENT WRITE
-- Sending a PN back resets `qc_status`, and `enforce_column_ownership()`
-- (migration 17) blocks non-CRM writes to it. More importantly the reset,
-- the status change, the reason, the counter, the notification and the
-- activity row must all land together or not at all — a PN sitting in
-- NEEDS_CHANGES with no reason is worse than one not sent back.
--
-- `content_status = 'NEEDS_CHANGES'` is REUSED, not replaced. The enum
-- already has it and every queue already routes it (crmBuckets.ts:57,
-- contentBulk.ts:233) — nothing has ever written it until now.
-- =====================================================================

-- ═════════ READ-ONLY CHECK — run this FIRST ═════════
select
  (select count(*) from information_schema.columns
    where table_schema='public' and table_name='campaigns'
      and column_name in ('send_back_count','send_back_reason',
                          'send_back_field','send_back_at','send_back_by_name')
  ) as campaign_columns_present,   -- expect 0 first run, 5 on a rerun
  (select count(*) from information_schema.columns
    where table_schema='public' and table_name='notifications'
      and column_name in ('priority','acknowledged_at','acknowledged_by',
                          'acknowledged_name','group_key')
  ) as notification_columns_present,  -- expect 0 first run, 5 on a rerun
  (select count(*) from campaigns where content_status = 'NEEDS_CHANGES')
    as rows_already_needing_changes;  -- expect 0: nothing writes it yet

-- ═════════ 1. SEND-BACK STATE ON THE ROW ═════════
-- The LATEST reason and the count live on the row so Content sees them at
-- the top of the PN without a join. Every send-back is also written to
-- activity_logs, so the full history is kept.
alter table campaigns add column if not exists send_back_count   integer not null default 0;
alter table campaigns add column if not exists send_back_reason   text;
alter table campaigns add column if not exists send_back_field    text;
alter table campaigns add column if not exists send_back_at       timestamptz;
-- Shared team logins mean the account is always "CRM"; the typed name is the
-- only way to know who actually did it.
alter table campaigns add column if not exists send_back_by_name  text;

-- ═════════ 2. NOTIFICATION PRIORITY, GROUPING, ACKNOWLEDGEMENT ═════════
-- Added now because the send-back notification needs them, and Phase 3's
-- change alerts will reuse the same columns rather than a parallel system.
alter table notifications add column if not exists priority         text not null default 'NORMAL';
alter table notifications add column if not exists group_key        text;
alter table notifications add column if not exists acknowledged_at  timestamptz;
alter table notifications add column if not exists acknowledged_by  uuid references profiles(id);
alter table notifications add column if not exists acknowledged_name text;

do $$ begin
  alter table notifications add constraint notifications_priority_chk
    check (priority in ('NORMAL','AMBER','RED'));
exception when duplicate_object then null; end $$;

-- The common reads: unacknowledged alerts for a role, newest first.
create index if not exists notifications_open_idx
  on notifications (target_role, priority, created_at desc)
  where acknowledged_at is null;
create index if not exists notifications_group_idx
  on notifications (group_key) where group_key is not null;

-- ═════════ 3. THE SEND-BACK ═════════
-- One PN. The bulk path calls this once per PN so every row gets its own
-- reason, counter increment, notification and activity entry.
create or replace function public.send_back_to_content(
  p_campaign_id uuid,
  p_reason      text,
  p_by_name     text,
  p_field       text default null
)
returns campaigns
language plpgsql security definer set search_path = public as $$
declare
  c campaigns;
begin
  if not public.is_crm() then
    raise exception 'Only CRM can send a PN back to Content.';
  end if;
  if coalesce(btrim(p_reason), '') = '' then
    raise exception 'A reason is required so Content knows what to fix.';
  end if;
  if coalesce(btrim(p_by_name), '') = '' then
    raise exception 'Your name is required on a send-back.';
  end if;

  -- Locked for the duration: a concurrent Content resubmit must not
  -- interleave with the status change.
  select * into c from campaigns where id = p_campaign_id for update;
  if not found then
    raise exception 'That PN no longer exists.';
  end if;

  -- RULE 6: a PN on the calendar cannot be sent back. It is finalised, and
  -- changing it silently is the risk this whole design avoids.
  if c.calendar_status = 'UPDATED' then
    raise exception
      'This PN is already on the calendar. Remove it from the calendar first.';
  end if;

  -- Only from a state where Content has actually submitted something.
  if c.content_status is distinct from 'SUBMITTED' then
    raise exception
      'Only a PN that Content has submitted can be sent back (this one is %).',
      coalesce(c.content_status::text, 'unset');
  end if;

  update campaigns
     set content_status    = 'NEEDS_CHANGES'::content_status,
         -- RULE 7: QC returns to pending. The qc_checklists TICKS ARE KEPT,
         -- deliberately: CRM re-reviews copy, not the nine unrelated checks,
         -- and discarding them would make every send-back cost a full
         -- re-tick. Only `qc_status` moves.
         qc_status         = 'PENDING'::qc_status,
         -- RULE 12: back into CRM's review queue.
         crm_status        = 'SENT_TO_CONTENT'::crm_status,
         send_back_count   = coalesce(send_back_count, 0) + 1,
         send_back_reason  = btrim(p_reason),
         send_back_field   = nullif(btrim(coalesce(p_field, '')), ''),
         send_back_at      = now(),
         send_back_by_name = btrim(p_by_name)
   where id = p_campaign_id
  returning * into c;

  insert into activity_logs (campaign_id, user_id, action, description)
  values (p_campaign_id, auth.uid(), 'SENT_BACK_TO_CONTENT',
    format('CRM (%s) sent this PN back to Content%s. Reason: %s. Send-back #%s.',
      btrim(p_by_name),
      case when nullif(btrim(coalesce(p_field,'')),'') is null then ''
           else format(' for %s', btrim(p_field)) end,
      btrim(p_reason), c.send_back_count));

  insert into notifications (
    target_role, campaign_id, type, title, message, priority, group_key)
  values ('CONTENT'::app_role, p_campaign_id, 'CHANGE_REQUEST',
    format('Copy sent back%s', case when nullif(btrim(coalesce(p_field,'')),'') is null
      then '' else format(' — %s', btrim(p_field)) end),
    format('%s (from CRM: %s)', btrim(p_reason), btrim(p_by_name)),
    'AMBER',
    'SEND_BACK:' || p_campaign_id::text || ':' || c.send_back_count::text);

  return c;
end $$;
revoke all on function public.send_back_to_content(uuid, text, text, text) from public;
grant execute on function public.send_back_to_content(uuid, text, text, text) to authenticated;

-- ═════════ VERIFY ═════════
select column_name from information_schema.columns
where table_schema='public' and table_name='campaigns'
  and column_name like 'send_back%' order by 1;
-- Expect 5 rows.

select proname, prosecdef from pg_proc p join pg_namespace n on n.oid=p.pronamespace
where n.nspname='public' and proname = 'send_back_to_content';
-- Expect prosecdef = true.

notify pgrst, 'reload schema';
