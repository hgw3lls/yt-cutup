#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
VENV_PY="$ROOT_DIR/server/.venv/bin/python"

if [[ -x "$VENV_PY" ]]; then
  PYTHON_BIN="$VENV_PY"
else
  PYTHON_BIN="python"
fi

if ! "$PYTHON_BIN" -c "import uvicorn" >/dev/null 2>&1; then
  echo "[dev:server] Missing Python dependency: uvicorn" >&2
  echo "[dev:server] Install backend deps with:" >&2
  echo "  python -m venv server/.venv && source server/.venv/bin/activate && python -m pip install -r server/requirements.txt" >&2
  exit 1
fi

if ! "$PYTHON_BIN" -c "import google.auth" >/dev/null 2>&1; then
  echo "[dev:server] Missing Python dependency: google.auth (google-auth package)" >&2
  echo "[dev:server] Install backend deps with:" >&2
  echo "  python -m venv server/.venv && source server/.venv/bin/activate && python -m pip install -r server/requirements.txt" >&2
  exit 1
fi

exec "$PYTHON_BIN" -m uvicorn app.main:app --host 0.0.0.0 --port 8787 --reload --app-dir server
