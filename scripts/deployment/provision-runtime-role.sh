#!/bin/sh
set -eu
# Explicit one-shot job. Never mounted as an automatic database init hook.
: "${CRM_APP_PASSWORD:?Set a unique runtime-role password}"
: "${PGHOST:?Set PGHOST}"
: "${PGUSER:?Set PGUSER}"
: "${PGDATABASE:?Set PGDATABASE}"
: "${PGPASSWORD:?Set PGPASSWORD}"
command -v psql >/dev/null
psql -X --set=ON_ERROR_STOP=1 <<'SQL'
BEGIN;
-- Create without the development SQL's default password; commit only after rotation.
DO $body$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'crm_app') THEN
    CREATE ROLE crm_app LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;
  END IF;
END
$body$;
\getenv runtime_password CRM_APP_PASSWORD
SELECT format('ALTER ROLE crm_app LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS PASSWORD %L', :'runtime_password') \gexec
\i /provision/init.sql
COMMIT;
SQL
printf 'crm_app role provisioned; run migrations separately.\n'
