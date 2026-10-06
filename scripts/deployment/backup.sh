#!/usr/bin/env bash
set -Eeuo pipefail

: "${DATABASE_BACKUP_URL:?Set DATABASE_BACKUP_URL to an owner/backup connection covering all RLS-protected data (never commit it).}"
BACKUP_DIR="${BACKUP_DIR:-./var/backups}"
mkdir -p "$BACKUP_DIR"
command -v pg_dump >/dev/null || { echo 'pg_dump is required' >&2; exit 127; }

stamp="$(date -u +%Y%m%dT%H%M%SZ)"
out="$BACKUP_DIR/crm-$stamp.dump"
umask 077
pg_dump --format=custom --file="$out" "$DATABASE_BACKUP_URL"
printf 'backup written: %s\n' "$out"
