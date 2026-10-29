#!/usr/bin/env bash
# Runs the database tests on a throw-away local PostgreSQL (needs the postgres 15/16 server binaries).
#   supabase/tests/run.sh            (set PGBIN if the binaries are not in /usr/lib/postgresql/*/bin)
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"; ROOT="$(cd "$HERE/../.." && pwd)"
PGBIN="${PGBIN:-$(ls -d /usr/lib/postgresql/*/bin 2>/dev/null | sort -V | tail -1)}"
[ -x "$PGBIN/initdb" ] || { echo "PostgreSQL server binaries not found. Set PGBIN=/path/to/bin"; exit 2; }
PORT="${PGPORT:-54329}"; WORK="$(mktemp -d /tmp/rw-pg.XXXXXX)"; SOCK="$WORK/sock"; DATA="$WORK/data"; mkdir -p "$SOCK"
RUNAS=""; if [ "$(id -u)" = "0" ]; then chown -R postgres "$WORK"; chmod 755 "$WORK"; RUNAS="runuser -u postgres --"; fi
cleanup() { $RUNAS "$PGBIN/pg_ctl" -D "$DATA" -m immediate stop >/dev/null 2>&1 || true; rm -rf "$WORK"; }
trap cleanup EXIT
$RUNAS "$PGBIN/initdb" -D "$DATA" -U postgres -A trust --no-sync >/dev/null
$RUNAS "$PGBIN/pg_ctl" -D "$DATA" -w -o "-p $PORT -k $SOCK -c listen_addresses='' -c fsync=off -c max_connections=60" -l "$WORK/pg.log" start >/dev/null
export PGHOST="$SOCK" PGPORT="$PORT" PGUSER=postgres PGOPTIONS='--client-min-messages=warning'
PSQL=("$PGBIN/psql" -X -q -v ON_ERROR_STOP=1)
"$PGBIN/createdb" rwtest
export PGDATABASE=rwtest
"${PSQL[@]}" -f "$HERE/00_supabase_stubs.sql"
for f in "$ROOT"/supabase/migrations/*.sql; do echo "migration: $(basename "$f")"; "${PSQL[@]}" -f "$f"; done
# words table generated from the app's own JavaScript, to prove the SQL "amount in words" matches it exactly
node "$HERE/gen-words.js" > "$WORK/words.tsv"
"${PSQL[@]}" -c "create table public.zz_words (paise bigint, words text);" -c "\\copy public.zz_words from '$WORK/words.tsv'"
PGOPTIONS='--client-min-messages=notice' "${PSQL[@]}" -f "$HERE/test.sql" >"$WORK/test.out" 2>&1 || { grep -v "NOTICE:  ok - " "$WORK/test.out" | tail -15; exit 1; }
[ -z "${VERBOSE:-}" ] || sed -n 's/.*NOTICE:  ok - /  ok - /p' "$WORK/test.out"
echo "SQL tests: $(grep -c 'NOTICE:  ok - ' "$WORK/test.out") checks passed"
# concurrency: many clients create vouchers at the same time
PGOPTIONS='--client-min-messages=notice' "$HERE/concurrency.sh" "$PGBIN" "$WORK" 2>&1 | sed -n 's/.*NOTICE:  ok - /  ok - /p;/pgbench\|number of\|tps/p;/TEST FAILED\|ERROR/p'
echo "ALL DATABASE TESTS PASSED"
