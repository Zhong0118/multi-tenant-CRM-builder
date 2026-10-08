#!/usr/bin/env bash
set -Eeuo pipefail

: "${HEALTH_URL:?Set HEALTH_URL to the deployed API health endpoint (for example https://app.example.invalid/api/v1/health).}"
command -v curl >/dev/null || { echo 'curl is required' >&2; exit 127; }
curl --fail --silent --show-error --max-time "${HEALTH_TIMEOUT_SECONDS:-10}" "$HEALTH_URL"
printf '\nhealth check passed\n'
