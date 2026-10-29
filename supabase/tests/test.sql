-- Database tests: run by supabase/tests/run.sh on a real PostgreSQL server (every line below is executed).
\set ON_ERROR_STOP on
\set QUIET on

-- ---------------------------------------------------------------------------------------- helpers
create schema t;
grant usage on schema t to public;
create table t.state (k text primary key, v text);
grant all on t.state to public;
create function t.set(k text, v text) returns void language sql as $$ insert into t.state values (k, v) on conflict (k) do update set v = excluded.v $$;
create function t.get(k text) returns text language sql stable as $$ select v from t.state where k = $1 $$;
create function t.u(k text) returns uuid language sql stable as $$ select v::uuid from t.state where k = $1 $$;
create function t.as_user(k text) returns void language plpgsql as $$
begin perform set_config('request.jwt.claim.sub', t.get(k), false); execute 'set role authenticated'; end $$;
create function t.as_anon() returns void language plpgsql as $$
begin perform set_config('request.jwt.claim.sub', '', false); execute 'set role anon'; end $$;
create function t.admin() returns void language plpgsql as $$
begin execute 'reset role'; perform set_config('request.jwt.claim.sub', '', false); end $$;
create function t.ok(cond boolean, msg text) returns void language plpgsql as $$
begin if cond is not true then raise exception 'TEST FAILED: %', msg; end if; raise notice 'ok - %', msg; end $$;
create function t.eq(a anyelement, b anyelement, msg text) returns void language plpgsql as $$
begin if a is distinct from b then raise exception 'TEST FAILED: % (got %, expected %)', msg, a, b; end if; raise notice 'ok - %', msg; end $$;
create function t.throws(q text, prefix text, msg text) returns void language plpgsql as $$
declare m text;
begin
  begin execute q; exception when others then get stacked diagnostics m = message_text; end;
  if m is null then raise exception 'TEST FAILED: % (no error was raised)', msg; end if;
  if left(m, length(prefix)) <> prefix then raise exception 'TEST FAILED: % (expected an error starting "%", got "%")', msg, prefix, m; end if;
  raise notice 'ok - %', msg;
end $$;
grant execute on all functions in schema t to public;

-- ------------------------------------------------------------------- 1. amount in words == the app's JavaScript
do $$ declare n int; bad int; first text; begin
  select count(*), count(*) filter (where public.rw_amount_in_words(paise) <> words), min(paise::text || ' ' || words) filter (where public.rw_amount_in_words(paise) <> words) into n, bad, first from public.zz_words;
  perform t.ok(n > 300 and bad = 0, 'amount in words: SQL equals the JavaScript for ' || n || ' amounts' || coalesce(' (first mismatch ' || first || ')', ''));
  perform t.eq(public.rw_to_paise('1,25,500.50'), 12550050::bigint, 'money parsing: 1,25,500.50');
  perform t.eq(public.rw_to_paise('₹ 5000'), 500000::bigint, 'money parsing: ₹ 5000');
  perform t.eq(public.rw_to_paise('19.9'), 1990::bigint, 'money parsing: 19.9');
  perform t.throws($q$select public.rw_to_paise('10.555')$q$, 'VALIDATION|', 'money parsing rejects 3 decimals');
  perform t.throws($q$select public.rw_to_paise('-5')$q$, 'VALIDATION|', 'money parsing rejects negatives');
  perform t.throws($q$select public.rw_to_paise('1e5')$q$, 'VALIDATION|', 'money parsing rejects exponents');
  perform t.eq(public.rw_inr(12550050), '₹1,25,500.50', 'rw_inr uses Indian digit grouping');
  perform t.eq(public.rw_inr(10000000000), '₹10,00,00,000', 'rw_inr: crores');
end $$;

-- ------------------------------------------------------------------------------- 2. first-time setup + people
do $$
declare sa uuid := gen_random_uuid(); bm uuid := gen_random_uuid(); u1 uuid := gen_random_uuid(); u2 uuid := gen_random_uuid(); n1 uuid := gen_random_uuid(); vw uuid := gen_random_uuid();
        r jsonb; indore uuid; nagpur uuid;
begin
  perform t.set('super', sa::text); perform t.set('bm', bm::text); perform t.set('u1', u1::text); perform t.set('u2', u2::text); perform t.set('n1', n1::text); perform t.set('viewer', vw::text);
  perform t.ok((public.rw_public_info() ->> 'empty')::boolean, 'a fresh system reports empty (shows the setup screen)');
  insert into auth.users (id, email) values (sa, 'admin@main.ravicash.invalid');
  r := public.rw_bootstrap(sa, 'Ravi Water Flow Pump', 'Ravi Water Flow Pump', 'MAIN', 'admin', 'Super Admin', 'admin@example.com');
  perform t.eq(r ->> 'registerId', 'MAI-SA-001', 'bootstrap creates the Super Admin and a register');
  perform t.throws($q$select public.rw_bootstrap(gen_random_uuid(), 'x', 'Evil Branch', 'EVIL', 'evil', 'Evil Person', 'e@x.com')$q$, 'FORBIDDEN|', 'bootstrap works only once');
  perform t.ok(not (public.rw_public_info() ->> 'empty')::boolean, 'after setup the system is no longer empty');

  perform t.as_user('super');
  perform public.rw_branch_create('Ravi Water Flow Pump - Indore', 'INDORE', 'Vijay Nagar, Indore', '0731 000000');
  perform public.rw_branch_create('Ravi Water Flow Pump - Nagpur', 'NAGPUR');
  perform t.throws($q$select public.rw_branch_create('Duplicate Indore', 'INDORE')$q$, 'CONFLICT|', 'duplicate branch code is refused');
  perform t.admin();
  select id into indore from public.branches where code = 'INDORE'; select id into nagpur from public.branches where code = 'NAGPUR';
  perform t.set('indore', indore::text); perform t.set('nagpur', nagpur::text);
  perform t.eq((select reg_prefix from public.branches where code = 'INDORE'), 'IND', 'register prefix derived from the branch code');

  insert into auth.users (id, email) values (bm, 'kiran.shah@indore.ravicash.invalid'), (u1, 'rahul.patel@indore.ravicash.invalid'), (u2, 'neha.joshi@indore.ravicash.invalid'),
         (n1, 'amit.deshmukh@nagpur.ravicash.invalid'), (vw, 'auditor@nagpur.ravicash.invalid');
  perform public.rw_provision_user(bm, 'INDORE', 'kiran.shah', 'Kiran Shah', 'kiran@example.com', '', 'Branch Manager', 'BRANCH_ADMIN', sa);
  perform public.rw_provision_user(u1, 'INDORE', 'rahul.patel', 'Rahul Patel', 'rahul@example.com', '9876543210', 'Accountant', 'USER', sa);
  perform public.rw_provision_user(u2, 'INDORE', 'neha.joshi', 'Neha Joshi', 'neha@example.com', '', 'Cashier', 'USER', sa);
  perform public.rw_provision_user(n1, 'NAGPUR', 'amit.deshmukh', 'Amit Deshmukh', 'amit@example.com', '', 'Accountant', 'USER', sa);
  perform public.rw_provision_user(vw, 'NAGPUR', 'auditor', 'Nagpur Auditor', 'auditor@example.com', '', 'Auditor', 'VIEWER', sa);
  perform t.eq((select id from public.cash_registers where user_id = u1), 'IND-RP-001', 'register id = branch prefix + initials + number');
  perform t.eq((select count(*)::int from public.cash_registers where user_id = vw), 0, 'a viewer gets no cash register');

  perform t.as_user('super');
  perform public.rw_set_opening(u1, 10000000, 'Opening balance brought forward');
  perform public.rw_set_opening(n1, 5000000, 'Opening balance brought forward');
  perform t.admin();
  perform t.throws($q$select public.rw_provision_user(gen_random_uuid(), 'INDORE', 'rahul.patel', 'Dup Person', 'd@x.com')$q$, '', 'duplicate username is refused');

  -- sign-in helper never reveals whether an account exists
  perform t.as_anon();
  perform t.eq(public.rw_login_email('INDORE', 'kiran.shah'), 'kiran.shah@indore.ravicash.invalid', 'login email: branch + username');
  perform t.eq(public.rw_login_email('INDORE', 'KIRAN@example.com'), 'kiran.shah@indore.ravicash.invalid', 'login email: real e-mail works too');
  perform t.eq(public.rw_login_email('NAGPUR', 'kiran.shah'), 'kiran.shah@nagpur.ravicash.invalid', 'login email: wrong branch gives an address that does not exist');
  perform t.eq(public.rw_login_email('INDORE', 'nobody'), 'nobody@indore.ravicash.invalid', 'login email: unknown user looks identical');
  perform t.eq(public.rw_login_email('NAGPUR', 'admin'), 'admin@main.ravicash.invalid', 'a Super Admin can sign in from any branch');
  perform t.ok(jsonb_array_length(public.rw_public_info() -> 'branches') = 3, 'anonymous login screen lists the 3 active branches');
  perform t.throws($q$select count(*) from public.profiles$q$, 'permission denied', 'anonymous cannot read profiles');
  perform t.throws($q$select count(*) from public.vouchers$q$, 'permission denied', 'anonymous cannot read vouchers');
  perform t.throws($q$select public.rw_create_voucher('{}')$q$, 'permission denied', 'anonymous cannot call rw_create_voucher');
  perform t.admin();
  perform t.as_user('u1');
  perform t.throws($q$select public.rw_provision_user(gen_random_uuid(), 'INDORE', 'sneaky', 'Sneaky User', 's@x.com')$q$, 'permission denied', 'a signed-in user cannot provision accounts');
  perform t.throws($q$select public.rw_bootstrap(gen_random_uuid(), 'x', 'xxx', 'XX', 'xx', 'Xx Xx', 'x@x.com')$q$, 'permission denied', 'a signed-in user cannot call bootstrap');
  perform t.admin();
end $$;

-- ------------------------------------------------------------------------------------ 3. creating vouchers
do $$
declare r jsonb; v1 jsonb; v2 jsonb; r2 jsonb; bal bigint;
begin
  perform t.as_user('u1');
  r := public.rw_create_voucher(jsonb_build_object('type', 'RECEIPT', 'partyName', 'Balaji Borewell Works', 'particulars', 'Cash received against Invoice 151', 'amount', '50,000', 'clientId', 'dev-1'));
  perform t.eq(r -> 'voucher' ->> 'number', 'CRV-000001', 'first receipt is CRV-000001');
  perform t.eq(r -> 'voucher' ->> 'amountInWords', 'Rupees Fifty Thousand Only', 'amount in words stored with the voucher');
  perform t.eq((r ->> 'duplicate')::boolean, false, 'a new voucher is not a duplicate');
  perform t.set('rcv1', r -> 'voucher' ->> 'id');
  v1 := public.rw_create_voucher(jsonb_build_object('type', 'PAYMENT', 'partyName', 'Shree Ganesh Hardware', 'particulars', 'Purchase of GI pipes', 'amount', '12500.50'));
  perform t.eq(v1 -> 'voucher' ->> 'number', 'CPV-000001', 'payment and receipt have independent counters');
  perform t.set('pay1', v1 -> 'voucher' ->> 'id');
  -- a retry (offline queue) returns the same voucher and does not burn a number
  r2 := public.rw_create_voucher(jsonb_build_object('type', 'RECEIPT', 'partyName', 'Balaji Borewell Works', 'particulars', 'Cash received against Invoice 151', 'amount', '50,000', 'clientId', 'dev-1'));
  perform t.eq((r2 ->> 'duplicate')::boolean, true, 'a retried request is reported as duplicate');
  perform t.eq(r2 -> 'voucher' ->> 'id', r -> 'voucher' ->> 'id', 'a retried request returns the same voucher');
  v2 := public.rw_create_voucher(jsonb_build_object('type', 'RECEIPT', 'partyName', 'Shri Hari Irrigation', 'particulars', 'Advance for 5 HP pump', 'amount', 1000));
  perform t.eq(v2 -> 'voucher' ->> 'number', 'CRV-000002', 'a duplicate retry does not leave a gap in the numbers');
  perform t.admin();
  perform t.eq(public.rw_register_balance(t.u('u1')), 13849950::bigint, 'register balance = opening + in - out');
  perform t.as_user('u1');

  -- validation
  perform t.throws($q$select public.rw_create_voucher('{"type":"PAYMENT","partyName":"X Y","particulars":"abc","amount":"0"}')$q$, 'VALIDATION|Amount must be greater than 0', 'zero amount refused');
  perform t.throws($q$select public.rw_create_voucher('{"type":"PAYMENT","partyName":"X Y","particulars":"abc","amount":"99999999999"}')$q$, 'VALIDATION|Amount exceeds the limit', 'amount above the limit refused');
  perform t.throws($q$select public.rw_create_voucher('{"type":"PAYMENT","partyName":"X Y","particulars":"abc","amount":"10.999"}')$q$, 'VALIDATION|', 'three decimals refused');
  perform t.throws($q$select public.rw_create_voucher('{"type":"OTHER","partyName":"X Y","particulars":"abc","amount":"10"}')$q$, 'VALIDATION|Choose Cash Payment', 'unknown type refused');
  perform t.throws($q$select public.rw_create_voucher('{"type":"PAYMENT","partyName":"X","particulars":"abc","amount":"10"}')$q$, 'VALIDATION|Paid To must be at least 2', 'party name too short');
  perform t.throws($q$select public.rw_create_voucher('{"type":"PAYMENT","partyName":"X Y","particulars":"ab","amount":"10"}')$q$, 'VALIDATION|', 'particulars too short');
  perform t.throws(format($q$select public.rw_create_voucher('{"type":"PAYMENT","partyName":"X Y","particulars":"abc","amount":"10","date":"%s"}')$q$, public.rw_today() + 1), 'VALIDATION|Date cannot be in the future', 'future date refused');
  perform t.throws(format($q$select public.rw_create_voucher('{"type":"PAYMENT","partyName":"X Y","particulars":"abc","amount":"10","date":"%s"}')$q$, public.rw_today() - 9), 'VALIDATION|Date cannot be more than 7 days', 'a user cannot back-date more than 7 days');
  perform t.throws($q$select public.rw_create_voucher('{"type":"PAYMENT","partyName":"X Y","particulars":"abc","amount":"10","date":"2026-02-30"}')$q$, 'VALIDATION|Enter a valid date', 'impossible date refused');
  perform t.eq((select count(*)::int from public.vouchers), 3, 'no voucher was created by the refused attempts');
  perform t.admin();

  -- the failed attempts above did not burn numbers
  perform t.as_user('u2');
  r := public.rw_create_voucher(jsonb_build_object('type', 'PAYMENT', 'partyName', 'Mahalaxmi Electricals', 'particulars', 'Purchase of winding wire', 'amount', '60000'));
  perform t.eq(r -> 'voucher' ->> 'number', 'CPV-000002', 'numbers are continuous across users and branches');
  perform t.set('pay_big', r -> 'voucher' ->> 'id');
  perform t.admin();

  perform t.as_user('bm');
  r := public.rw_create_voucher(jsonb_build_object('type', 'PAYMENT', 'partyName', 'Old Bill Supplier', 'particulars', 'Settling an older bill', 'amount', '700', 'date', (public.rw_today() - 30)::text));
  perform t.eq(r -> 'voucher' ->> 'number', 'CPV-000003', 'an admin may back-date');
  perform t.admin();

  perform t.as_user('n1');
  r := public.rw_create_voucher(jsonb_build_object('type', 'PAYMENT', 'partyName', 'Bharat Petroleum', 'particulars', 'Diesel for delivery van', 'amount', '2200'));
  perform t.set('n_pay', r -> 'voucher' ->> 'id');
  perform t.eq(r -> 'voucher' ->> 'number', 'CPV-000004', 'Nagpur voucher takes the next global number');
  perform t.admin();

  perform t.as_user('viewer');
  perform t.throws($q$select public.rw_create_voucher('{"type":"PAYMENT","partyName":"X Y","particulars":"abc","amount":"10"}')$q$, 'FORBIDDEN|Viewers cannot create', 'viewers cannot create vouchers');
  perform t.admin();

  perform t.ok((select important from public.notifications where voucher_id = t.u('pay_big') and kind = 'VOUCHER_CREATED'), 'a payment of ₹50,000 or more raises an important notification');
end $$;

-- ------------------------------------------------------ 4. who can see what (Row Level Security)
do $$ declare c int; begin
  perform t.as_user('u1');  perform t.eq((select count(*)::int from public.vouchers), 3, 'a user sees only their own vouchers');
  perform t.eq((select count(*)::int from public.cash_registers), 1, 'a user sees only their own register');
  perform t.eq((select count(*)::int from public.profiles), 1, 'a user sees only their own profile');
  perform t.eq((select count(*)::int from public.branches), 1, 'a user sees only their own branch');
  perform t.eq((select count(*)::int from public.audit_logs), 0, 'a user cannot read the audit log');
  perform t.eq((select count(*)::int from public.outstanding), 0, 'a user cannot read outstanding entries');
  perform t.eq((select count(*)::int from public.cash_transactions), 3, 'the cash ledger view respects RLS');
  perform t.eq((select balance_paise from public.cash_transactions order by txn_date desc, seq desc limit 1), 13849950::bigint, 'ledger running balance ends at the register balance');
  perform t.admin();
  perform t.as_user('u2');  perform t.eq((select count(*)::int from public.vouchers), 1, 'another user in the same branch sees only their own');
  perform t.admin();
  perform t.as_user('bm');  perform t.eq((select count(*)::int from public.vouchers), 5, 'a branch admin sees the whole branch (and only it)');
  perform t.eq((select count(*)::int from public.vouchers where branch_id = t.u('nagpur')), 0, 'a branch admin cannot see another branch');
  perform t.eq((select count(*)::int from public.profiles), 3, 'a branch admin sees the branch''s users (and only them)');
  perform t.admin();
  perform t.as_user('n1');  perform t.eq((select count(*)::int from public.vouchers), 1, 'Nagpur user sees only Nagpur data');
  perform t.admin();
  perform t.as_user('viewer'); perform t.eq((select count(*)::int from public.vouchers), 1, 'a viewer sees the branch (read-only)');
  perform t.eq((select count(*)::int from public.profiles), 2, 'a viewer sees the branch users');
  perform t.admin();
  perform t.as_user('super'); perform t.eq((select count(*)::int from public.vouchers), 6, 'a Super Admin sees every branch');
  perform t.eq((select count(*)::int from public.branches), 3, 'a Super Admin sees every branch row');
  perform t.admin();

  -- nobody can write tables directly
  perform t.as_user('u1');
  perform t.throws($q$insert into public.vouchers (type, seq, number, branch_id, user_id, voucher_date, party_name, particulars, amount_paise, amount_in_words, created_by)
                      values ('PAYMENT', 99, 'CPV-000099', (select branch_id from public.profiles limit 1), (select id from public.profiles limit 1), current_date, 'Fraud', 'Fraud', 100, 'x', (select id from public.profiles limit 1))$q$,
                   'permission denied', 'a user cannot insert a voucher directly');
  perform t.throws($q$update public.vouchers set amount_paise = 1$q$, 'permission denied', 'a user cannot update a voucher directly');
  perform t.throws($q$delete from public.vouchers$q$, 'permission denied', 'a user cannot delete a voucher directly');
  perform t.throws($q$update public.profiles set role = 'SUPER_ADMIN'$q$, 'permission denied', 'a user cannot promote themself');
  perform t.throws($q$update public.cash_registers set opening_paise = 999999999$q$, 'permission denied', 'a user cannot change their opening balance');
  perform t.throws($q$select * from public.voucher_counters$q$, 'permission denied', 'the numbering counters are invisible to clients');
  perform t.throws($q$update public.settings set block_negative_cash = true$q$, 'permission denied', 'a user cannot change settings');
  perform t.throws($q$delete from public.audit_logs$q$, 'permission denied', 'a user cannot touch the audit log');
  perform t.admin();
  perform t.as_user('super');
  perform t.throws($q$update public.vouchers set amount_paise = 1$q$, 'permission denied', 'not even a Super Admin can write vouchers directly');
  perform t.admin();

  -- even the database owner / service role cannot rewrite history silently
  perform t.throws($q$update public.vouchers set amount_paise = 1$q$, 'LOCKED|Vouchers are locked', 'owner: direct voucher UPDATE blocked by trigger');
  perform t.throws($q$delete from public.vouchers$q$, 'LOCKED|Vouchers cannot be deleted', 'owner: voucher DELETE blocked by trigger');
  perform t.throws($q$truncate public.vouchers cascade$q$, 'LOCKED|', 'owner: voucher TRUNCATE blocked by trigger');
  perform t.throws($q$insert into public.vouchers (type, seq, number, branch_id, user_id, voucher_date, party_name, particulars, amount_paise, amount_in_words, created_by)
                      select 'PAYMENT', 99, 'CPV-000099', branch_id, id, current_date, 'Fraud', 'Fraud', 100, 'x', id from public.profiles limit 1$q$, 'LOCKED|', 'owner: direct voucher INSERT blocked (numbers only come from the function)');
  execute 'set role service_role';
  perform t.throws($q$update public.vouchers set party_name = 'Changed'$q$, 'LOCKED|Vouchers are locked', 'service role: direct voucher UPDATE blocked by trigger');
  perform t.throws($q$delete from public.audit_logs$q$, 'LOCKED|', 'service role: audit DELETE blocked by trigger');
  perform t.throws($q$update public.audit_logs set reason = 'x'$q$, 'LOCKED|', 'service role: audit UPDATE blocked by trigger');
  execute 'reset role';
  perform t.throws($q$truncate public.audit_logs$q$, 'LOCKED|', 'owner: audit TRUNCATE blocked by trigger');
end $$;

-- --------------------------------------------------------------- 5. admin corrections, void, delete
do $$
declare r jsonb; v public.vouchers; a public.audit_logs; bal_before bigint; bal_after bigint;
begin
  perform t.as_user('u1');
  perform t.throws(format($q$select public.rw_edit_voucher('%s', '{"partyName":"Changed Name"}', 'trying to cheat')$q$, t.get('pay1')), 'FORBIDDEN|', 'a user cannot edit their own locked voucher');
  perform t.throws(format($q$select public.rw_void_voucher('%s', 'trying to cheat')$q$, t.get('pay1')), 'FORBIDDEN|', 'a user cannot void');
  perform t.throws(format($q$select public.rw_delete_voucher('%s', 'trying to cheat')$q$, t.get('pay1')), 'FORBIDDEN|', 'a user cannot delete');
  perform t.admin();
  perform t.as_user('viewer');
  perform t.throws(format($q$select public.rw_edit_voucher('%s', '{"partyName":"Changed Name"}', 'viewer attempt')$q$, t.get('n_pay')), 'FORBIDDEN|', 'a viewer cannot edit');
  perform t.admin();

  perform t.as_user('bm');
  perform t.throws(format($q$select public.rw_edit_voucher('%s', '{"partyName":"Changed Name"}', 'other branch')$q$, t.get('n_pay')), 'NOT_FOUND|', 'a branch admin cannot touch another branch (looks like it does not exist)');
  perform t.throws(format($q$select public.rw_edit_voucher('%s', '{"partyName":"Changed Name"}', 'abc')$q$, t.get('pay1')), 'VALIDATION|Reason for edit must be at least 5', 'a reason is mandatory');
  perform t.throws(format($q$select public.rw_edit_voucher('%s', '{"partyName":"Shree Ganesh Hardware"}', 'No real change here')$q$, t.get('pay1')), 'VALIDATION|Nothing was changed', 'an edit that changes nothing is refused');
  perform t.throws(format($q$select public.rw_edit_voucher('%s', '{"amount":"-4"}', 'Fixing the amount')$q$, t.get('pay1')), 'VALIDATION|', 'an invalid amount is refused');
  r := public.rw_edit_voucher(t.u('pay1'), '{"amount":"2500.50","partyName":"Shree Ganesh Hardware & Co"}', 'Amount typed wrongly at the counter');
  perform t.eq((r -> 'voucher' ->> 'amountPaise')::bigint, 250050::bigint, 'admin correction applied');
  perform t.eq(r -> 'voucher' ->> 'amountInWords', 'Rupees Two Thousand Five Hundred and Fifty Paise Only', 'amount in words follows the corrected amount');
  perform t.eq((r -> 'voucher' ->> 'version')::int, 2, 'version increases on every correction');
  perform t.eq(r -> 'voucher' ->> 'number', 'CPV-000001', 'the voucher number never changes');
  perform t.admin();
  select * into a from public.audit_logs where action = 'EDIT' and entity = 'VOUCHER' order by id desc limit 1;
  perform t.eq((a.old_values ->> 'amount')::numeric, 12500.50, 'audit keeps the OLD amount');
  perform t.eq((a.new_values ->> 'amount')::numeric, 2500.50, 'audit keeps the NEW amount');
  perform t.eq(a.old_values ->> 'partyName', 'Shree Ganesh Hardware', 'audit keeps the old party name');
  perform t.eq(a.reason, 'Amount typed wrongly at the counter', 'audit keeps the reason');
  perform t.eq(a.actor_name, 'Kiran Shah', 'audit keeps who did it');
  perform t.eq((select count(*)::int from public.notifications where target_user_id = t.u('u1') and kind = 'VOUCHER_EDITED'), 1, 'the owner is told that their voucher was corrected');

  -- void
  bal_before := public.rw_register_balance(t.u('u1'));
  perform t.as_user('bm');
  r := public.rw_void_voucher(t.u('pay1'), 'Duplicate of an earlier entry');
  perform t.eq(r -> 'voucher' ->> 'status', 'VOID', 'voucher voided');
  perform t.admin();
  bal_after := public.rw_register_balance(t.u('u1'));
  perform t.eq(bal_after - bal_before, 250050::bigint, 'a voided payment is excluded from the cash balance');
  perform t.as_user('bm');
  perform t.throws(format($q$select public.rw_void_voucher('%s', 'Voiding twice')$q$, t.get('pay1')), 'LOCKED|', 'a voided voucher cannot be voided again');
  perform t.throws(format($q$select public.rw_edit_voucher('%s', '{"partyName":"Another Name"}', 'Editing a voided one')$q$, t.get('pay1')), 'LOCKED|', 'a voided voucher cannot be edited');
  perform t.throws(format($q$select public.rw_delete_voucher('%s', 'Branch admin delete')$q$, t.get('pay1')), 'FORBIDDEN|', 'only a Super Admin can delete');
  perform t.admin();

  -- soft delete
  perform t.as_user('super');
  perform t.eq(public.rw_delete_voucher(t.u('pay1'), 'Entered in the wrong branch by mistake') ->> 'ok', 'true', 'Super Admin soft-deletes');
  perform t.admin();
  select * into v from public.vouchers where id = t.u('pay1');
  perform t.eq(v.status::text, 'DELETED', 'a deleted voucher stays in the table');
  perform t.eq(v.number, 'CPV-000001', 'and keeps its number (never reused)');
  perform t.as_user('u1'); perform t.eq((select count(*)::int from public.vouchers), 2, 'a deleted voucher disappears for its owner'); perform t.admin();
  perform t.as_user('bm'); perform t.eq((select count(*)::int from public.vouchers where id = t.u('pay1')), 1, 'but admins still see it'); perform t.admin();
end $$;

-- ------------------------------------------------------------------------ 6. negative cash switch
do $$ begin
  update public.settings set block_negative_cash = true;
  perform t.as_user('u2');
  perform t.throws($q$select public.rw_create_voucher('{"type":"PAYMENT","partyName":"Big Spender","particulars":"Too much","amount":"500000"}')$q$, 'VALIDATION|Payment exceeds your cash balance', 'with the switch on, a payment above the balance is refused');
  perform t.ok((public.rw_create_voucher('{"type":"RECEIPT","partyName":"Cash Customer","particulars":"Sale of spares","amount":"100000"}') -> 'voucher' ->> 'number') is not null, 'receipts are still accepted');
  perform t.ok((public.rw_create_voucher('{"type":"PAYMENT","partyName":"Tea Stall","particulars":"Refreshments","amount":"200"}') -> 'voucher' ->> 'number') is not null, 'a payment within the balance is accepted');
  perform t.admin();
  update public.settings set block_negative_cash = false;
end $$;

-- ------------------------------------------------------------------------------ 7. registers and statements
do $$ declare r jsonb; st jsonb; bal bigint; begin
  bal := public.rw_register_balance(t.u('u1'));
  perform t.as_user('u1');
  r := public.rw_register(null, null, null);
  perform t.eq((r ->> 'openingPaise')::bigint, 10000000::bigint, 'statement opening = register opening');
  perform t.eq((r ->> 'closingPaise')::bigint, bal, 'statement closing = current balance');
  perform t.eq((r ->> 'closingPaise')::bigint, (r ->> 'openingPaise')::bigint + (r ->> 'inPaise')::bigint - (r ->> 'outPaise')::bigint, 'opening + in - out = closing');
  perform t.eq((r -> 'rows' -> -1 ->> 'balancePaise')::bigint, (r ->> 'closingPaise')::bigint, 'the last running balance is the closing balance');
  perform t.throws(format($q$select public.rw_register('%s')$q$, t.get('u2')), 'NOT_FOUND|', 'a user cannot read a colleague''s register');
  perform t.throws(format($q$select public.rw_register('%s', current_date, current_date - 5)$q$, t.get('u1')), 'VALIDATION|', 'start must not be after end');
  st := public.rw_generate_statement(t.u('u1'), 'MONTH', date_trunc('month', public.rw_today())::date, public.rw_today(), 'Current month');
  perform t.ok((st ->> 'statementNo') ~ '^STM-\d{4}-00001$', 'statement numbers are issued by the database');
  perform t.eq((select count(*)::int from public.statements), 1, 'the owner sees their statement history');
  perform t.admin();
  perform t.as_user('bm');
  perform t.ok((public.rw_register(t.u('u2'), null, null) ->> 'closingPaise') is not null, 'a branch admin can read any register of the branch');
  perform t.throws(format($q$select public.rw_register('%s')$q$, t.get('n1')), 'NOT_FOUND|', 'but not another branch''s register');
  perform t.admin();
  perform t.as_user('viewer');
  perform t.ok((public.rw_register(t.u('n1'), null, null) ->> 'closingPaise') is not null, 'a viewer can read the registers of their branch');
  perform t.throws(format($q$select public.rw_register('%s')$q$, t.get('u1')), 'NOT_FOUND|', 'a viewer cannot read other branches');
  perform t.admin();
  perform t.as_user('bm');
  perform t.throws(format($q$select public.rw_set_opening('%s', 5000, 'x')$q$, t.get('u1')), 'VALIDATION|', 'opening balance change needs a reason');
  perform t.ok((public.rw_set_opening(t.u('u2'), 2000000, 'Counted physical cash on day one') ->> 'openingPaise')::bigint = 2000000, 'a branch admin sets a branch user''s opening balance');
  perform t.throws(format($q$select public.rw_set_opening('%s', 5000, 'Not my branch at all')$q$, t.get('n1')), 'NOT_FOUND|', 'but not for another branch');
  perform t.admin();
  perform t.as_user('u1');
  perform t.throws(format($q$select public.rw_set_opening('%s', 5000, 'Make myself rich')$q$, t.get('u1')), 'FORBIDDEN|', 'a user cannot set an opening balance');
  perform t.admin();
end $$;

-- ------------------------------------------------------------------------------------------ 8. attachments
do $$
declare br text := t.get('indore'); vid text := t.get('rcv1'); a jsonb; n int;
begin
  perform t.as_user('u1');
  a := public.rw_add_attachment(t.u('rcv1'), br || '/' || vid || '/receipt-1.jpg', 'receipt 1.jpg', 'image/jpeg', 250000);
  perform t.eq(a -> 'attachment' ->> 'name', 'receipt 1.jpg', 'owner registers an uploaded receipt');
  perform t.throws(format($q$select public.rw_add_attachment('%s', 'other/%s/x.jpg', 'x.jpg', 'image/jpeg', 100)$q$, vid, vid), 'VALIDATION|Invalid file location', 'the file must be inside the voucher folder');
  perform t.throws(format($q$select public.rw_add_attachment('%s', '%s/%s/../x.jpg', 'x.jpg', 'image/jpeg', 100)$q$, vid, br, vid), 'VALIDATION|Invalid file location', 'path tricks are refused');
  perform t.throws(format($q$select public.rw_add_attachment('%s', '%s/%s/x.exe', 'x.exe', 'application/x-msdownload', 100)$q$, vid, br, vid), 'VALIDATION|Only JPG', 'only images and PDF are accepted');
  perform t.throws(format($q$select public.rw_add_attachment('%s', '%s/%s/big.pdf', 'big.pdf', 'application/pdf', 99999999)$q$, vid, br, vid), 'VALIDATION|Attachment is too large', 'oversize files are refused');
  for n in 2 .. 6 loop perform public.rw_add_attachment(t.u('rcv1'), br || '/' || vid || '/r' || n || '.png', 'r' || n || '.png', 'image/png', 1000); end loop;
  perform t.throws(format($q$select public.rw_add_attachment('%s', '%s/%s/r7.png', 'r7.png', 'image/png', 1000)$q$, vid, br, vid), 'VALIDATION|This voucher already has the maximum', 'attachment limit per voucher');
  perform t.admin();
  perform t.eq((public.rw_voucher_json((select v from public.vouchers v where id = t.u('rcv1'))) ->> 'attachmentCount')::int, 6, 'the voucher reports its attachment count');
  perform t.as_user('u2');
  perform t.throws(format($q$select public.rw_add_attachment('%s', '%s/%s/hack.jpg', 'hack.jpg', 'image/jpeg', 100)$q$, vid, br, vid), 'NOT_FOUND|', 'a colleague cannot attach to someone else''s voucher');
  perform t.eq((select count(*)::int from public.voucher_attachments), 0, 'a colleague cannot see the attachments');
  perform t.admin();
  perform t.as_user('viewer');
  perform t.throws(format($q$select public.rw_add_attachment('%s', '%s/%s/v.jpg', 'v.jpg', 'image/jpeg', 100)$q$, t.get('n_pay'), t.get('nagpur'), t.get('n_pay')), 'FORBIDDEN|', 'a viewer cannot attach');
  perform t.eq((select count(*)::int from public.voucher_attachments), 0, 'a viewer sees only their branch''s attachments (none here)');
  perform t.admin();
  perform t.as_user('bm');
  perform t.eq((select count(*)::int from public.voucher_attachments), 6, 'a branch admin sees the branch''s attachments');
  perform t.ok((public.rw_remove_attachment((select id from public.voucher_attachments limit 1), 'Blurred photo, re-uploaded') ->> 'ok')::boolean, 'an admin can remove (hide) an attachment');
  perform t.throws($q$select public.rw_remove_attachment((select id from public.voucher_attachments where removed_at is null limit 1), 'no')$q$, 'VALIDATION|', 'removal needs a reason');
  perform t.admin();
  perform t.as_user('u1');
  perform t.eq((select count(*)::int from public.voucher_attachments), 5, 'a removed attachment is hidden from its owner');
  perform t.throws($q$delete from public.voucher_attachments$q$, 'permission denied', 'attachments cannot be deleted by clients');
  perform t.admin();
  perform t.throws($q$delete from public.voucher_attachments$q$, 'LOCKED|', 'attachments cannot be deleted even by the owner role');
end $$;

-- the "receipts" bucket: who may upload / read files (policies on storage.objects)
do $$
declare br text := t.get('indore'); own text := t.get('rcv1'); other text := t.get('pay_big'); path text; n int;
begin
  perform t.as_user('u1');
  insert into storage.objects (bucket_id, name) values ('receipts', br || '/' || own || '/photo-a.jpg');
  perform t.ok(true, 'owner uploads into their voucher folder');
  perform t.throws(format($q$insert into storage.objects (bucket_id, name) values ('receipts', '%s/%s/photo-b.jpg')$q$, br, other), 'new row violates row-level security', 'cannot upload into a colleague''s voucher folder');
  perform t.throws(format($q$insert into storage.objects (bucket_id, name) values ('receipts', '%s/%s/photo-b.jpg')$q$, t.get('nagpur'), own), 'new row violates row-level security', 'cannot upload with a forged branch folder');
  perform t.throws($q$insert into storage.objects (bucket_id, name) values ('receipts', 'loose-file.jpg')$q$, 'new row violates row-level security', 'cannot upload outside a voucher folder');
  perform t.throws($q$insert into storage.objects (bucket_id, name) values ('somewhere-else', 'x/y/z.jpg')$q$, 'new row violates row-level security', 'only the receipts bucket is allowed');
  perform t.eq((select count(*)::int from storage.objects), 1, 'owner can read their file');
  update storage.objects set name = 'x/y/z.jpg'; get diagnostics n = row_count;
  perform t.eq(n, 0, 'files cannot be renamed / overwritten by clients');
  delete from storage.objects; get diagnostics n = row_count;
  perform t.eq(n, 0, 'files cannot be deleted by clients');
  perform t.admin();
  perform t.as_user('u2'); perform t.eq((select count(*)::int from storage.objects), 0, 'a colleague cannot read the file'); perform t.admin();
  perform t.as_user('bm'); perform t.eq((select count(*)::int from storage.objects), 1, 'the branch admin can read it'); perform t.admin();
  perform t.as_user('n1'); perform t.eq((select count(*)::int from storage.objects), 0, 'another branch cannot read it'); perform t.admin();
  perform t.as_user('viewer');
  perform t.throws(format($q$insert into storage.objects (bucket_id, name) values ('receipts', '%s/%s/v.jpg')$q$, t.get('nagpur'), t.get('n_pay')), 'new row violates row-level security', 'a viewer cannot upload');
  perform t.admin();
  perform t.as_user('bm');
  perform t.ok(true, 'branch admin may upload for a branch voucher');
  insert into storage.objects (bucket_id, name) values ('receipts', br || '/' || own || '/admin-added.jpg');
  perform t.admin();
end $$;

-- ------------------------------------------------------------------------------------------- 9. outstanding
do $$ declare r jsonb; oid uuid; oid2 uuid; onag uuid; rcv text; pay text; begin
  perform t.as_user('u1');
  perform t.throws($q$select public.rw_outstanding_create('{"direction":"RECEIVABLE","partyName":"Krishna Borewell","amount":"50000","dueDate":"2030-01-01"}')$q$, 'FORBIDDEN|', 'a user cannot create outstanding entries');
  perform t.admin();
  perform t.as_user('bm');
  r := public.rw_outstanding_create(jsonb_build_object('direction', 'RECEIVABLE', 'partyName', 'Krishna Borewell Contractors', 'amount', '50000', 'dueDate', (public.rw_today() + 10)::text, 'reference', 'INV/151'));
  oid := (r ->> 'id')::uuid;
  r := public.rw_outstanding_create(jsonb_build_object('direction', 'PAYABLE', 'partyName', 'Kisan Spare Parts', 'amount', '9000', 'dueDate', (public.rw_today() - 3)::text));
  oid2 := (r ->> 'id')::uuid;
  perform t.eq((select count(*)::int from public.outstanding), 2, 'branch admin sees their outstanding entries');
  perform t.throws(format($q$select public.rw_outstanding_settle('%s', '60000')$q$, oid), 'VALIDATION|Amount exceeds the balance', 'cannot settle more than the balance');
  perform t.throws(format($q$select public.rw_outstanding_settle('%s', '0')$q$, oid), 'VALIDATION|', 'cannot settle zero');
  r := public.rw_outstanding_settle(oid, '20000', null, 'Part payment in cash');
  perform t.eq(r ->> 'status', 'OPEN', 'a part payment keeps the entry open');
  select number into rcv from public.vouchers where type = 'RECEIPT' and branch_id = t.u('indore') limit 1;
  select number into pay from public.vouchers where type = 'PAYMENT' and branch_id = t.u('indore') and status = 'ACTIVE' limit 1;
  perform t.throws(format($q$select public.rw_outstanding_settle('%s', '30000', '%s')$q$, oid, pay), 'VALIDATION|Link a cash receipt', 'a receivable can only be settled with a receipt voucher');
  perform t.throws(format($q$select public.rw_outstanding_settle('%s', '30000', 'CRV-999999')$q$, oid), 'VALIDATION|Voucher not found', 'unknown voucher number refused');
  r := public.rw_outstanding_settle(oid, '30000', rcv, null);
  perform t.eq(r ->> 'status', 'SETTLED', 'the entry is settled when fully paid');
  perform t.throws(format($q$select public.rw_outstanding_settle('%s', '1')$q$, oid), 'LOCKED|', 'a settled entry is locked');
  perform t.throws(format($q$select public.rw_outstanding_cancel('%s', 'bad')$q$, oid2), 'VALIDATION|', 'cancelling needs a reason');
  perform t.eq(public.rw_outstanding_cancel(oid2, 'Entered by mistake, bill was never raised') ->> 'status', 'CANCELLED', 'an open entry can be cancelled with a reason');
  perform t.admin();
  perform t.as_user('super');
  r := public.rw_outstanding_create(jsonb_build_object('branchId', t.get('nagpur'), 'direction', 'RECEIVABLE', 'partyName', 'Nagpur Customer', 'amount', '1000', 'dueDate', (public.rw_today() + 5)::text));
  onag := (r ->> 'id')::uuid;
  perform t.eq((select count(*)::int from public.outstanding), 3, 'a Super Admin sees every branch''s entries');
  perform t.admin();
  perform t.as_user('bm');
  perform t.throws(format($q$select public.rw_outstanding_settle('%s', '10')$q$, onag), 'NOT_FOUND|', 'a branch admin cannot settle another branch''s entry');
  perform t.eq((select count(*)::int from public.outstanding where branch_id <> t.u('indore')), 0, 'and cannot even see it');
  perform t.eq((select count(*)::int from public.outstanding_settlements), 2, 'settlements are visible with their entry');
  perform t.admin();
  perform t.as_user('u1'); perform t.eq((select count(*)::int from public.outstanding_settlements), 0, 'users cannot see settlements'); perform t.admin();
end $$;

-- ----------------------------------------------------------------------------- 10. notifications
do $$ declare nid bigint; begin
  perform t.as_user('u1');
  perform t.ok((select count(*) from public.notifications) >= 1 and (select bool_and(target_user_id = t.u('u1')) from public.notifications), 'a user sees only notifications addressed to them');
  select id into nid from public.notifications limit 1;
  perform public.rw_mark_notifications_read(array[nid]);
  perform t.eq((select count(*)::int from public.notification_reads), 1, 'a notification can be marked as read');
  perform t.admin();
  perform t.as_user('bm');
  perform t.ok((select count(*) from public.notifications) > 0 and (select bool_and(branch_id = t.u('indore') and for_admins) from public.notifications), 'a branch admin sees admin notifications of their branch only');
  perform public.rw_mark_notifications_read((select array_agg(id) from public.notifications where branch_id is distinct from t.u('indore')));
  perform t.admin();
  perform t.as_user('n1');
  perform t.eq((select count(*)::int from public.notifications), 0, 'a user of another branch sees none of them');
  perform t.admin();
  perform t.as_user('super');
  perform t.ok((select count(*) from public.notifications where branch_id = t.u('nagpur')) > 0, 'a Super Admin sees every branch''s notifications');
  perform t.admin();
end $$;

-- ------------------------------------------------------------ 11. switching people and branches off
do $$ begin
  perform t.as_user('bm');
  perform t.throws(format($q$select public.rw_user_set_status('%s', 'INACTIVE', 'x')$q$, t.get('bm')), 'VALIDATION|You cannot change your own status', 'nobody can disable themself');
  perform t.throws(format($q$select public.rw_user_set_status('%s', 'INACTIVE', 'other branch')$q$, t.get('n1')), 'NOT_FOUND|', 'a branch admin cannot disable another branch''s user');
  perform public.rw_user_set_status(t.u('u2'), 'INACTIVE', 'Left the company');
  perform t.admin();
  perform t.as_user('u2');
  perform t.eq((select count(*)::int from public.vouchers), 0, 'a deactivated user immediately sees nothing');
  perform t.throws($q$select public.rw_create_voucher('{"type":"PAYMENT","partyName":"X Y","particulars":"abc","amount":"10"}')$q$, 'ACCOUNT_DISABLED|', 'a deactivated user cannot create vouchers');
  perform t.throws($q$select public.rw_me()$q$, 'ACCOUNT_DISABLED|', 'a deactivated user cannot load the app');
  perform t.admin();
  perform t.as_user('bm'); perform public.rw_user_set_status(t.u('u2'), 'ACTIVE', 'Returned'); perform t.admin();
  perform t.as_user('u2'); perform t.ok(public.rw_me() -> 'user' ->> 'username' = 'neha.joshi', 'a re-activated user works again'); perform t.admin();

  perform t.as_user('super');
  perform t.throws(format($q$select public.rw_user_set_status('%s', 'SUSPENDED', 'x')$q$, t.get('super')), 'VALIDATION|You cannot change your own status', 'a Super Admin cannot lock themself out');
  perform public.rw_branch_set_status(t.u('nagpur'), 'DISABLED', 'Branch closed for audit');
  perform t.ok((select count(*) from public.vouchers where branch_id = t.u('nagpur')) = 1, 'the Super Admin still sees a disabled branch');
  perform t.admin();
  perform t.as_user('n1');
  perform t.eq((select count(*)::int from public.vouchers), 0, 'users of a disabled branch see nothing');
  perform t.throws($q$select public.rw_create_voucher('{"type":"PAYMENT","partyName":"X Y","particulars":"abc","amount":"10"}')$q$, 'ACCOUNT_DISABLED|', 'and cannot create vouchers');
  perform t.admin();
  perform t.eq(jsonb_array_length(public.rw_public_info() -> 'branches'), 2, 'a disabled branch disappears from the login list');
  perform t.as_user('super'); perform public.rw_branch_set_status(t.u('nagpur'), 'ACTIVE', 'Reopened'); perform t.admin();
  perform t.as_user('n1'); perform t.eq((select count(*)::int from public.vouchers), 1, 're-enabled branch works again'); perform t.admin();
end $$;

-- ---------------------------------------------------------------------------------------- 12. the audit trail
do $$ declare v jsonb; n int; begin
  perform t.as_user('super');
  v := public.rw_verify_audit();
  perform t.ok((v ->> 'ok')::boolean and (v ->> 'count')::int > 30, 'the audit chain verifies (' || (v ->> 'count') || ' entries)');
  perform t.ok((select count(*) from public.audit_logs) = (v ->> 'count')::int, 'a Super Admin can read every audit entry');
  perform t.admin();
  perform t.as_user('bm');
  perform t.throws($q$select public.rw_verify_audit()$q$, 'FORBIDDEN|', 'only a Super Admin can run the integrity check');
  perform t.ok((select count(*) from public.audit_logs) > 0 and (select bool_and(branch_id = t.u('indore')) from public.audit_logs), 'a branch admin reads only their branch''s audit entries');
  perform t.admin();
  perform t.ok((select count(distinct entity) from public.audit_logs) >= 5, 'audit covers vouchers, users, branches, outstanding and registers');
  perform t.ok((select bool_and(prev_hash = coalesce((select hash from public.audit_logs p where p.id = a.id - 1), 'GENESIS')) from public.audit_logs a), 'every entry links to the one before it');
end $$;

-- tamper test: someone with database access disables the guard, edits one old entry, then verification must notice
begin;
alter table public.audit_logs disable trigger audit_logs_no_update;
update public.audit_logs set reason = 'tampered' where id = (select min(id) + 5 from public.audit_logs);
do $$ declare v jsonb; begin
  perform t.as_user('super'); v := public.rw_verify_audit(); perform t.admin();
  perform t.ok(not (v ->> 'ok')::boolean and (v ->> 'brokenAt')::bigint = (select min(id) + 5 from public.audit_logs), 'tampering with an audit entry is detected at exactly that entry');
end $$;
rollback;
begin;
alter table public.audit_logs disable trigger audit_logs_no_update;
alter table public.audit_logs disable trigger audit_logs_no_truncate;
delete from public.audit_logs where id = (select min(id) + 3 from public.audit_logs);
do $$ declare v jsonb; begin
  perform t.as_user('super'); v := public.rw_verify_audit(); perform t.admin();
  perform t.ok(not (v ->> 'ok')::boolean, 'a deleted audit entry breaks the chain and is detected');
end $$;
rollback;
do $$ declare v jsonb; begin
  perform t.as_user('super'); v := public.rw_verify_audit(); perform t.admin();
  perform t.ok((v ->> 'ok')::boolean, 'after the rolled-back tampering the chain is intact again');
end $$;

-- ------------------------------------------------------------------------- 13. final consistency checks
do $$ declare bad int; begin
  perform t.eq((select count(*)::int from public.vouchers v join public.voucher_counters c on c.type = v.type where v.seq > c.last_seq), 0, 'no voucher number is above its counter');
  perform t.eq((select max(seq) from public.vouchers where type = 'PAYMENT'), (select last_seq from public.voucher_counters where type = 'PAYMENT'), 'payment counter = highest payment number (no burnt numbers)');
  perform t.eq((select max(seq) from public.vouchers where type = 'RECEIPT'), (select last_seq from public.voucher_counters where type = 'RECEIPT'), 'receipt counter = highest receipt number (no burnt numbers)');
  perform t.eq((select count(distinct number)::int from public.vouchers), (select count(*)::int from public.vouchers), 'every voucher number is unique');
  select count(*) into bad from public.vouchers where amount_in_words <> public.rw_amount_in_words(amount_paise);
  perform t.eq(bad, 0, 'stored amount-in-words always matches the amount (also after corrections)');
  perform t.eq((select count(*)::int from public.profiles p where p.role <> 'VIEWER' and not exists (select 1 from public.cash_registers r where r.user_id = p.id)), 0, 'every non-viewer has a cash register');
end $$;

\echo
\echo 'SQL tests passed.'
