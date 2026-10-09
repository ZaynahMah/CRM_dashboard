-- =====================================================================
-- CLiQ Push Ops — Fix Category and Content update permissions
-- RUN THIS. Fixes two confirmed, 100%-reproducible bugs found by tracing
-- every write in the workflow end to end:
--   1. Category could never save their input on any campaign, because the
--      old policy required created_by = the Category user's own ID — but
--      every campaign is created by CRM's bulk upload, never by Category
--      themselves. The ownership check could never pass.
--   2. Content could never submit at all — there was no branch permitting
--      the CONTENT role to update campaigns, period.
-- Both are replaced by a status-based check instead of an ownership
-- check, matching how the workflow actually creates rows now.
-- =====================================================================

drop policy if exists campaigns_update on campaigns;
create policy campaigns_update on campaigns for update to authenticated
  using (
    public.is_crm()
    or (public.current_app_role() = 'CATEGORY'::app_role
        and category_status in ('EMPTY'::category_status,'DRAFT'::category_status))
    or (public.current_app_role() = 'CONTENT'::app_role
        and content_status in ('NOT_ASSIGNED'::content_status,'PENDING'::content_status,'NEEDS_CHANGES'::content_status))
  )
  with check (
    public.is_crm()
    or public.current_app_role() = 'CATEGORY'::app_role
    or public.current_app_role() = 'CONTENT'::app_role
  );

-- VERIFY: shows the policy that's now live. Confirm the "qual" (using
-- clause) column mentions CATEGORY, CONTENT, and is_crm — not created_by.
select policyname, cmd, qual, with_check
from pg_policies
where tablename = 'campaigns' and policyname = 'campaigns_update';
