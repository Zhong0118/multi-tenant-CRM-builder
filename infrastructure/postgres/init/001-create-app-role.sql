DO $body$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'crm_app') THEN
    CREATE ROLE crm_app LOGIN PASSWORD 'crm_app'
      NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;
  END IF;
END
$body$;

SELECT format('GRANT CONNECT ON DATABASE %I TO crm_app', current_database()) \gexec
GRANT USAGE ON SCHEMA public TO crm_app;
