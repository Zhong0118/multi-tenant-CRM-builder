BEGIN;
CREATE TABLE daily_brief_settings (
  tenant_id uuid PRIMARY KEY REFERENCES tenants(id) ON DELETE CASCADE,
  object_ids uuid[],
  contact_days integer NOT NULL CHECK(contact_days BETWEEN 1 AND 365),
  stagnant_days integer NOT NULL CHECK(stagnant_days BETWEEN 1 AND 365),
  reclaim_days integer NOT NULL CHECK(reclaim_days BETWEEN 1 AND 365),
  version integer NOT NULL CHECK(version>0)
);
ALTER TABLE daily_brief_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE daily_brief_settings FORCE ROW LEVEL SECURITY;
GRANT SELECT,INSERT,UPDATE ON daily_brief_settings TO crm_app;
CREATE POLICY member_rules ON daily_brief_settings FOR SELECT TO crm_app USING(ai_is_member(tenant_id));
CREATE POLICY admin_rules ON daily_brief_settings TO crm_app USING(ai_is_member(tenant_id,NULL,true))
 WITH CHECK(ai_is_member(tenant_id,NULL,true));

CREATE TABLE daily_brief_cache (
  tenant_id uuid NOT NULL, member_id uuid NOT NULL, local_date date NOT NULL,
  attempts integer NOT NULL DEFAULT 0 CHECK(attempts BETWEEN 0 AND 4),
  lease uuid, lease_until timestamptz, generated_at timestamptz, items jsonb NOT NULL DEFAULT '[]',
  PRIMARY KEY(tenant_id,member_id,local_date),
  FOREIGN KEY(tenant_id,member_id) REFERENCES tenant_members(tenant_id,id) ON DELETE CASCADE
);
ALTER TABLE daily_brief_cache ENABLE ROW LEVEL SECURITY;
ALTER TABLE daily_brief_cache FORCE ROW LEVEL SECURITY;
REVOKE ALL ON daily_brief_cache FROM PUBLIC;
GRANT SELECT,INSERT,UPDATE ON daily_brief_cache TO crm_app;
CREATE POLICY member_private ON daily_brief_cache TO crm_app USING(ai_is_member(tenant_id,member_id))
 WITH CHECK(ai_is_member(tenant_id,member_id));

-- Removing the plan also hides existing personal rows from the runtime SQL role.
CREATE POLICY entitled_cache ON daily_brief_cache AS RESTRICTIVE FOR SELECT TO crm_app
 USING (EXISTS (SELECT FROM tenant_ai_configs c JOIN ai_plans p ON p.id=c.plan_id
   CROSS JOIN ai_platform_settings s WHERE c.tenant_id=daily_brief_cache.tenant_id
   AND NOT s.disabled AND 'daily_brief'=ANY(p.features)));

CREATE INDEX brief_completed_contact ON record_follow_ups(tenant_id,record_id,completed_at DESC)
 WHERE status='DONE' AND completed_at IS NOT NULL;
CREATE INDEX brief_current_state ON record_transition_histories(tenant_id,record_id,to_state_key,created_at DESC);
COMMIT;
