-- =====================================================================
-- CLiQ Push Ops — Remove slot uniqueness entirely
-- RUN THIS. Drops both indexes that may exist on your live database from
-- earlier, now-reverted attempts at a natural key. Rows already have a
-- UUID primary key; nothing else needs to be unique. Multiple PNs share
-- a slot — that's normal, not an error.
-- =====================================================================

drop index if exists campaigns_day_time_slot_unique;
drop index if exists campaigns_natural_key;

notify pgrst, 'reload schema';

-- VERIFY: should return zero rows. If it returns any, a uniqueness
-- constraint still exists on campaigns.
select indexname, indexdef
from pg_indexes
where tablename = 'campaigns'
  and indexdef ilike '%unique%'
  and indexname not in ('campaigns_pkey');
