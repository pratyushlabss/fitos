#!/bin/bash
S=$(cd "$(dirname "$0")" && pwd)
P="psql -h 127.0.0.1 -p 55432 -U postgres -v ON_ERROR_STOP=1 -q"
$P -c "DROP DATABASE IF EXISTS fitos_test" -c "CREATE DATABASE fitos_test" || exit 1
$P -d fitos_test -f $S/supabase_stub.sql || exit 1
for f in $S/../migrations/00*.sql; do
  echo "== $(basename $f)"
  $P -d fitos_test -f "$f" 2>&1 | grep -v "NOTICE" | head -8
  [ ${PIPESTATUS[0]} -eq 0 ] || { echo "FAILED at $f"; exit 1; }
done
echo "ALL APPLIED"
psql -h 127.0.0.1 -p 55432 -U postgres -d fitos_test -q -f "$S/rls_tests.sql" 2>&1 | grep -E "PASS|FAIL"
