-- The existing permissive policy scopes all operations to the current tenant.
CREATE POLICY record_activities_admin_delete ON public.record_activities
AS RESTRICTIVE FOR DELETE TO crm_app
USING (
  actor_member_id IS NOT NULL
  AND activity_type IN ('CALL', 'MESSAGE', 'MEETING', 'NOTE')
  AND EXISTS (
    SELECT 1 FROM public.tenant_members m JOIN public.users u ON u.id = m.user_id
    WHERE m.tenant_id = record_activities.tenant_id
      AND m.user_id = NULLIF(current_setting('app.user_id', true), '')::uuid
      AND m.role = 'TENANT_ADMIN' AND m.status = 'ACTIVE' AND u.status = 'ACTIVE'
  )
);
GRANT DELETE ON public.record_activities TO crm_app;
