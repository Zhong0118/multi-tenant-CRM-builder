-- Existing tasks remain unchanged. A completion references its activity instead
-- of keeping a second copy of the result text, actor or outcome.
ALTER TABLE public.record_activities
  ADD CONSTRAINT record_activities_tenant_record_id_key UNIQUE (tenant_id, record_id, id);

ALTER TABLE public.record_follow_ups
  ADD COLUMN completion_activity_id uuid,
  ADD CONSTRAINT record_follow_ups_completion_activity_key UNIQUE (tenant_id, record_id, completion_activity_id),
  ADD CONSTRAINT record_follow_ups_completion_activity_fkey
    FOREIGN KEY (tenant_id, record_id, completion_activity_id)
    REFERENCES public.record_activities (tenant_id, record_id, id) ON DELETE RESTRICT,
  ADD CONSTRAINT record_follow_ups_completion_result_check
    CHECK (completion_activity_id IS NULL OR (status = 'DONE' AND completed_at IS NOT NULL));
