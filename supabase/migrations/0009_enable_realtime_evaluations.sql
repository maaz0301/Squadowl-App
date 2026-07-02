-- Enable real-time for tryout_evaluations
-- By default, no tables broadcast changes. We must opt-in.

BEGIN;

  -- Add evaluations and evaluation_scores to the supabase_realtime publication
  ALTER PUBLICATION supabase_realtime ADD TABLE public.evaluations;
  ALTER PUBLICATION supabase_realtime ADD TABLE public.evaluation_scores;

COMMIT;
