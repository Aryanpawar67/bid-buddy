#!/usr/bin/env bash
# start.sh — Start the Bid Compass dev server
# Auto-selects an available port if the default is busy.

set -euo pipefail

DEFAULT_PORT=3000
MAX_PORT=3020
PID_FILE=".dev-server.pid"
PORT_FILE=".dev-server.port"

# ── find a free port ────────────────────────────────────────────────────────────
find_free_port() {
  local port=$DEFAULT_PORT
  while [ $port -le $MAX_PORT ]; do
    if ! lsof -iTCP:"$port" -sTCP:LISTEN -t >/dev/null 2>&1; then
      echo $port
      return
    fi
    echo "  Port $port is busy, trying $((port + 1))..." >&2
    port=$((port + 1))
  done
  echo "ERROR: No free port found between $DEFAULT_PORT and $MAX_PORT." >&2
  exit 1
}

# ── guard: already running? ──────────────────────────────────────────────────
if [ -f "$PID_FILE" ]; then
  OLD_PID=$(cat "$PID_FILE")
  if kill -0 "$OLD_PID" 2>/dev/null; then
    OLD_PORT=$(cat "$PORT_FILE" 2>/dev/null || echo "?")
    echo "Dev server is already running (PID $OLD_PID, port $OLD_PORT)."
    echo "Run ./scripts/stop.sh first, or open http://localhost:$OLD_PORT"
    exit 0
  else
    rm -f "$PID_FILE" "$PORT_FILE"
  fi
fi

# ── select port ──────────────────────────────────────────────────────────────
PORT=$(find_free_port)

echo ""
echo "  ╔══════════════════════════════════════╗"
echo "  ║   Bid Compass — Dev Server           ║"
echo "  ╚══════════════════════════════════════╝"
echo "  Starting on port $PORT..."
echo ""

# ── launch in background ─────────────────────────────────────────────────────
PORT="$PORT" bun dev --port "$PORT" &
SERVER_PID=$!

echo $SERVER_PID > "$PID_FILE"
echo $PORT       > "$PORT_FILE"

echo "  PID   : $SERVER_PID"
echo "  URL   : http://localhost:$PORT"
echo "  Logs  : tail -f dev-server.log  (if you redirect output)"
echo ""
echo "  Run ./scripts/stop.sh to stop the server."
echo ""

# ── wait for server to be ready ──────────────────────────────────────────────
echo -n "  Waiting for server"
for i in $(seq 1 30); do
  if curl -s "http://localhost:$PORT" >/dev/null 2>&1; then
    echo ""
    echo "  ✓ Server is ready → http://localhost:$PORT"
    echo ""
    break
  fi
  echo -n "."
  sleep 1
done
