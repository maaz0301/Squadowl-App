-- Adds a status column to tryout_assessors so an assessor's invite state
-- (pending / accepted / declined) is actually tracked instead of assumed.
-- New invites default to 'pending' until the assessor explicitly accepts or
-- declines. Assessors who were already linked to an account (or are the
-- tryout's lead/creator) are backfilled to 'accepted' since they were already
-- treated as active before this column existed.
alter table public.tryout_assessors
  add column status text not null default 'pending'
  check (status in ('pending', 'accepted', 'declined'));

update public.tryout_assessors
   set status = 'accepted'
 where user_id is not null or role = 'lead';
