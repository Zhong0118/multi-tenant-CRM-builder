#!/usr/bin/env bash
set -Eeuo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT_DIR"

: "${NEXT_PUBLIC_API_ORIGIN:?Set the public API origin before building the browser bundle.}"
export NEXT_PUBLIC_API_ORIGIN
# Generation needs a URL, but a build must not depend on real database credentials.
DATABASE_ADMIN_URL=postgresql://build:build@localhost:5432/build corepack pnpm build
