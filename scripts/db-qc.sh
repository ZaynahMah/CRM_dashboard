#!/usr/bin/env bash
# =====================================================================
# Full self-QC against a REAL PostgreSQL, emulating Supabase.
#
#   bash scripts/db-qc.sh
#
# Builds a throwaway cluster, applies migrations 01-20 the way the Supabase
# SQL Editor does (each FILE as ONE transaction, so a mid-file failure rolls
# the file back), applies every migration TWICE to prove idempotence, then
# runs the scenario suite as each role under RLS.
#
# Exists because every production bug so far passed vitest and failed on
# live Supabase: wrong activity_logs columns, jsonb_populate_recordset
# ignoring defaults, DELETE without WHERE, realtime/RLS on the reset signal.
# Mocks cannot catch those. This can.
# =====================================================================
set -uo pipefail
cd "$(dirname "$0")/.."

PGBIN=$(ls -d /usr/lib/postgresql/*/bin | head -1)

# PostgreSQL refuses to run as root, so when this script is root we drop to
# the `postgres` system user for every server and client command.
if [ "$(id -u)" = "0" ]; then AS="su postgres -c"; else AS="bash -c"; fi
run() { $AS "$1"; }
export PGDATA=/tmp/pgqc/data
export PGPORT=55432
export PGHOST=/tmp/pgqc/sock
export PGDATABASE=cliq_qc
export PGUSER=postgres
PSQL="$PGBIN/psql -v ON_ERROR_STOP=1 -q -h $PGHOST -p $PGPORT -U postgres -d $PGDATABASE"

echo "== Static checks =="
bash scripts/static-qc.sh || exit 1

echo "== Building a fresh cluster =="
run "$PGBIN/pg_ctl -D $PGDATA stop -m immediate" >/dev/null 2>&1 || true
rm -rf /tmp/pgqc; mkdir -p "$PGDATA" "$PGHOST"
chmod -R 777 /tmp/pgqc
[ "$(id -u)" = "0" ] && chown -R postgres /tmp/pgqc
run "$PGBIN/initdb -D $PGDATA -U postgres -A trust" >/dev/null
run "$PGBIN/pg_ctl -D $PGDATA -o '-p $PGPORT -k $PGHOST' -l /tmp/pgqc/log start" >/dev/null
sleep 2
run "$PGBIN/createdb -h $PGHOST -p $PGPORT -U postgres $PGDATABASE"

echo "== Emulating Supabase (auth schema, roles, realtime, pg_safeupdate) =="
run "$PSQL -f $(pwd)/scripts/pg-bootstrap.sql"

echo "== Applying migrations 01-20, each file as ONE transaction =="
fail=0
for pass in 1 2; do
  echo "   --- pass $pass (pass 2 proves idempotence) ---"
  # 03_seed.sql is demo data and is deliberately EXCLUDED: it is never run
  # in production, and applying it here added 261 phantom campaigns that
  # skewed every scenario count.
  for f in $(ls supabase/*.sql | grep -E '/(0[1-9]|1[0-9]|2[0-9])_' | grep -v '03_seed' | sort); do
    # --single-transaction mirrors the SQL Editor: a failure anywhere rolls
    # the whole FILE back, which is exactly how migration 16 silently lost
    # its ALTER TABLEs in production.
    if out=$(run "$PSQL --single-transaction -f $(pwd)/$f" 2>&1); then
      printf "   pass%s OK   %s\n" "$pass" "$(basename "$f")"
    else
      printf "   pass%s FAIL %s\n" "$pass" "$(basename "$f")"
      echo "$out" | grep -E "ERROR|DETAIL|HINT" | head -4 | sed 's/^/        /'
      fail=1
    fi
  done
done

echo "== campaigns column parity vs live =="
run "$PSQL -f $(pwd)/scripts/db-qc-columns.sql" || fail=1

echo "== Scenario suite =="
if run "$PSQL -f $(pwd)/scripts/db-qc-scenarios.sql"; then
  echo "   scenarios completed"
else
  echo "   SCENARIOS FAILED"; fail=1
fi

echo "== Default Rate reporting (migration 26) =="
run "$PSQL -f $(pwd)/scripts/db-qc-defaultrate.sql" || fail=1

echo "== Scoped reset by stream (migration 25) =="
run "$PSQL -f $(pwd)/scripts/db-qc-streams.sql" || fail=1

echo "== Category SLA / Activities / Notifications (migration 24) =="
run "$PSQL -f $(pwd)/scripts/db-qc-sla.sql" || fail=1

echo "== Performance persistence (migration 23) =="
run "$PSQL -f $(pwd)/scripts/db-qc-performance.sql" || fail=1

echo "== Reset load test (the 57014 bug) =="
run "$PSQL -f $(pwd)/scripts/db-qc-load.sql" || fail=1

echo "== Regression: stale archive table (the 42601 bug) =="
# Runs LAST because it mutates campaigns. Reproduces the real production
# failure: migration 18 ran when campaigns had FEWER columns, so
# campaigns_archive kept the old shape; `create table if not exists` never
# fixes it, and the positional archive INSERT then had more expressions than
# target columns (SQLSTATE 42601).
run "$PSQL -f $(pwd)/scripts/db-qc-archive-drift.sql" || fail=1

echo
if [ "$fail" -eq 0 ]; then echo "DB QC: PASS"; else echo "DB QC: FAIL"; fi
run "$PGBIN/pg_ctl -D $PGDATA stop -m fast" >/dev/null 2>&1 || true
exit $fail
