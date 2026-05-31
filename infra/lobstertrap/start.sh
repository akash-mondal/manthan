#!/usr/bin/env bash
# Start Lobster Trap as a security proxy in front of Gemini.
#
# Usage:   ./infra/lobstertrap/start.sh
# Stop:    Ctrl-C, or kill $(lsof -ti:8080)
#
# After it's running, point Manthan at the proxy by setting:
#   GEMINI_BASE_URL=http://localhost:8080/v1beta/openai
#   AGENT_GEMINI_BASE_URL=http://localhost:8080/v1beta/openai
# in your .env, then restart uvicorn.
#
# Path note: Lobster Trap's reverse proxy only swaps scheme + host;
# it preserves the request path verbatim. So we keep Gemini's path
# (/v1beta/openai/chat/completions) on the CLIENT side and tell
# Lobster Trap the backend is just the host. That way the proxy
# rewrites localhost:8080 → generativelanguage.googleapis.com and
# the rest of the URL flies through untouched.
#
# Audit log streams to ./infra/lobstertrap/audit.log (one JSON line per
# inspection). Tail it during a demo to watch every prompt + response
# get classified and policy-checked in real time:
#   tail -f infra/lobstertrap/audit.log

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
LOBSTERTRAP_BIN="${LOBSTERTRAP_BIN:-$(dirname "$REPO_ROOT")/lobstertrap/lobstertrap}"
POLICY="$REPO_ROOT/infra/lobstertrap/manthan-policy.yaml"
AUDIT_LOG="$REPO_ROOT/infra/lobstertrap/audit.log"
UPSTREAM="https://generativelanguage.googleapis.com"

if [[ ! -x "$LOBSTERTRAP_BIN" ]]; then
  echo "ERROR: lobstertrap binary not found at $LOBSTERTRAP_BIN" >&2
  echo "" >&2
  echo "Build it first:" >&2
  echo "  git clone https://github.com/veeainc/lobstertrap.git \\" >&2
  echo "    \"$(dirname "$REPO_ROOT")/lobstertrap\"" >&2
  echo "  cd \"$(dirname "$REPO_ROOT")/lobstertrap\" && make build" >&2
  exit 1
fi

echo "→ policy:   $POLICY"
echo "→ upstream: $UPSTREAM"
echo "→ audit:    $AUDIT_LOG"
echo "→ proxy:    http://localhost:8080"
echo "→ dashboard: http://localhost:8080/_lobstertrap/"
echo

exec "$LOBSTERTRAP_BIN" serve \
  --listen :8080 \
  --backend "$UPSTREAM" \
  --policy "$POLICY" \
  --audit-log "$AUDIT_LOG"
