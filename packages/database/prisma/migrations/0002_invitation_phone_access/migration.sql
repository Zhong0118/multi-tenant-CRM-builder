-- Users invited before registration discover only invitations matching their
-- verified phone. Missing request context resolves to NULL instead of raising.
DROP POLICY "tenant_invitations_self_select" ON "tenant_invitations";
DROP POLICY "tenant_invitations_self_update" ON "tenant_invitations";

CREATE POLICY "tenant_invitations_self_select" ON "tenant_invitations"
FOR SELECT TO crm_app
USING (
  "target_user_id" = NULLIF(current_setting('app.user_id', true), '')::uuid
  OR (
    "target_user_id" IS NULL
    AND "target_phone" = (
      SELECT "phone" FROM "users"
      WHERE "id" = NULLIF(current_setting('app.user_id', true), '')::uuid
        AND "status" = 'ACTIVE'
    )
  )
);

CREATE POLICY "tenant_invitations_self_update" ON "tenant_invitations"
FOR UPDATE TO crm_app
USING (
  "target_user_id" = NULLIF(current_setting('app.user_id', true), '')::uuid
  OR (
    "target_user_id" IS NULL
    AND "target_phone" = (
      SELECT "phone" FROM "users"
      WHERE "id" = NULLIF(current_setting('app.user_id', true), '')::uuid
        AND "status" = 'ACTIVE'
    )
  )
)
WITH CHECK (
  "target_phone" = (
    SELECT "phone" FROM "users"
    WHERE "id" = NULLIF(current_setting('app.user_id', true), '')::uuid
      AND "status" = 'ACTIVE'
  )
  AND (
    "target_user_id" IS NULL
    OR "target_user_id" = NULLIF(current_setting('app.user_id', true), '')::uuid
  )
);

CREATE POLICY "tenants_invitee_select" ON "tenants"
FOR SELECT TO crm_app
USING (
  EXISTS (
    SELECT 1 FROM "tenant_invitations"
    WHERE "tenant_invitations"."tenant_id" = "tenants"."id"
      AND (
        "tenant_invitations"."target_user_id" = NULLIF(current_setting('app.user_id', true), '')::uuid
        OR (
          "tenant_invitations"."target_user_id" IS NULL
          AND "tenant_invitations"."target_phone" = (
            SELECT "phone" FROM "users"
            WHERE "id" = NULLIF(current_setting('app.user_id', true), '')::uuid
              AND "status" = 'ACTIVE'
          )
        )
      )
  )
);
