#!/usr/bin/env bash
# Deploy built dist/ to a remote host via rsync.
# Usage: ./deploy.sh [host] [path]
#   host  — SSH host (default: $DEPLOY_HOST)
#   path  — remote web root (default: $DEPLOY_PATH or /var/www/line-protection-sim)
#
# Example:
#   DEPLOY_HOST=user@example.com ./deploy.sh
#   ./deploy.sh user@example.com /var/www/line-protection-sim

set -euo pipefail

HOST="${1:-${DEPLOY_HOST:-}}"
PATH_REMOTE="${2:-${DEPLOY_PATH:-/var/www/line-protection-sim}}"

if [ -z "$HOST" ]; then
  echo "ERROR: no deploy host. Set DEPLOY_HOST or pass as first argument." >&2
  exit 1
fi

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

echo "Building..."
npm --prefix "$SCRIPT_DIR" run build

echo "Deploying to $HOST:$PATH_REMOTE ..."
rsync -az --delete "$SCRIPT_DIR/dist/" "$HOST:$PATH_REMOTE/"

echo "Done. Verify at your configured URL."
