#!/usr/bin/env bash
# Démarre un PostgreSQL jetable pour les tests (hors Docker), sur 127.0.0.1 uniquement.
# Usage : scripts/dev-postgres.sh start|stop   (dossier de données : $PGTEST_DIR)
# Affiche l'URL à mettre dans TEST_DATABASE_URL. Valeurs factices, base de test uniquement.
set -euo pipefail
DIR="${PGTEST_DIR:-/tmp/observatoire-pgtest}"
PORT="${PGTEST_PORT:-54329}"
BIN="$(ls -d /usr/lib/postgresql/*/bin | sort -V | tail -1)"
run_pg() { if [ "$(id -u)" = 0 ]; then su postgres -c "$*"; else bash -c "$*"; fi; }
case "${1:-start}" in
  start)
    if [ ! -d "$DIR/data" ]; then
      mkdir -p "$DIR"; [ "$(id -u)" = 0 ] && chown postgres "$DIR"
      run_pg "$BIN/initdb -D '$DIR/data' -A trust -U observatoire >/dev/null"
    fi
    run_pg "$BIN/pg_ctl -D '$DIR/data' -o '-p $PORT -c listen_addresses=127.0.0.1 -c unix_socket_directories=$DIR' -l '$DIR/log' -w start" >/dev/null || true
    run_pg "$BIN/psql -h 127.0.0.1 -p $PORT -U observatoire -d postgres -tc \"select 1 from pg_database where datname='observatoire_test'\"" | grep -q 1 \
      || run_pg "$BIN/createdb -h 127.0.0.1 -p $PORT -U observatoire observatoire_test"
    echo "export TEST_DATABASE_URL=postgresql+psycopg://observatoire@127.0.0.1:$PORT/observatoire_test"
    ;;
  stop) run_pg "$BIN/pg_ctl -D '$DIR/data' -m fast stop" ;;
esac
