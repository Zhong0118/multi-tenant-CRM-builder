BEGIN;

CREATE TABLE ai_feature_catalog (
  key text PRIMARY KEY, label text NOT NULL, group_label text NOT NULL,
  position integer NOT NULL UNIQUE, purpose text NOT NULL,
  requires_key text REFERENCES ai_feature_catalog(key), released boolean NOT NULL,
  output_limit integer CHECK (output_limit > 0)
);
ALTER TABLE ai_feature_catalog ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_feature_catalog FORCE ROW LEVEL SECURITY;
CREATE POLICY read_catalog ON ai_feature_catalog FOR SELECT USING (true);
GRANT SELECT ON ai_feature_catalog TO crm_app,crm_ai_writer;

INSERT INTO ai_feature_catalog(key,label,group_label,position,purpose,requires_key,released,output_limit) VALUES
 ('assistant','对话助手','基础',1,'text',null,true,4096),
 ('write_proposal','AI 写入提议','基础',2,'text','assistant',true,null),
 ('communication','整理沟通','数据处理',3,'text',null,true,4000),
 ('filter','一句话筛选','数据处理',4,'text',null,true,3500),
 ('table_builder','AI 建表','管理员',5,'text',null,true,16000),
 ('daily_brief','今日建议','销售日常',6,'text',null,false,2000),
 ('writing','帮我写','销售日常',7,'text',null,false,1500),
 ('daily_report','AI 写日报','销售日常',8,'text',null,false,2500);

CREATE FUNCTION ai_check_plan_features() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN
  IF cardinality(NEW.features) <> (
    SELECT count(*) FROM ai_feature_catalog c
    WHERE c.key=ANY(NEW.features) AND c.released
      AND (c.requires_key IS NULL OR c.requires_key=ANY(NEW.features))
  ) THEN RAISE check_violation USING MESSAGE='invalid plan features'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER ai_plan_features BEFORE INSERT OR UPDATE OF features ON ai_plans
FOR EACH ROW EXECUTE FUNCTION ai_check_plan_features();
ALTER TABLE ai_plans DROP CONSTRAINT ai_plans_features_check, DROP CONSTRAINT ai_plans_features_check1;
ALTER TABLE ai_model_calls DROP CONSTRAINT ai_model_calls_feature_check,
  ADD CONSTRAINT ai_model_calls_feature_fk FOREIGN KEY(feature) REFERENCES ai_feature_catalog(key);

CREATE OR REPLACE FUNCTION ai_reserve_call(t uuid,m uuid,cid uuid,r text,f text,p text,model_name text,i bigint,o bigint,deadline timestamptz)
 RETURNS TABLE(code text,recovery_date date) LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE local_day date; mo date; cap numeric; active_count bigint; tm ai_tenant_months%ROWTYPE; mm ai_member_months%ROWTYPE; allocation_mode text;
BEGIN
 IF NOT coalesce(ai_is_member(t,m),false) THEN RAISE insufficient_privilege; END IF;
 IF i<0 OR NOT EXISTS(SELECT FROM ai_feature_catalog WHERE key=f AND released AND output_limit=o)
  OR deadline<=clock_timestamp() THEN RAISE invalid_parameter_value; END IF;
 -- Acquire the global read lock before taking any company lock. Platform changes
 -- serialize on the same singleton and then acquire company locks.
 PERFORM FROM ai_platform_settings WHERE id FOR SHARE;
 PERFORM ai_recover_expired(t);
 code:=ai_feature_gate(t,m,f);
 SELECT (clock_timestamp() AT TIME ZONE timezone)::date INTO STRICT local_day FROM tenants WHERE id=t;
 mo:=date_trunc('month',local_day)::date;
 recovery_date:=(mo+interval '1 month')::date;
 IF code IS NULL THEN
  SELECT p1.monthly_tokens,tc.allocation INTO STRICT cap,allocation_mode FROM tenant_ai_configs tc JOIN ai_plans p1 ON p1.id=tc.plan_id WHERE tc.tenant_id=t;
  INSERT INTO ai_tenant_months(tenant_id,month) VALUES(t,mo) ON CONFLICT DO NOTHING;
  SELECT * INTO STRICT tm FROM ai_tenant_months WHERE tenant_id=t AND month=mo FOR UPDATE;
  cap:=cap+tm.extra_tokens;
  code:=ai_budget_error(cap,tm.input_tokens::numeric+tm.output_tokens,tm.reserved_tokens,i+o,'AI_TENANT_QUOTA_EXHAUSTED');
  IF code IS NULL THEN
   INSERT INTO ai_member_months(tenant_id,month,member_id) VALUES(t,mo,m) ON CONFLICT DO NOTHING;
   SELECT * INTO STRICT mm FROM ai_member_months WHERE tenant_id=t AND month=mo AND member_id=m FOR UPDATE;
   IF allocation_mode='equal' THEN
    SELECT count(*) INTO active_count FROM tenant_members a JOIN users u ON u.id=a.user_id WHERE a.tenant_id=t AND a.status='ACTIVE' AND u.status='ACTIVE';
    code:=ai_budget_error(trunc(cap/greatest(active_count,1)),mm.input_tokens::numeric+mm.output_tokens,mm.reserved_tokens,i+o,'AI_MEMBER_QUOTA_EXHAUSTED');
   END IF;
  END IF;
 END IF;
 IF code IS NULL THEN
  INSERT INTO ai_model_calls(id,tenant_id,member_id,month,local_date,feature,provider,model,request_id,reserved_input,reserved_output,expires_at)
  VALUES(cid,t,m,mo,local_day,f,p,model_name,r,i,o,deadline);
  UPDATE ai_tenant_months SET reserved_tokens=reserved_tokens+i+o WHERE tenant_id=t AND month=mo;
  UPDATE ai_member_months SET reserved_tokens=reserved_tokens+i+o WHERE tenant_id=t AND member_id=m AND month=mo;
 ELSE
  PERFORM ai_record_denial(t,m,f,code,r);
 END IF;
 RETURN NEXT;
END $$;

COMMIT;
