CREATE POLICY "audit_logs_platform_admin_select" ON "audit_logs"
FOR SELECT TO crm_app
USING (
  EXISTS (
    SELECT 1
    FROM "users"
    WHERE "users"."id" = NULLIF(current_setting('app.user_id', true), '')::uuid
      AND "users"."is_platform_admin" = true
      AND "users"."status" = 'ACTIVE'
  )
);
