CREATE TABLE "tenant_dashboard_configurations" (
  "tenant_id" UUID NOT NULL,
  "version" INTEGER NOT NULL DEFAULT 1,
  "configuration" JSONB NOT NULL,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "tenant_dashboard_configurations_pkey" PRIMARY KEY ("tenant_id"),
  CONSTRAINT "tenant_dashboard_configurations_version_positive" CHECK ("version" > 0),
  CONSTRAINT "tenant_dashboard_configurations_tenant_id_fkey"
    FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE
);

GRANT SELECT, INSERT, UPDATE, DELETE
ON TABLE "tenant_dashboard_configurations" TO crm_app;

ALTER TABLE "tenant_dashboard_configurations" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "tenant_dashboard_configurations" FORCE ROW LEVEL SECURITY;

CREATE POLICY "tenant_dashboard_configurations_tenant_access"
ON "tenant_dashboard_configurations"
TO crm_app
USING (
  "tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::uuid
)
WITH CHECK (
  "tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::uuid
);
