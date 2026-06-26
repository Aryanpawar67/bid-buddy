#!/usr/bin/env bash
# stop.sh — Stop the Bid Compass dev server started by start.sh

set -euo pipefail

PID_FILE=".dev-server.pid"
PORT_FILE=".dev-server.port"

if [ ! -f "$PID_FILE" ]; then
  echo "No dev server PID file found. Nothing to stop."
  echo "(If a server is running outside of start.sh, kill it manually.)"
  exit 0
fi

PID=$(cat "$PID_FILE")
PORT=$(cat "$PORT_FILE" 2>/dev/null || echo "?")

if kill -0 "$PID" 2>/dev/null; then
  echo "Stopping dev server (PID $PID, port $PORT)..."
  kill "$PID"

  # Wait up to 5s for graceful shutdown
  for i in $(seq 1 10); do
    if ! kill -0 "$PID" 2>/dev/null; then
      break
    fi
    sleep 0.5
  done

  # Force-kill if still alive
  if kill -0 "$PID" 2>/dev/null; then
    echo "Process did not stop gracefully, force-killing..."
    kill -9 "$PID" 2>/dev/null || true
  fi

  echo "  ✓ Server stopped."
else
  echo "Process $PID is not running (may have crashed or been stopped already)."
fi

rm -f "$PID_FILE" "$PORT_FILE"
