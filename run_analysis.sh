#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT_DIR"

VENV_DIR="feedback-analysis/.venv"
REQ_FILE="feedback-analysis/requirements.txt"
CSV_PATH="CustomerRequests.csv"

if [[ ! -f "$CSV_PATH" ]]; then
	echo "[error] Missing $CSV_PATH. Run the export first." >&2
	exit 2
fi

if [[ ! -d "$VENV_DIR" ]]; then
	echo "[info] Creating Python venv at $VENV_DIR"
	python3 -m venv "$VENV_DIR"
fi

source "$VENV_DIR/bin/activate"
python3 -m pip install --upgrade pip >/dev/null

if [[ -f "$REQ_FILE" ]]; then
	echo "[info] Installing Python dependencies from $REQ_FILE"
	python3 -m pip install -r "$REQ_FILE"
else
	echo "[warn] $REQ_FILE not found; proceeding without requirements install"
fi

echo "[info] Running analysis on $CSV_PATH"
python3 feedback-analysis/analyze_feedback.py "$CSV_PATH"


