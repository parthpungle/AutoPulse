#!/usr/bin/env bash
# ============================================================
#  AutoPulse v4 launcher (macOS / Linux): one laptop is the car,
#  another is the dashboard. Double-click in Finder, or run ./run.command [1|2|3].
#    1  Vehicle    sensors stream out + breakdown controls   (ports 8200, 8201/udp, 5173)
#    2  Dashboard  pairs with a vehicle, shows live health   (ports 8000, 5173)
#    3  Both       everything on this laptop, auto-paired
#  Installs only what the role needs, and only when it changed. Ctrl+C stops everything.
#  First time on macOS: chmod +x run.command, or right-click > Open to get past Gatekeeper.
# ============================================================
set -u
cd "$(dirname "$0")"
API_PORT=8000; VEHICLE_PORT=8200; UI_PORT=5173

echo "================================================"
echo "  AutoPulse v4 - vehicle + dashboard"
echo "================================================"

ROLE="${1:-}"
if [ -z "$ROLE" ]; then
  echo "  Which laptop is this?"
  echo "    [1] Vehicle    the car: sensors transmit, you inject breakdowns"
  echo "    [2] Dashboard  the screen: pairs with a vehicle, shows live health"
  echo "    [3] Both       run everything on this laptop (demo / testing)"
  read -r -p "  Choose 1, 2 or 3 [3]: " ROLE
fi
case "${ROLE:-3}" in
  1|vehicle) ROLE=1; ROLE_NAME=Vehicle ;;
  2|dashboard) ROLE=2; ROLE_NAME=Dashboard ;;
  3|both|"") ROLE=3; ROLE_NAME=Both ;;
  *) echo "[ERROR] Unknown role '$ROLE'. Use 1, 2 or 3."; exit 1 ;;
esac
echo "[OK] Role: $ROLE_NAME"

# ---- Python and Node -------------------------------------------------
# macOS ships Python 3.9 as "python3"; AutoPulse needs 3.10+, so look for a newer one first
PY=""
for c in python3.13 python3.12 python3.11 python3.10 python3; do
  if command -v "$c" >/dev/null 2>&1 && "$c" -c 'import sys; sys.exit(0 if sys.version_info >= (3, 10) else 1)' 2>/dev/null; then PY="$c"; break; fi
done
if [ -z "$PY" ]; then
  echo "[ERROR] Python 3.10 or newer is needed (macOS's built-in python3 is 3.9)."
  echo "        Install one:  brew install python@3.12   (or python.org), then run this again."
  exit 1
fi
echo "[OK] Python: $($PY --version) ($(command -v $PY))"
if [ -d .venv ] && ! .venv/bin/python -c 'import sys; sys.exit(0 if sys.version_info >= (3, 10) else 1)' 2>/dev/null; then
  echo "[..] Rebuilding .venv: it was made with an older Python"; rm -rf .venv
fi
command -v node >/dev/null 2>&1 || { echo "[ERROR] Node.js not found. Install the LTS build from nodejs.org or 'brew install node'."; exit 1; }
echo "[OK] Node: $(node --version)"

# ---- virtual environment and dependencies for this role -----------------
[ -x .venv/bin/python ] || { echo "[..] Creating .venv ..."; "$PY" -m venv .venv || exit 1; }
VPY=.venv/bin/python
if [ "$ROLE" = 1 ]; then REQ=requirements-vehicle.txt; LOCK=.venv/requirements-vehicle.lock; else REQ=requirements.txt; LOCK=.venv/requirements.lock; fi
NEED=1
cmp -s "$REQ" "$LOCK" 2>/dev/null && NEED=0
[ "$ROLE" = 1 ] && cmp -s requirements.txt .venv/requirements.lock 2>/dev/null && NEED=0
if [ "$NEED" = 0 ]; then echo "[OK] Python dependencies up to date"; else
  "$VPY" -m pip install --upgrade pip -q
  if [ "$ROLE" = 1 ]; then echo "[..] Installing vehicle dependencies (small, no PyTorch) ..."; "$VPY" -m pip install -r "$REQ" || exit 1
  else
    # everything except PyTorch must install; PyTorch only powers the CNN vote, so it is optional here
    echo "[..] Installing Python dependencies ..."
    grep -v '^torch' "$REQ" > .venv/requirements-core.txt
    "$VPY" -m pip install -r .venv/requirements-core.txt || exit 1
    echo "[..] Installing PyTorch for the CNN (optional) ..."
    "$VPY" -m pip install "$(grep '^torch' "$REQ")" || "$VPY" -m pip install torch ||       echo "[WARN] PyTorch did not install: the dashboard runs with SVM, Softmax and ANN, without the CNN vote."
  fi
  cp "$REQ" "$LOCK"; echo "[OK] Python dependencies installed"
fi
if [ -d frontend/node_modules ] && cmp -s frontend/package.json frontend/node_modules/.autopulse-package.lock 2>/dev/null; then
  echo "[OK] Frontend dependencies up to date"
else
  echo "[..] Installing frontend dependencies ..."; (cd frontend && npm install --no-audit --no-fund) || exit 1
  cp frontend/package.json frontend/node_modules/.autopulse-package.lock
fi
if [ "$ROLE" != 1 ] && [ ! -f models/svm.joblib ]; then echo "[..] Training models (about a minute) ..."; "$VPY" train.py || exit 1; fi

# ---- ports ------------------------------------------------------------
busy() { lsof -nP -iTCP:"$1" -sTCP:LISTEN >/dev/null 2>&1; }
check() { if busy "$1"; then echo "[ERROR] Port $1 ($2) is in use. Close the other AutoPulse window first."; exit 1; else echo "[OK] Port $1 is free ($2)"; fi; }
[ "$ROLE" != 2 ] && check $VEHICLE_PORT "vehicle node"
[ "$ROLE" != 1 ] && check $API_PORT "dashboard API"
check $UI_PORT "user interface"

export AUTOPULSE_CODE=$(( RANDOM % 9000 + 1000 ))
LAN_IP=$("$VPY" -c "import socket; s=socket.socket(socket.AF_INET, socket.SOCK_DGRAM); s.connect(('10.255.255.255', 1)); print(s.getsockname()[0])" 2>/dev/null || echo 127.0.0.1)

PIDS=()
cleanup() { echo; echo "[..] Stopping AutoPulse ..."; for p in "${PIDS[@]:-}"; do kill "$p" 2>/dev/null; done; wait 2>/dev/null; echo "[OK] Stopped."; }
trap cleanup EXIT INT TERM
wait_port() { for _ in $(seq 1 60); do busy "$1" && return 0; sleep 1; done; echo "[WARN] Nothing on port $1 yet."; }
start_ui() { (cd frontend && npm run dev -- --logLevel warn) & PIDS+=($!); }
open_url() { command -v open >/dev/null 2>&1 && open "$1" || { command -v xdg-open >/dev/null 2>&1 && xdg-open "$1"; } ; }

case "$ROLE" in
  1)
    echo "================================================"
    echo "  VEHICLE - this laptop is the car"
    echo "    Control panel : http://localhost:$UI_PORT/vehicle.html"
    echo "    Dashboards pair with $LAN_IP using code $AUTOPULSE_CODE"
    echo "  macOS will ask whether Python can accept incoming connections: click Allow,"
    echo "  or dashboards cannot reach this laptop (System Settings > Network > Firewall)."
    echo "================================================"
    start_ui; wait_port $UI_PORT; open_url "http://localhost:$UI_PORT/vehicle.html"
    "$VPY" -m uvicorn vehicle.node:app --host 0.0.0.0 --port $VEHICLE_PORT --no-access-log --log-level warning
    ;;
  2)
    echo "================================================"
    echo "  DASHBOARD - this laptop is the screen"
    echo "    Open : http://localhost:$UI_PORT  ->  Vehicle link -> pick the car -> enter its code"
    echo "    This laptop is $LAN_IP; the vehicle must be on the same network."
    echo "================================================"
    "$VPY" -m uvicorn backend.app:app --port $API_PORT --no-access-log --log-level warning & PIDS+=($!)
    wait_port $API_PORT; open_url "http://localhost:$UI_PORT/"
    (cd frontend && npm run dev)
    ;;
  3)
    echo "================================================"
    echo "  BOTH - vehicle and dashboard on this laptop, already paired"
    echo "    Vehicle   : http://localhost:$UI_PORT/vehicle.html"
    echo "    Dashboard : http://localhost:$UI_PORT/"
    echo "    Another laptop can also pair: $LAN_IP, code $AUTOPULSE_CODE"
    echo "================================================"
    export AUTOPULSE_AUTOPAIR="127.0.0.1:$VEHICLE_PORT:$AUTOPULSE_CODE"
    "$VPY" -m uvicorn backend.app:app --port $API_PORT --no-access-log --log-level warning & PIDS+=($!)
    start_ui; wait_port $API_PORT; wait_port $UI_PORT
    open_url "http://localhost:$UI_PORT/vehicle.html"; open_url "http://localhost:$UI_PORT/"
    "$VPY" -m uvicorn vehicle.node:app --host 0.0.0.0 --port $VEHICLE_PORT --no-access-log --log-level warning
    ;;
esac
