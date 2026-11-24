BEGIN;

CREATE TABLE ai_model_providers (
 id uuid PRIMARY KEY DEFAULT crm_uuid_v7(), name text NOT NULL, preset text NOT NULL,
 enabled boolean NOT NULL DEFAULT true, version integer NOT NULL DEFAULT 1 CHECK(version > 0),
 active_revision_id uuid, draft_revision_id uuid, environment_import boolean NOT NULL DEFAULT false
);
CREATE UNIQUE INDEX ai_single_environment_import ON ai_model_providers(environment_import) WHERE environment_import;

CREATE TABLE ai_model_credentials (
 id uuid PRIMARY KEY, provider_id uuid NOT NULL REFERENCES ai_model_providers ON DELETE CASCADE,
 version integer NOT NULL, last_four text NOT NULL CHECK(length(last_four)=4),
 key_id text NOT NULL, nonce text NOT NULL, ciphertext text NOT NULL, tag text NOT NULL,
 verifier text NOT NULL CHECK(length(verifier)=64),
 UNIQUE(provider_id,id), UNIQUE(provider_id,version)
);
CREATE TABLE ai_model_revisions (
 id uuid PRIMARY KEY DEFAULT crm_uuid_v7(), provider_id uuid NOT NULL REFERENCES ai_model_providers ON DELETE CASCADE,
 preset text NOT NULL, base_url text NOT NULL, protocol text NOT NULL CHECK(protocol IN ('chat','responses')), embeddings boolean NOT NULL,
 credential_id uuid, key_last4 text, UNIQUE(provider_id,id), UNIQUE(id,credential_id),
 FOREIGN KEY(provider_id,credential_id) REFERENCES ai_model_credentials(provider_id,id) DEFERRABLE INITIALLY DEFERRED,
 CHECK((credential_id IS NULL)=(key_last4 IS NULL))
);
ALTER TABLE ai_model_providers ADD FOREIGN KEY(id,active_revision_id) REFERENCES ai_model_revisions(provider_id,id) DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE ai_model_providers ADD FOREIGN KEY(id,draft_revision_id) REFERENCES ai_model_revisions(provider_id,id) DEFERRABLE INITIALLY DEFERRED;

CREATE TABLE ai_config_models (
 revision_id uuid NOT NULL REFERENCES ai_model_revisions ON DELETE CASCADE, name text NOT NULL,
 capabilities text[] NOT NULL CHECK(capabilities <@ ARRAY['text','vision','embedding'] AND array_position(capabilities,NULL) IS NULL),
 context_tokens integer CHECK(context_tokens>0), max_output_tokens integer CHECK(max_output_tokens>0),
 input_price numeric(20,8) CHECK(input_price>=0), output_price numeric(20,8) CHECK(output_price>=0), currency text CHECK(currency ~ '^[A-Z]{3}$'),
 PRIMARY KEY(revision_id,name), CHECK(input_price IS NULL AND output_price IS NULL OR currency IS NOT NULL)
);
CREATE TABLE ai_model_tests (
 id uuid PRIMARY KEY DEFAULT crm_uuid_v7(), sequence integer GENERATED ALWAYS AS IDENTITY UNIQUE,
 revision_id uuid NOT NULL, credential_id uuid NOT NULL, model_name text NOT NULL,
 purpose text NOT NULL CHECK(purpose IN ('text','vision','embedding')), suite text NOT NULL,
 actor_id uuid NOT NULL REFERENCES users, started_at timestamptz NOT NULL DEFAULT clock_timestamp(), finished_at timestamptz,
 status text NOT NULL DEFAULT 'running' CHECK(status IN ('running','success','failed')),
 steps jsonb NOT NULL DEFAULT '[]', duration_ms integer, error_code text,
 dimensions integer CHECK(dimensions>0), input_tokens bigint NOT NULL DEFAULT 0, output_tokens bigint NOT NULL DEFAULT 0,
 FOREIGN KEY(revision_id,model_name) REFERENCES ai_config_models ON DELETE CASCADE,
 FOREIGN KEY(revision_id,credential_id) REFERENCES ai_model_revisions(id,credential_id) ON DELETE CASCADE
);
CREATE INDEX ai_model_latest_completed ON ai_model_tests(revision_id,model_name,purpose,suite,sequence DESC) WHERE finished_at IS NOT NULL;
CREATE TABLE ai_model_assignments (
 purpose text PRIMARY KEY CHECK(purpose IN ('text','vision','embedding')), scope text NOT NULL DEFAULT 'platform' CHECK(scope='platform'),
 plan_id uuid CHECK(plan_id IS NULL), provider_id uuid NOT NULL, revision_id uuid NOT NULL, model_name text NOT NULL,
 version integer NOT NULL CHECK(version>0), dimensions integer CHECK(dimensions>0),
 FOREIGN KEY(provider_id,revision_id) REFERENCES ai_model_revisions(provider_id,id),
 FOREIGN KEY(revision_id,model_name) REFERENCES ai_config_models
);

DO $$ DECLARE n text;
BEGIN
 FOREACH n IN ARRAY ARRAY['ai_model_providers','ai_model_credentials','ai_model_revisions','ai_config_models','ai_model_tests','ai_model_assignments'] LOOP
  EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY',n);
  EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY',n);
  EXECUTE format('REVOKE ALL ON %I FROM PUBLIC,crm_app',n);
  EXECUTE format('CREATE POLICY model_writer ON %I TO crm_ai_writer USING(true) WITH CHECK(true)',n);
  EXECUTE format('GRANT SELECT ON %I TO crm_ai_writer',n);
  EXECUTE format('CREATE POLICY model_admin ON %I TO crm_app USING(ai_is_platform()) WITH CHECK(ai_is_platform())',n);
  IF n <> 'ai_model_credentials' THEN EXECUTE format('GRANT SELECT ON %I TO crm_app',n); END IF;
 END LOOP;
END $$;
GRANT INSERT,UPDATE,DELETE ON ai_model_providers TO crm_app;
GRANT INSERT ON ai_model_credentials,ai_model_revisions,ai_config_models TO crm_app;
GRANT INSERT,UPDATE(status,finished_at,steps,duration_ms,error_code,dimensions,input_tokens,output_tokens) ON ai_model_tests TO crm_app;
GRANT INSERT,UPDATE ON ai_model_assignments TO crm_app;
GRANT UPDATE(key_id,nonce,ciphertext,tag,verifier) ON ai_model_credentials TO crm_ai_writer;

-- The application role has no table-level credential reads, even in an admin
-- session. A deployed keyring proves access without sending a master key to SQL.
CREATE FUNCTION ai_model_open_envelope(credential uuid, proofs text[]) RETURNS jsonb
 LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE c ai_model_credentials%ROWTYPE;
BEGIN
 SELECT * INTO STRICT c FROM ai_model_credentials WHERE id=credential;
 IF NOT EXISTS(SELECT FROM unnest(proofs) p WHERE encode(sha256(convert_to(p,'UTF8')),'hex')=c.verifier) THEN
   RAISE insufficient_privilege;
 END IF;
 RETURN jsonb_build_object('keyId',c.key_id,'nonce',c.nonce,'ciphertext',c.ciphertext,'tag',c.tag);
END $$;
CREATE FUNCTION ai_model_admin_envelope(credential uuid, proofs text[]) RETURNS jsonb
 LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN
 IF NOT ai_is_platform() THEN RAISE insufficient_privilege; END IF;
 RETURN ai_model_open_envelope(credential,proofs);
END $$;
CREATE FUNCTION ai_model_ready(p text) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
 SELECT EXISTS(SELECT FROM ai_model_assignments a JOIN ai_model_providers v ON v.id=a.provider_id AND v.enabled AND v.active_revision_id=a.revision_id WHERE a.purpose=p)
$$;
CREATE FUNCTION ai_resolve_model(t uuid,m uuid,p text,proofs text[]) RETURNS TABLE(snapshot jsonb,credential_id uuid,envelope jsonb)
 LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN
 IF ai_is_member(t,m) IS NOT TRUE THEN RAISE insufficient_privilege; END IF;
 RETURN QUERY SELECT jsonb_build_object('purpose',a.purpose,'providerId',v.id,'provider',r.preset,
   'revisionId',r.id,'assignmentVersion',a.version,'model',md.name,'protocol',r.protocol,'baseURL',r.base_url,
   'contextTokens',md.context_tokens,'maxOutputTokens',md.max_output_tokens,'inputPrice',md.input_price::text,
   'outputPrice',md.output_price::text,'currency',md.currency),r.credential_id,ai_model_open_envelope(r.credential_id,proofs)
 FROM ai_model_assignments a JOIN ai_model_providers v ON v.id=a.provider_id AND v.enabled AND v.active_revision_id=a.revision_id
 JOIN ai_model_revisions r ON r.id=a.revision_id JOIN ai_config_models md ON md.revision_id=r.id AND md.name=a.model_name
 WHERE a.purpose=p;
END $$;
CREATE FUNCTION ai_model_rotation_pending(active_id text) RETURNS TABLE(id uuid,provider_id uuid,old_key_id text,remaining bigint)
 LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN
 IF NOT ai_is_platform() THEN RAISE insufficient_privilege; END IF;
 RETURN QUERY SELECT c.id,c.provider_id,c.key_id,count(*) OVER() FROM ai_model_credentials c WHERE c.key_id<>active_id ORDER BY c.id LIMIT 25;
END $$;
CREATE FUNCTION ai_model_rotate_one(credential uuid,expected_key text,expected_nonce text,new_key text,new_nonce text,new_cipher text,new_tag text,new_verifier text)
 RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN
 IF NOT ai_is_platform() THEN RAISE insufficient_privilege; END IF;
 UPDATE ai_model_credentials SET key_id=new_key,nonce=new_nonce,ciphertext=new_cipher,tag=new_tag,verifier=new_verifier
 WHERE id=credential AND key_id=expected_key AND nonce=expected_nonce;
 RETURN FOUND;
END $$;

GRANT CREATE ON SCHEMA public TO crm_ai_writer;
DO $$ DECLARE fn record;
BEGIN
 FOR fn IN SELECT p.oid::regprocedure AS signature,p.proname FROM pg_proc p
 WHERE p.pronamespace='public'::regnamespace AND p.proname IN
 ('ai_model_open_envelope','ai_model_admin_envelope','ai_model_ready','ai_resolve_model','ai_model_rotation_pending','ai_model_rotate_one') LOOP
  EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC,crm_app',fn.signature);
  EXECUTE format('ALTER FUNCTION %s OWNER TO crm_ai_writer',fn.signature);
  IF fn.proname<>'ai_model_open_envelope' THEN EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO crm_app',fn.signature); END IF;
 END LOOP;
END $$;
REVOKE CREATE ON SCHEMA public FROM crm_ai_writer;

COMMIT;
