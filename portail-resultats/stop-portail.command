#!/bin/zsh
set -euo pipefail

PROJECT_DIR="/Users/sqallig/Desktop/CAMC COMPENDIUM Web CODEX/portail-resultats"
PID_FILE="$PROJECT_DIR/data/portail.pid"
PORTS=(8085 8091 8092 8093 8094)

if [ -f "$PID_FILE" ]; then
  PID_FROM_FILE="$(cat "$PID_FILE" 2>/dev/null || true)"
  if [ -n "$PID_FROM_FILE" ] && kill -0 "$PID_FROM_FILE" 2>/dev/null; then
    echo "Arret via PID file: $PID_FROM_FILE"
    kill "$PID_FROM_FILE" || true
  fi
  rm -f "$PID_FILE"
fi

for port in "${PORTS[@]}"; do
  PIDS="$(lsof -ti tcp:$port || true)"
  if [ -n "$PIDS" ]; then
    echo "Arret processus sur port $port: $PIDS"
    kill $PIDS || true
  fi
done

echo "Stop termine."
