#!/usr/bin/env bash
# NEXUS EDGE — one-command start.
#   ./run.sh          serve backend + static twin frontend on :8000
set -euo pipefail
cd "$(dirname "$0")"

PORT="${NEXUS_PORT:-8000}"

command -v python3 >/dev/null || { echo "python3 is required"; exit 1; }

if [ ! -d .venv ]; then
  echo "==> creating virtualenv"
  python3 -m venv .venv
fi
# shellcheck disable=SC1091
source .venv/bin/activate
pip install -q --upgrade pip
pip install -q -r backend/requirements.txt

echo "==> NEXUS EDGE on http://localhost:${PORT}   (API docs: /docs)"
cd backend && exec python -m uvicorn app.main:app --host 0.0.0.0 --port "$PORT"
