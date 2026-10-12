# Storage bucket for Executive performance reports

Supabase Storage buckets **cannot be created from SQL**. Create this one by
hand before uploading a report. Migration `23_performance_reports.sql`
handles everything else and skips the bucket policies harmlessly if the
bucket does not exist yet — just rerun it afterwards.

## Bucket

| Setting | Value |
|---|---|
| **Name** | `performance-reports` |
| **Public bucket** | **OFF** (private) |
| **File size limit** | `50 MB` |
| **Allowed MIME types** | `application/vnd.openxmlformats-officedocument.spreadsheetml.sheet`, `application/vnd.ms-excel` |

The name must be exactly `performance-reports` — it is referenced as
`BUCKET` in `src/services/performanceReports.ts`.

**Private, not public**, deliberately: a public bucket means anyone with the
URL can download your monthly revenue figures without signing in. The app
serves downloads through short-lived signed URLs (5 minutes) instead.

## Dashboard steps

1. Supabase Dashboard → **Storage** → **New bucket**.
2. Name: `performance-reports`. Leave **Public bucket** switched **off**.
3. Expand **Additional configuration**:
   - File size limit: `50` MB.
   - Allowed MIME types: paste both types from the table above.
4. **Create bucket**.
5. Back in **SQL Editor**, run `supabase/23_performance_reports.sql`
   (again, if you already ran it). The storage policies at the bottom attach
   only when the bucket exists; running it a second time is safe.
6. Verify: **Storage → performance-reports → Policies** should list
   `perf_reports_read`, `perf_reports_write`, `perf_reports_delete`.

## What the policies do

- **read** — any signed-in user may download. Everyone can view the
  dashboard, so everyone may fetch the source file behind it.
- **write** — EXECUTIVE only.
- **delete** — EXECUTIVE only.

Role is resolved by `public.current_app_role()`, the same function the
campaign policies use, so storage and table permissions cannot disagree.

## If you skip this

The app still works. The metrics are saved and the dashboard persists; only
the original `.xlsx` is not kept. The upload reports that plainly — "The
metrics were saved, but the original file could not be stored" — rather than
failing or silently losing the file.
