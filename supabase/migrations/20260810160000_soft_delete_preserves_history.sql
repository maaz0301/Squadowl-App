-- ============================================================================
-- Migration: Soft-delete tryouts and roster removals instead of hard-deleting.
--
-- Historical Player Profiles promises "data is never lost", but deleteTryout
-- and deletePlayer previously hard-deleted rows that evaluations/scores
-- reference with "on delete cascade" (0001_initial_schema.sql), permanently
-- wiping a player's assessment history whenever a coach removed them from a
-- roster or deleted a tryout. This adds soft-delete markers so the app layer
-- can hide these rows from active views while keeping the underlying
-- evaluation data intact for player profile history.
-- ============================================================================

alter table public.tryouts add column deleted_at timestamptz;
alter table public.tryout_participants add column removed_at timestamptz;
