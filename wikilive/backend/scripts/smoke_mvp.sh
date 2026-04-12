#!/usr/bin/env bash
set -euo pipefail

echo "Smoke MVP: basic flow checks (manual steps required)"

# Quick health check (requires backend to be up)
if command -v curl >/dev/null 2>&1; then
  if curl -sS http://localhost:3001/api/health >/dev/null; then
    echo "Backend health: OK (localhost:3001)"
  else
    echo "Backend health: NOT REACHABLE at http://localhost:3001";
  fi
fi

echo "This script is a scaffold. Run the MVP steps manually or wire them to CI."
