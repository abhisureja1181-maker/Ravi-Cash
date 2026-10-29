#!/usr/bin/env bash
# Many clients create vouchers at the same moment (pgbench): numbers must stay unique and gap-free, retries with the
# same clientId must collapse into one voucher, and the audit chain must still verify afterwards.
set -euo pipefail
PGBIN="$1"; WORK="$2"
PSQL=("$PGBIN/psql" -X -q -v ON_ERROR_STOP=1 -At)
U1=$("${PSQL[@]}" -c "select v from t.state where k='u1'"); U2=$("${PSQL[@]}" -c "select v from t.state where k='u2'"); N1=$("${PSQL[@]}" -c "select v from t.state where k='n1'")
BEFORE_P=$("${PSQL[@]}" -c "select last_seq from voucher_counters where type='PAYMENT'"); BEFORE_R=$("${PSQL[@]}" -c "select last_seq from voucher_counters where type='RECEIPT'")
BEFORE_N=$("${PSQL[@]}" -c "select count(*) from vouchers")
mk() { # file uid-var
cat > "$WORK/$1.sql" <<SQL
select set_config('request.jwt.claim.sub', $2, false);
set role authenticated;
\set amt random(1, 900)
\set kind random(0, 1)
select rw_create_voucher(jsonb_build_object('type', case when :kind = 0 then 'PAYMENT' else 'RECEIPT' end, 'partyName', 'Load Test Party', 'particulars', 'Concurrent voucher creation test', 'amount', :amt::text));
SQL
}
mk a ":u1"; mk b ":u2"; mk c ":n1"
# retries: 6 clients keep re-sending 20 distinct client ids, so only 20 vouchers may result
cat > "$WORK/d.sql" <<SQL
select set_config('request.jwt.claim.sub', :u1, false);
set role authenticated;
\set cid random(1, 20)
select rw_create_voucher(jsonb_build_object('type', 'PAYMENT', 'partyName', 'Retry Party', 'particulars', 'Idempotent retry test', 'amount', '5', 'clientId', 'retry-' || :cid::text));
SQL
echo "pgbench: 16 clients x 40 transactions creating vouchers for 3 users, plus 6 retrying clients"
"$PGBIN/pgbench" -n -c 16 -j 4 -t 40 -D u1="'$U1'" -D u2="'$U2'" -D n1="'$N1'" -f "$WORK/a.sql@4" -f "$WORK/b.sql@4" -f "$WORK/c.sql@4" -f "$WORK/d.sql@1" rwtest >"$WORK/bench.txt" 2>&1 || { cat "$WORK/bench.txt"; exit 1; }
grep -m3 -E "^(number of failed|number of transactions actually processed|tps)" "$WORK/bench.txt" | sed 's/^/  /'
FAILED=$(grep -m1 -E "^number of failed transactions" "$WORK/bench.txt" | sed -E 's/.*: ([0-9]+).*/\1/' || echo 0)
[ "${FAILED:-0}" = "0" ] || { echo "FAILED transactions under load: $FAILED"; cat "$WORK/bench.txt"; exit 1; }
"${PSQL[@]}" <<SQL
do \$\$
declare gaps int; dups int; n int; chk jsonb; retries int;
begin
  perform set_config('request.jwt.claim.sub', (select s.v from t.state s where s.k='super'), false);
  for gaps in 0..0 loop
    -- gap-free: every number from 1 to the counter exists exactly once, for both types
    select count(*) into gaps from generate_series(1, (select last_seq from voucher_counters where type='PAYMENT')) g where not exists (select 1 from vouchers where type='PAYMENT' and seq = g);
    if gaps <> 0 then raise exception 'TEST FAILED: % gaps in payment numbers', gaps; end if;
    select count(*) into gaps from generate_series(1, (select last_seq from voucher_counters where type='RECEIPT')) g where not exists (select 1 from vouchers where type='RECEIPT' and seq = g);
    if gaps <> 0 then raise exception 'TEST FAILED: % gaps in receipt numbers', gaps; end if;
  end loop;
  select count(*) - count(distinct number) into dups from vouchers;
  if dups <> 0 then raise exception 'TEST FAILED: % duplicate voucher numbers', dups; end if;
  select count(*) into retries from vouchers where client_id like 'retry-%';
  if retries > 20 or retries < 1 then raise exception 'TEST FAILED: expected between 1 and 20 retry vouchers, got %', retries; end if;
  select count(*) into n from vouchers;
  if n < $BEFORE_N + 400 then raise exception 'TEST FAILED: too few vouchers were created under load (%)', n - $BEFORE_N; end if;
  set role authenticated;
  chk := rw_verify_audit();
  reset role;
  if not (chk->>'ok')::boolean then raise exception 'TEST FAILED: audit chain broke under concurrency at %', chk; end if;
  raise notice 'ok - % vouchers created concurrently: numbers unique and gap-free, % idempotent retries, audit chain intact (% entries)', n - $BEFORE_N, retries, chk->>'count';
end \$\$;
SQL
