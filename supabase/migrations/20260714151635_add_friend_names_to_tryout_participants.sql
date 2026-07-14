-- Add friend1_name and friend2_name to tryout_participants
ALTER TABLE public.tryout_participants ADD COLUMN IF NOT EXISTS friend1_name text;
ALTER TABLE public.tryout_participants ADD COLUMN IF NOT EXISTS friend2_name text;
