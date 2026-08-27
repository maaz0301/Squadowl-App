-- ============================================================================
-- Fix: assessment roster read times out (57014) on large rosters
-- ----------------------------------------------------------------------------
-- Confirmed in production logs: opening an assessment with roughly a
-- thousand players returns the first `tryout_participants` page (200 rows,
-- see PARTICIPANTS_PAGE) fine, then the very next keyset page comes back
-- "57014 canceling statement due to statement timeout".
--
-- assembleTryouts() pages this table by `tryout_id = X and id > cursor order
-- by id limit 200` (see SupabaseDataSource.fetchAllByIn/fetchShard). The only
-- index available was idx_participants_tryout on (tryout_id) alone (see
-- 0001_initial_schema.sql), which finds the tryout's rows but can't also
-- satisfy "order by id" — so the planner has to pull every one of the
-- tryout's participants, sort them, and only then apply the id filter and
-- LIMIT. And per can_access_athlete()'s own comment ("five OR'd EXISTS
-- branches" — see 20260821140000_fix_team_read_policy_recursion.sql) plus
-- can_access_tryout()'s four branches after the team-manager widening (see
-- 20260818150000_team_manager_assessment_access.sql), RLS runs that pair of
-- predicates on every one of those candidate rows *before* the LIMIT ever
-- narrows anything — the same "offset re-authorizes everything it skipped"
-- trap the roster-paging comments already call out for OFFSET paging, except
-- here it's the missing composite index doing the same thing to a nominally
-- correct keyset page.
--
-- A composite (tryout_id, id) index lets Postgres walk exactly the rows a
-- page needs, in id order, without a preceding sort or a full per-tryout
-- scan — so RLS only ever runs on the rows the page actually returns.
-- Same fix as evaluations, which is read the same way right after this one
-- in assembleTryouts and would hit the identical wall on a roster with more
-- evaluations than sessions-per-page allows.
-- ============================================================================

create index if not exists idx_participants_tryout_id_keyset
  on public.tryout_participants (tryout_id, id);

create index if not exists idx_evaluations_tryout_id_keyset
  on public.evaluations (tryout_id, id);
