-- Successful import rows are committed atomically with records and audits.
CREATE TABLE record_import_rows (
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  object_id UUID NOT NULL,
  member_id UUID NOT NULL,
  batch_id UUID NOT NULL,
  row_number INTEGER NOT NULL CHECK (row_number >= 2),
  record_id UUID NOT NULL,
  created_at TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (tenant_id, object_id, member_id, batch_id, row_number),
  FOREIGN KEY (tenant_id, object_id) REFERENCES object_definitions(tenant_id, id),
  FOREIGN KEY (tenant_id, member_id) REFERENCES tenant_members(tenant_id, id),
  FOREIGN KEY (tenant_id, record_id) REFERENCES records(tenant_id, id)
);
GRANT SELECT, INSERT ON record_import_rows TO crm_app;
ALTER TABLE record_import_rows ENABLE ROW LEVEL SECURITY;
ALTER TABLE record_import_rows FORCE ROW LEVEL SECURITY;
CREATE POLICY record_import_rows_tenant_access ON record_import_rows TO crm_app
USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
