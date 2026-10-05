#!/usr/bin/env bash
set -Eeuo pipefail

: "${BACKUP_FILE:?Set BACKUP_FILE to an existing custom-format pg_dump file.}"
: "${DRILL_DATABASE_URL:?Set DRILL_DATABASE_URL to an explicit empty drill database URL.}"
: "${DATABASE_URL:?Set DATABASE_URL so the runtime database can be compared by identity.}"
: "${DATABASE_ADMIN_URL:?Set DATABASE_ADMIN_URL so the migration/admin database can be compared by identity.}"
[[ -f "$BACKUP_FILE" ]] || { echo 'backup not found' >&2; exit 2; }
command -v psql >/dev/null || { echo 'psql is required' >&2; exit 127; }
command -v pg_restore >/dev/null || { echo 'pg_restore is required' >&2; exit 127; }

identity() {
  psql --no-psqlrc --no-password --tuples-only --no-align "$1" \
    -c "select current_database() || E'|' || coalesce(inet_server_addr()::text,'local') || '|' || inet_server_port()" \
    | tr -d '\r\n'
}
db_name() { psql --no-psqlrc --no-password --tuples-only --no-align "$1" -c 'select current_database()' | tr -d '\r\n'; }
server_major() { psql --no-psqlrc --no-password --tuples-only --no-align "$1" -c 'show server_version_num' | tr -d '\r\n' | cut -c1-2; }
tool_major() { "$1" --version | sed -E 's/.* ([0-9]+)\..*/\1/'; }

runtime_id="$(identity "$DATABASE_URL")"
admin_id="$(identity "$DATABASE_ADMIN_URL")"
drill_id="$(identity "$DRILL_DATABASE_URL")"
[[ "$drill_id" != "$runtime_id" && "$drill_id" != "$admin_id" ]] || { echo 'refusing runtime/admin target' >&2; exit 2; }
drill_name="$(db_name "$DRILL_DATABASE_URL")"
[[ "$drill_name" == drill_* || "$drill_name" == *'_drill' ]] || { echo 'drill database name must start drill_ or end _drill' >&2; exit 2; }

server_major_number="$(server_major "$DRILL_DATABASE_URL")"
restore_major="$(tool_major pg_restore)"
[[ "$restore_major" == "$server_major_number" ]] || { echo "pg_restore major $restore_major does not match PostgreSQL server major $server_major_number" >&2; exit 2; }

count="$(psql --no-psqlrc --no-password --tuples-only --no-align "$DRILL_DATABASE_URL" -c \
  "select count(*) from pg_catalog.pg_class where relkind in ('r','p','m') and relnamespace not in (select oid from pg_catalog.pg_namespace where nspname in ('pg_catalog','information_schema'))" | tr -d '\r\n')"
[[ "$count" == 0 ]] || { echo "drill database is not empty ($count user relations)" >&2; exit 2; }

umask 077
# No --clean: target is proven empty. Preserve ownership, ACLs, and RLS policies.
# Runtime role grants must be restored separately (for example pg_dumpall --globals-only).
pg_restore --exit-on-error --dbname="$DRILL_DATABASE_URL" "$BACKUP_FILE" >/dev/null
printf 'restore drill passed for database identity %s\n' "$drill_id"
