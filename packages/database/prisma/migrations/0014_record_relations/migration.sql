CREATE TABLE record_relations (
 id uuid PRIMARY KEY,
 tenant_id uuid NOT NULL REFERENCES tenants(id),
 source_record_id uuid NOT NULL,
 target_record_id uuid NOT NULL,
 created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CHECK (source_record_id <> target_record_id),
 UNIQUE (tenant_id, source_record_id, target_record_id),
 FOREIGN KEY (tenant_id, source_record_id) REFERENCES records(tenant_id,id),
 FOREIGN KEY (tenant_id, target_record_id) REFERENCES records(tenant_id,id)
);
CREATE INDEX record_relations_target_idx ON record_relations(tenant_id,target_record_id);
GRANT SELECT, INSERT, DELETE ON record_relations TO crm_app;
ALTER TABLE record_relations ENABLE ROW LEVEL SECURITY;
ALTER TABLE record_relations FORCE ROW LEVEL SECURITY;
CREATE POLICY record_relations_tenant_access ON record_relations TO crm_app
USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
