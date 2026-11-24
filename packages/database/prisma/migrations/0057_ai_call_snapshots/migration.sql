BEGIN;

-- Existing rows and old application versions have no recoverable assignment or rates.
ALTER TABLE ai_model_calls
 ADD COLUMN config_source text NOT NULL DEFAULT 'historical' CHECK(config_source IN ('historical','environment','platform','test')),
 ADD COLUMN purpose text CHECK(purpose IN ('text','vision','embedding')),
 ADD COLUMN provider_id uuid,
 ADD COLUMN revision_id uuid,
 ADD COLUMN assignment_version integer CHECK(assignment_version>0),
 ADD COLUMN deployment_config_id text CHECK(deployment_config_id ~ '^[a-f0-9]{64}$'),
 ADD COLUMN input_price numeric(20,8) CHECK(input_price>=0),
 ADD COLUMN output_price numeric(20,8) CHECK(output_price>=0),
 ADD COLUMN currency text CHECK(currency ~ '^[A-Z]{3}$'),
 ADD CONSTRAINT ai_call_snapshot_shape CHECK (
   (config_source='historical')=(purpose IS NULL)
   AND (config_source='platform')=(provider_id IS NOT NULL)
   AND (config_source='platform')=(revision_id IS NOT NULL)
   AND (config_source='platform')=(assignment_version IS NOT NULL)
   AND (config_source<>'environment' OR deployment_config_id IS NOT NULL)
   AND ((input_price IS NULL AND output_price IS NULL) OR (config_source='platform' AND currency IS NOT NULL))
 );

-- Preserve legacy company read grants; only platform aggregates expose monetary data.
REVOKE SELECT ON ai_model_calls FROM crm_app;
GRANT SELECT(id,tenant_id,member_id,month,local_date,feature,provider,model,request_id,started_at,expires_at,
 ended_at,status,reserved_input,reserved_output,input_tokens,output_tokens,input_estimated,output_estimated,
 recovered,excess_tokens) ON ai_model_calls TO crm_app;

-- A rolling deployment may still call the original ten-argument routine. New
-- callers reserve and stamp the immutable application snapshot in one transaction.
CREATE FUNCTION ai_reserve_snapshot_call(t uuid,m uuid,cid uuid,r text,f text,p text,model_name text,
 i bigint,o bigint,deadline timestamptz,s jsonb)
 RETURNS TABLE(code text,recovery_date date) LANGUAGE plpgsql SECURITY DEFINER
 SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN
 IF s IS NULL OR jsonb_typeof(s)<>'object' OR s->>'configSource' IS NULL OR s->>'configSource' NOT IN ('platform','environment','test')
 THEN RAISE invalid_parameter_value; END IF;
 SELECT v.code,v.recovery_date INTO STRICT code,recovery_date
 FROM ai_reserve_call(t,m,cid,r,f,p,model_name,i,o,deadline) v;
 IF code IS NULL THEN
  UPDATE ai_model_calls SET purpose=s->>'purpose',config_source=s->>'configSource',
    provider_id=(s->>'providerId')::uuid,revision_id=(s->>'revisionId')::uuid,assignment_version=(s->>'assignmentVersion')::integer,
    deployment_config_id=s->>'deploymentConfigId',input_price=(s->>'inputPrice')::numeric,
    output_price=(s->>'outputPrice')::numeric,currency=s->>'currency'
  WHERE id=cid AND tenant_id=t AND member_id=m;
 END IF;
 RETURN NEXT;
END $$;

CREATE FUNCTION ai_company_model_costs(t uuid, mo date)
 RETURNS TABLE(currency text,calls bigint,input_tokens bigint,output_tokens bigint,known_cost numeric,
               priced_input_tokens bigint,priced_output_tokens bigint)
 LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
 SELECT c.currency,count(*),sum(c.input_tokens)::bigint,sum(c.output_tokens)::bigint,
   sum(c.input_tokens*coalesce(c.input_price,0)+c.output_tokens*coalesce(c.output_price,0))
     FILTER (WHERE c.input_price IS NOT NULL OR c.output_price IS NOT NULL)/1000000,
   coalesce(sum(c.input_tokens) FILTER (WHERE c.input_price IS NOT NULL),0)::bigint,
   coalesce(sum(c.output_tokens) FILTER (WHERE c.output_price IS NOT NULL),0)::bigint
 FROM ai_model_calls c WHERE ai_is_platform() AND c.tenant_id=t AND c.month=mo AND c.status NOT IN ('pending','unsent')
 GROUP BY c.currency
$$;

GRANT CREATE ON SCHEMA public TO crm_ai_writer;
ALTER FUNCTION ai_reserve_snapshot_call(uuid,uuid,uuid,text,text,text,text,bigint,bigint,timestamptz,jsonb) OWNER TO crm_ai_writer;
ALTER FUNCTION ai_company_model_costs(uuid,date) OWNER TO crm_ai_writer;
REVOKE CREATE ON SCHEMA public FROM crm_ai_writer;
REVOKE ALL ON FUNCTION ai_reserve_snapshot_call(uuid,uuid,uuid,text,text,text,text,bigint,bigint,timestamptz,jsonb),
 ai_company_model_costs(uuid,date) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION ai_reserve_snapshot_call(uuid,uuid,uuid,text,text,text,text,bigint,bigint,timestamptz,jsonb),
 ai_company_model_costs(uuid,date) TO crm_app;

CREATE OR REPLACE FUNCTION ai_record_denial(t uuid,m uuid,f text,code text,r text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN
 IF NOT coalesce(ai_is_member(t,m),false) THEN RAISE insufficient_privilege; END IF;
 IF code NOT IN ('AI_PLATFORM_DISABLED','AI_FEATURE_NOT_INCLUDED','AI_TENANT_QUOTA_EXHAUSTED','AI_MEMBER_QUOTA_EXHAUSTED',
                 'AI_REQUEST_BUDGET_INSUFFICIENT','AI_BUDGET_RESERVED','RATE_LIMITED','OBJECT_ACTION_FORBIDDEN','AI_PROVIDER_UNAVAILABLE','AI_MODEL_CONTEXT_EXCEEDED') THEN RAISE invalid_parameter_value; END IF;
 INSERT INTO ai_operation_records(id,tenant_id,member_id,feature,source,status,request_id)
 VALUES(crm_uuid_v7(),t,m,f,'denial',code,r);
END $$;

COMMIT;
