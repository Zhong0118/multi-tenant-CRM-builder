-- Rule drafts live in object_definitions.settings; published rules are frozen in
-- object_publications.configuration. Successful executions are append-only.
CREATE TABLE record_automation_executions (
  id uuid PRIMARY KEY DEFAULT crm_uuid_v7(),
  tenant_id uuid NOT NULL,
  source_record_id uuid NOT NULL,
  target_record_id uuid NOT NULL,
  rule_key varchar(64) NOT NULL,
  dedup_key varchar(128) NOT NULL,
  publication_id uuid NOT NULL,
  actor_member_id uuid NOT NULL,
  result jsonb NOT NULL,
  created_at timestamptz(3) NOT NULL DEFAULT now(),
  CONSTRAINT record_automation_executions_dedup_key UNIQUE (tenant_id, source_record_id, rule_key, dedup_key),
  CONSTRAINT record_automation_executions_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT record_automation_executions_source_record_fkey FOREIGN KEY (tenant_id, source_record_id) REFERENCES records(tenant_id, id) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT record_automation_executions_target_record_fkey FOREIGN KEY (tenant_id, target_record_id) REFERENCES records(tenant_id, id) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT record_automation_executions_publication_fkey FOREIGN KEY (tenant_id, publication_id) REFERENCES object_publications(tenant_id, id) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT record_automation_executions_actor_fkey FOREIGN KEY (tenant_id, actor_member_id) REFERENCES tenant_members(tenant_id, id) ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX record_automation_executions_history_idx ON record_automation_executions (tenant_id, source_record_id, created_at DESC);
GRANT SELECT, INSERT ON record_automation_executions TO crm_app;
ALTER TABLE record_automation_executions ENABLE ROW LEVEL SECURITY;
ALTER TABLE record_automation_executions FORCE ROW LEVEL SECURITY;
CREATE POLICY record_automation_executions_tenant_access ON record_automation_executions TO crm_app
USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
CREATE TRIGGER record_automation_executions_immutable_update
BEFORE UPDATE ON record_automation_executions
FOR EACH ROW EXECUTE FUNCTION reject_record_transition_history_update();
