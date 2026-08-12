-- An earlier revision of 20260812190000_assessor_decline_status.sql set the
-- status column's default to 'accepted'; that version reached the live
-- database before the file was edited down to default 'pending'. The column
-- default itself was never corrected, so every assessor invited/added since
-- has kept defaulting to 'accepted' on insert regardless of the file content.
alter table public.tryout_assessors
  alter column status set default 'pending';

-- Re-apply the non-lead-starts-pending correction to anything inserted while
-- the default was still wrong.
update public.tryout_assessors
   set status = 'pending'
 where role <> 'lead' and status = 'accepted';
