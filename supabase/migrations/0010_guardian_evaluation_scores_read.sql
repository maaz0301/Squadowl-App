-- ============================================================================
-- Migration 0010: Allow guardians to read evaluation scores
-- ============================================================================

CREATE POLICY eval_scores_read ON public.evaluation_scores
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.evaluations e 
      WHERE e.id = evaluation_id 
      AND public.can_access_tryout(e.tryout_id)
    )
  );
