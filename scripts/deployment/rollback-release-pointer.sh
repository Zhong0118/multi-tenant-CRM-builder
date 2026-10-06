#!/usr/bin/env bash
set -Eeuo pipefail

: "${RELEASE_POINTER_FILE:?Set RELEASE_POINTER_FILE to the deployment platform release pointer file.}"
: "${ROLLBACK_RELEASE:?Set ROLLBACK_RELEASE to an explicit previously tested release identifier.}"
[[ "$ROLLBACK_RELEASE" != *$'\n'* && "$ROLLBACK_RELEASE" != *$'\r'* ]] || { echo 'release identifier must be one line' >&2; exit 2; }
printf '%s\n' "$ROLLBACK_RELEASE" > "$RELEASE_POINTER_FILE"
printf 'release pointer updated: %s\n' "$ROLLBACK_RELEASE"
printf 'restart/reload the platform using its documented mechanism, then run health.sh\n'
