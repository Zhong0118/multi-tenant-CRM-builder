-- An activity may state its outcome explicitly. Only CONNECTED and
-- WECHAT_ADDED count as a successful contact; a call nobody answered, a note
-- or a planned task never does. The column has existed since 0011 and was
-- never written, so constraining it touches no stored value.
ALTER TABLE public.record_activities
  ADD CONSTRAINT record_activities_result_key_check
  CHECK (result_key IS NULL OR result_key IN ('NOT_REACHED', 'CONNECTED', 'WECHAT_ADDED'));

-- Per-member activity counts for a period (团队动态, daily reports).
CREATE INDEX record_activities_tenant_actor_created_idx
  ON public.record_activities (tenant_id, actor_member_id, created_at);
