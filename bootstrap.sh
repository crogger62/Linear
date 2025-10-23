#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT_DIR"

info() { echo -e "\033[1;34m[info]\033[0m $*"; }
warn() { echo -e "\033[1;33m[warn]\033[0m $*"; }
error() { echo -e "\033[1;31m[error]\033[0m $*"; }

# 1) Check prerequisites
if ! command -v node >/dev/null 2>&1; then error "Node.js is required"; exit 1; fi
if ! command -v python3 >/dev/null 2>&1; then error "Python 3 is required"; exit 1; fi

info "Node $(node -v)"
info "Python $(python3 -V 2>&1)"

# 2) Ensure .env exists
if [[ ! -f .env ]]; then
  if [[ -f .env.example ]]; then
    cp .env.example .env
    warn "Created .env from .env.example — please edit LINEAR_API_KEY before running."
  else
    warn ".env.example not found; create a .env with LINEAR_API_KEY before running."
  fi
fi

# 3) Install Node deps
if [[ -f package-lock.json ]]; then
  info "Installing Node deps (npm ci)"
  npm ci
else
  info "Installing Node deps (npm install)"
  npm install
fi

# 4) Build TypeScript -> dist
info "Building TypeScript (npm run build)"
npm run build

# 5) Prepare Python venv and install requirements
VENV_DIR="feedback-analysis/.venv"
REQ_FILE="feedback-analysis/requirements.txt"
if [[ ! -d "$VENV_DIR" ]]; then
  info "Creating Python venv at $VENV_DIR"
  python3 -m venv "$VENV_DIR"
fi
source "$VENV_DIR/bin/activate"
python3 -m pip install --upgrade pip
if [[ -f "$REQ_FILE" ]]; then
  info "Installing Python deps from $REQ_FILE"
  python3 -m pip install -r "$REQ_FILE"
else
  warn "$REQ_FILE not found; skipping Python deps install"
fi

deactivate || true

# 6) Make sure analysis script is executable (not strictly required for bash -lc)
chmod +x run_analysis.sh || true

info "Bootstrap complete. Next steps:"
echo "  1) Edit .env and set LINEAR_API_KEY (and optional OPENAI_API_KEY)"
echo "  2) Start the server:   npm run start:dist   (or: npm run dev for ts-node)"
echo "  3) Open the UI:        http://localhost:\${PICKER_PORT:-3100}/picker.html"
