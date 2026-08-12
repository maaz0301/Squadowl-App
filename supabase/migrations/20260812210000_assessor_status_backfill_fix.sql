-- The backfill in 20260812190000_assessor_decline_status.sql treated "already
-- linked to an account" (user_id not null) as equivalent to "accepted the
-- invite". But linking happens automatically by email match the moment a
-- matching profile exists (see link_assessor_to_user / handle_new_user in
-- 0002_assessor_linking.sql) — it has nothing to do with the assessor ever
-- clicking Accept. That made assessors who were auto-linked but never
-- responded show "accepted" before they'd taken any action.
--
-- Only the tryout's lead/creator should default to accepted; every other
-- assessor starts pending until they explicitly accept or decline. This is
-- cosmetic only — listAssignedTryouts already shows pending and accepted
-- assignments alike, so no one loses access to a tryout they were already
-- scoring.
update public.tryout_assessors
   set status = 'pending'
 where role <> 'lead';
