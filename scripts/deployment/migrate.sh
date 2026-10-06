#!/usr/bin/env bash
set -Eeuo pipefail

: "${DATABASE_ADMIN_URL:?Set DATABASE_ADMIN_URL to the migration owner connection (never commit it).}"
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT_DIR"

export DATABASE_ADMIN_URL
corepack pnpm --filter @crm/database prisma:migrate:deploy
