#!/bin/zsh
set -euo pipefail

PROJECT_DIR="/Users/sqallig/Desktop/CAMC COMPENDIUM Web CODEX/portail-resultats"
PORT=8085
PID_FILE="$PROJECT_DIR/data/portail.pid"
LOG_FILE="$PROJECT_DIR/data/portail.log"

cd "$PROJECT_DIR"
mkdir -p data

if [ -f "$PID_FILE" ]; then
  EXISTING_PID="$(cat "$PID_FILE" 2>/dev/null || true)"
  if [ -n "$EXISTING_PID" ] && kill -0 "$EXISTING_PID" 2>/dev/null; then
    echo "Redemarrage du portail (ancien PID $EXISTING_PID)"
    kill "$EXISTING_PID" || true
    sleep 0.5
  fi
fi

PIDS="$(lsof -ti tcp:$PORT || true)"
if [ -n "$PIDS" ]; then
  echo "Arret ancien serveur sur le port $PORT: $PIDS"
  kill $PIDS || true
  sleep 0.5
fi

nohup node server.js >>"$LOG_FILE" 2>&1 &
NEW_PID=$!
echo "$NEW_PID" > "$PID_FILE"
sleep 1

if kill -0 "$NEW_PID" 2>/dev/null; then
  echo "Demarrage OK: http://127.0.0.1:$PORT (PID $NEW_PID)"
  echo "Logs: $LOG_FILE"
  open "http://127.0.0.1:$PORT/biologiste.html#admin" || true
else
  echo "Echec du demarrage. Consulte les logs: $LOG_FILE"
  exit 1
fi
