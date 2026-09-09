CREATE TABLE record_attachments (
 id uuid PRIMARY KEY,
 tenant_id uuid NOT NULL REFERENCES tenants(id),
 record_id uuid NOT NULL,
 filename varchar(180) NOT NULL,
 byte_size integer NOT NULL CHECK (byte_size > 0 AND byte_size <= 5242880),
 content bytea,
 created_by_member_id uuid NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 deleted_at timestamptz,
 FOREIGN KEY (tenant_id, record_id) REFERENCES records(tenant_id,id),
 FOREIGN KEY (tenant_id, created_by_member_id) REFERENCES tenant_members(tenant_id,id),
 CHECK ((deleted_at IS NULL AND content IS NOT NULL AND octet_length(content) = byte_size) OR (deleted_at IS NOT NULL AND content IS NULL))
);
CREATE INDEX record_attachments_record_idx ON record_attachments(tenant_id,record_id,created_at);
GRANT SELECT, INSERT, UPDATE ON record_attachments TO crm_app;
ALTER TABLE record_attachments ENABLE ROW LEVEL SECURITY;
ALTER TABLE record_attachments FORCE ROW LEVEL SECURITY;
CREATE POLICY record_attachments_tenant_access ON record_attachments TO crm_app
 USING (tenant_id = NULLIF(current_setting('app.tenant_id',true),'')::uuid)
 WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id',true),'')::uuid);
