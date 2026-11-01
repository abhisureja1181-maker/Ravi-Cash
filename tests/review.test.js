// Audit review ("Valid" / "Not valid") and "Cash Received" entries (money handed to a user, no voucher number).
const test = require('node:test');
const assert = require('node:assert/strict');
const RW = require('./load.js');

async function fresh() {
  const server = RW.createServer({ storage: new RW.MemoryStorage(), hashIterations: 1000 });
  await RW.seedDemo(server, { adminActions: true });
  return server;
}
async function login(server, branch, user, pw) {
  const r = await server.call(null, 'auth.login', { branchCode: branch, identifier: user, password: pw || 'Ravi@1234' }, { device: 'test' });
  return r.token;
}
const rejects = (p, code) => assert.rejects(p, (e) => { assert.equal(e.code, code, 'expected ' + code + ' got ' + e.code + ': ' + e.message); return true; });
const PAY = { type: 'PAYMENT', partyName: 'Review Test Supplier', particulars: 'Pipes for the review test', amount: '1000' };
const bal = async (s, t) => (await s.call(t, 'register.get', {})).currentBalancePaise;

test('review: Not valid needs a reason, is admin-only, and stops the payment counting as expense (balance, lists, register, exports)', async () => {
  const s = await fresh();
  const sa = await login(s, 'MAIN', 'admin', 'Admin@1234'), bm = await login(s, 'INDORE', 'indore.manager'), rahul = await login(s, 'INDORE', 'indore.accountant');
  const before = await bal(s, rahul);
  const v = (await s.call(rahul, 'vouchers.create', PAY)).voucher;
  assert.equal(v.review, 'PENDING');
  assert.equal(v.counted, true);
  assert.equal(await bal(s, rahul), before - 100000, 'a new payment counts straight away');

  await rejects(s.call(rahul, 'vouchers.review', { id: v.id, status: 'INVALID', reason: 'not my business' }), 'FORBIDDEN');
  await rejects(s.call(sa, 'vouchers.review', { id: v.id, status: 'INVALID', reason: 'no' }), 'VALIDATION');
  await rejects(s.call(sa, 'vouchers.review', { id: v.id, status: 'MAYBE', reason: 'unclear status' }), 'VALIDATION');
  assert.equal(await bal(s, rahul), before - 100000, 'refused calls change nothing');

  const r = await s.call(sa, 'vouchers.review', { id: v.id, status: 'INVALID', reason: 'Fake bill, no receipt' });
  assert.equal(r.voucher.review, 'INVALID');
  assert.equal(r.voucher.counted, false);
  assert.equal(r.voucher.reviewReason, 'Fake bill, no receipt');
  assert.ok(r.voucher.reviewedBy && r.voucher.reviewedAt);
  assert.equal(r.voucher.status, 'ACTIVE', 'the voucher itself stays; only its money is excluded');
  assert.equal(await bal(s, rahul), before, 'the money is back in the user cash');
  await rejects(s.call(sa, 'vouchers.review', { id: v.id, status: 'INVALID', reason: 'Fake bill, no receipt' }), 'VALIDATION');

  // list totals exclude it but report it
  const list = await s.call(rahul, 'vouchers.list', { filters: { userId: (await s.call(rahul, 'auth.me', {})).user.id, from: v.date, to: v.date }, pageSize: 200 });
  assert.ok(list.rows.some((x) => x.id === v.id), 'still listed');
  assert.equal(list.totals.notValidPaise, 100000);
  assert.equal(list.totals.notValidCount, 1);
  const inList = list.rows.filter((x) => x.counted && x.type === 'PAYMENT').reduce((a, x) => a + x.amountPaise, 0);
  assert.equal(list.totals.outPaise, inList, 'out total = sum of the counted payments only');

  // register / statement
  const reg = await s.call(rahul, 'register.get', {});
  assert.equal(reg.currentBalancePaise, before);
  const day = await s.call(rahul, 'register.get', { from: v.date, to: v.date });
  const row = day.rows.find((x) => x.id === v.id);
  assert.ok(row && row.notValid && row.outPaise === 0 && row.amountPaise === 100000, 'shown in the register but not counted');
  assert.equal(day.notValidCount, 1);
  assert.equal(day.notValidPaise, 100000);
  const lst = (await s.call(sa, 'registers.list', {})).rows.find((x) => x.userId === v.userId);
  assert.equal(lst.balancePaise, before);
  assert.equal(lst.notValidPaise, 100000);

  // export keeps the row, but not as cash out
  const ex = await s.call(sa, 'export.vouchers', { filters: { q: 'Review Test Supplier' } });
  assert.equal(ex.rows.length, 1);
  assert.equal(ex.rows[0].cashOut, null);
  assert.equal(ex.rows[0].review, 'Not valid');
  assert.equal(ex.totals.outPaise, 0);

  // the audit trail records who/why, and the chain is intact
  const log = (await s.call(sa, 'audit.list', { filters: { action: 'REVIEW' } })).rows;
  assert.equal(log.length, 1);
  assert.equal(log[0].reason, 'Fake bill, no receipt');
  assert.equal(log[0].new.review, 'Not valid');
  assert.equal(log[0].new.counted, false);
  assert.equal((await s.call(sa, 'audit.verify', {})).ok, true);

  // the owner of the voucher is told
  const notes = (await s.call(rahul, 'notifications.list', {})).rows || [];
  assert.ok(notes.some((n) => /not valid/i.test(n.title)), 'user notified');
});

test('review: reversible, VALID keeps counting, undo returns to "not reviewed", edit after VALID asks for a new review', async () => {
  const s = await fresh();
  const sa = await login(s, 'MAIN', 'admin', 'Admin@1234'), bm = await login(s, 'INDORE', 'indore.manager'), rahul = await login(s, 'INDORE', 'indore.accountant');
  const before = await bal(s, rahul);
  const v = (await s.call(rahul, 'vouchers.create', PAY)).voucher;

  const ok = await s.call(sa, 'vouchers.review', { id: v.id, status: 'VALID' });
  assert.equal(ok.voucher.review, 'VALID');
  assert.equal(await bal(s, rahul), before - 100000);

  await s.call(sa, 'vouchers.review', { id: v.id, status: 'INVALID', reason: 'Wrong person paid' });
  assert.equal(await bal(s, rahul), before);
  await s.call(sa, 'vouchers.review', { id: v.id, status: 'VALID', reason: 'Bill found' });
  assert.equal(await bal(s, rahul), before - 100000, 'marking valid again counts the expense again');

  // changing a voucher after it was approved sends it back to the queue
  await rejects(s.call(bm, 'vouchers.edit', { id: v.id, reason: 'Amount corrected after check', patch: { amount: '900' } }), 'FORBIDDEN');
  const e = await s.call(sa, 'vouchers.edit', { id: v.id, reason: 'Amount corrected after check', patch: { amount: '900' } });
  assert.equal(e.voucher.review, 'PENDING');
  assert.equal(await bal(s, rahul), before - 90000);

  await s.call(sa, 'vouchers.review', { id: v.id, status: 'INVALID', reason: 'Duplicate of another bill' });
  const back = await s.call(sa, 'vouchers.review', { id: v.id, status: 'PENDING' });
  assert.equal(back.voucher.review, 'PENDING');
  assert.equal(back.voucher.reviewReason, '');
  assert.equal(await bal(s, rahul), before - 90000);
});

test('review: only live payment vouchers; branch scoping; queue filter + summary', async () => {
  const s = await fresh();
  const sa = await login(s, 'MAIN', 'admin', 'Admin@1234'), bm = await login(s, 'INDORE', 'indore.manager'), rahul = await login(s, 'INDORE', 'indore.accountant');
  const pay = (await s.call(rahul, 'vouchers.create', PAY)).voucher;
  const rec = (await s.call(rahul, 'vouchers.create', { type: 'RECEIPT', partyName: 'Customer', particulars: 'Pump sale', amount: '500' })).voucher;
  assert.equal(rec.review, 'NA');
  await rejects(s.call(sa, 'vouchers.review', { id: rec.id, status: 'INVALID', reason: 'receipts are not reviewed' }), 'VALIDATION');

  const voided = (await s.call(rahul, 'vouchers.create', PAY)).voucher;
  await rejects(s.call(bm, 'vouchers.void', { id: voided.id, reason: 'Entered twice by mistake' }), 'FORBIDDEN');
  await s.call(sa, 'vouchers.void', { id: voided.id, reason: 'Entered twice by mistake' });
  await rejects(s.call(sa, 'vouchers.review', { id: voided.id, status: 'VALID' }), 'LOCKED');

  // a branch admin (of this or another branch) cannot review at all — only the Super Admin can
  const other = await login(s, 'MAIN', 'main.manager');
  await rejects(s.call(other, 'vouchers.review', { id: pay.id, status: 'VALID' }), 'FORBIDDEN');
  await rejects(s.call(bm, 'vouchers.review', { id: pay.id, status: 'VALID' }), 'FORBIDDEN');
  const auditor = await login(s, 'NAGPUR', 'nagpur.auditor');
  await rejects(s.call(auditor, 'vouchers.review', { id: pay.id, status: 'VALID' }), 'FORBIDDEN');

  const q = await s.call(bm, 'vouchers.list', { filters: { review: 'PENDING', q: 'Review Test Supplier' }, pageSize: 50 });
  assert.deepEqual(q.rows.map((x) => x.id), [pay.id], 'queue holds only the live, unreviewed payment');
  await s.call(sa, 'vouchers.review', { id: pay.id, status: 'INVALID', reason: 'Not a business expense' });
  const sum = await s.call(bm, 'vouchers.reviewSummary', { filters: { q: 'Review Test Supplier' } });
  assert.equal(sum.PENDING.count, 0);
  assert.equal(sum.INVALID.count, 1);
  assert.equal(sum.INVALID.paise, 100000);
  assert.equal((await s.call(sa, 'vouchers.list', { filters: { review: 'INVALID', q: 'Review Test Supplier' } })).rows.length, 1);
  await rejects(s.call(rahul, 'vouchers.reviewSummary', {}), 'FORBIDDEN');
});

test('Cash Received: no number, no counter used, adds to the user cash, listed and exported with its own label', async () => {
  const s = await fresh();
  const sa = await login(s, 'MAIN', 'admin', 'Admin@1234'), rahul = await login(s, 'INDORE', 'indore.accountant');
  const before = await bal(s, rahul);
  const settings = await s.call(sa, 'settings.get', {});
  const counters = JSON.stringify(settings.counters);

  const r = await s.call(rahul, 'vouchers.create', { kind: 'RECEIVED', partyName: 'Ravi Sharma (Owner)', amount: '25000', particulars: 'Cash for site expenses' });
  const v = r.voucher;
  assert.equal(v.number, '');
  assert.equal(v.kind, 'RECEIVED');
  assert.equal(v.type, 'RECEIPT');
  assert.equal(v.label, 'Cash Received');
  assert.equal(v.review, 'NA');
  assert.equal(await bal(s, rahul), before + 2500000, 'balance shows how much cash the user holds');
  assert.equal(JSON.stringify((await s.call(sa, 'settings.get', {})).counters), counters, 'no voucher number was consumed');
  const lst = (await s.call(sa, 'registers.list', {})).rows.find((x) => x.userId === v.userId);
  assert.equal(lst.receivedPaise, 2500000);
  assert.equal(lst.balancePaise, before + 2500000);

  // particulars are optional for this entry
  const quick = (await s.call(rahul, 'vouchers.create', { kind: 'RECEIVED', partyName: 'Branch Manager', amount: '100' })).voucher;
  assert.match(quick.particulars, /Cash received from Branch Manager/);
  // the regular voucher after it still gets the next number in sequence
  const next = (await s.call(rahul, 'vouchers.create', { type: 'RECEIPT', partyName: 'Customer', particulars: 'Pump sale', amount: '10' })).voucher;
  assert.match(next.number, /^CRV-\d+$/);

  await rejects(s.call(rahul, 'vouchers.create', { kind: 'RECEIVED', partyName: 'X', amount: '10' }), 'VALIDATION'); // party too short
  await rejects(s.call(rahul, 'vouchers.create', { kind: 'RECEIVED', partyName: 'Owner', amount: '0' }), 'VALIDATION');
  const viewer = await login(s, 'NAGPUR', 'nagpur.auditor');
  await rejects(s.call(viewer, 'vouchers.create', { kind: 'RECEIVED', partyName: 'Owner', amount: '10' }), 'FORBIDDEN');

  const kinds = await s.call(sa, 'vouchers.list', { filters: { kind: 'RECEIVED' }, pageSize: 200 });
  assert.ok(kinds.rows.length >= 2 && kinds.rows.every((x) => x.kind === 'RECEIVED'));
  const byNum = await s.call(sa, 'vouchers.get', { number: '' }).catch((e) => e);
  assert.equal(byNum.code, 'NOT_FOUND', 'an empty number never matches a numberless entry');
  const detail = await s.call(sa, 'vouchers.get', { id: v.id });
  assert.equal(detail.voucher.kind, 'RECEIVED');

  const ex = await s.call(sa, 'export.vouchers', { filters: { kind: 'RECEIVED', userId: v.userId } });
  assert.ok(ex.rows.every((x) => x.number === '—' && (x.type === 'Cash Received' ? x.cashIn > 0 : x.type === 'Transfer In' && x.transferIn > 0)));      // a received branch transfer is a Cash Received too, but not income
  assert.ok(ex.rows.some((x) => x.type === 'Cash Received' && x.cashIn === 25000));

  const log = (await s.call(sa, 'audit.list', { filters: { q: 'Cash Received' } })).rows;
  assert.ok(log.some((a) => a.action === 'CREATE' && a.entityLabel === 'Cash Received' && a.new.receivedFrom === 'Ravi Sharma (Owner)'));
  assert.equal((await s.call(sa, 'audit.verify', {})).ok, true);

  // idempotent for offline retries
  const p = { kind: 'RECEIVED', partyName: 'Owner Sharma', amount: '5', clientId: 'c-recv-1' };
  const a = await s.call(rahul, 'vouchers.create', p), b = await s.call(rahul, 'vouchers.create', p);
  assert.equal(b.duplicate, true);
  assert.equal(a.voucher.id, b.voucher.id);
});

test('Cash Received: the main admin can void / permanently delete it like any entry (branch admin cannot), and it appears in the statement without a number', async () => {
  const s = await fresh();
  const sa = await login(s, 'MAIN', 'admin', 'Admin@1234'), bm = await login(s, 'INDORE', 'indore.manager'), rahul = await login(s, 'INDORE', 'indore.accountant');
  const before = await bal(s, rahul);
  const v = (await s.call(rahul, 'vouchers.create', { kind: 'RECEIVED', partyName: 'Owner Sharma', amount: '700' })).voucher;
  const reg = await s.call(rahul, 'register.get', {});
  assert.equal(reg.currentBalancePaise, before + 70000);
  const st = await s.call(rahul, 'statements.generate', { period: 'CUSTOM', from: v.date, to: v.date });
  const row = st.rows.find((x) => x.id === v.id);
  assert.ok(row, 'present in the statement');
  assert.equal(row.number, '');
  assert.equal(row.kind, 'RECEIVED');
  assert.equal(row.inPaise, 70000);
  assert.ok(st.receivedPaise >= 70000);

  await rejects(s.call(bm, 'vouchers.void', { id: v.id, reason: 'Wrong amount entered' }), 'FORBIDDEN');
  await s.call(sa, 'vouchers.void', { id: v.id, reason: 'Wrong amount entered' });
  assert.equal(await bal(s, rahul), before);
  const r = await s.call(sa, 'vouchers.purge', { ids: [v.id], reason: 'Clean up test data' });
  assert.equal(r.removed, 1);
  const log = (await s.call(sa, 'audit.list', { filters: { action: 'PURGE' } })).rows;
  assert.equal(log[0].entityLabel, 'Cash Received');
});

test('review: only the main (Super) admin can mark Valid / Not valid / Undo — branch admins, other-branch admins and users cannot', async () => {
  const s = await fresh();
  const sa = await login(s, 'MAIN', 'admin', 'Admin@1234'), bm = await login(s, 'INDORE', 'indore.manager'), rahul = await login(s, 'INDORE', 'indore.accountant');
  const mainMgr = await login(s, 'MAIN', 'main.manager'), viewer = await login(s, 'NAGPUR', 'nagpur.auditor');
  const before = await bal(s, rahul);
  const v = (await s.call(rahul, 'vouchers.create', PAY)).voucher;
  for (const who of [bm, rahul, mainMgr, viewer]) {
    for (const st of ['VALID', 'INVALID', 'PENDING']) await rejects(s.call(who, 'vouchers.review', { id: v.id, status: st, reason: 'trying to review' }), 'FORBIDDEN');
  }
  assert.equal(await bal(s, rahul), before - 100000, 'refused calls changed nothing');
  assert.equal((await s.call(sa, 'vouchers.get', { id: v.id })).voucher.review, 'PENDING');

  await s.call(sa, 'vouchers.review', { id: v.id, status: 'INVALID', reason: 'Fake bill, no receipt' });
  assert.equal(await bal(s, rahul), before, 'the amount is back in the user\'s cash');
  // the branch admin and the user still SEE the result (and the reason) ...
  for (const who of [bm, rahul]) {
    const seen = (await s.call(who, 'vouchers.get', { id: v.id })).voucher;
    assert.equal(seen.review, 'INVALID'); assert.equal(seen.counted, false); assert.match(seen.reviewReason, /Fake bill/);
  }
  // ... but cannot undo it
  await rejects(s.call(bm, 'vouchers.review', { id: v.id, status: 'PENDING' }), 'FORBIDDEN');
  await rejects(s.call(rahul, 'vouchers.review', { id: v.id, status: 'VALID' }), 'FORBIDDEN');
  assert.equal(await bal(s, rahul), before);
  // the Super Admin can undo
  await s.call(sa, 'vouchers.review', { id: v.id, status: 'PENDING' });
  assert.equal(await bal(s, rahul), before - 100000);
});

test('voucher number: only the main (Super) admin can change it; unique, valid format, audited; auto-numbering skips a number used by hand', async () => {
  const s = await fresh();
  const sa = await login(s, 'MAIN', 'admin', 'Admin@1234'), bm = await login(s, 'INDORE', 'indore.manager'), rahul = await login(s, 'INDORE', 'indore.accountant');
  const mainMgr = await login(s, 'MAIN', 'main.manager');
  const a = (await s.call(rahul, 'vouchers.create', PAY)).voucher;
  const b = (await s.call(rahul, 'vouchers.create', PAY)).voucher;
  const R = 'Number corrected to match the paper book';

  // nobody but the Super Admin: not the user, not a branch admin of the same branch, not the Main branch's branch admin
  for (const who of [rahul, bm, mainMgr]) await rejects(s.call(who, 'vouchers.edit', { id: a.id, reason: R, patch: { number: 'CPV-009001' } }), 'FORBIDDEN');
  assert.equal((await s.call(sa, 'vouchers.get', { id: a.id })).voucher.number, a.number, 'refused calls changed nothing');

  // format + uniqueness
  for (const bad of ['', 'ab', 'CPV 009001', 'CPV-0090$1', 'X'.repeat(31)]) await rejects(s.call(sa, 'vouchers.edit', { id: a.id, reason: R, patch: { number: bad } }), 'VALIDATION');
  await rejects(s.call(sa, 'vouchers.edit', { id: a.id, reason: R, patch: { number: b.number } }), 'CONFLICT');
  await rejects(s.call(sa, 'vouchers.edit', { id: a.id, reason: R, patch: { number: b.number.toLowerCase() } }), 'CONFLICT');
  await rejects(s.call(sa, 'vouchers.edit', { id: a.id, patch: { number: 'CPV-009001' } }), 'VALIDATION'); // reason is mandatory

  // the real change (lower-case input is normalised), audited with old + new, and the detail page shows it
  const e = await s.call(sa, 'vouchers.edit', { id: a.id, reason: R, patch: { number: ' cpv-009001 ' } });
  assert.equal(e.voucher.number, 'CPV-009001');
  assert.equal(e.voucher.version, 2);
  const d = await s.call(sa, 'vouchers.get', { id: a.id });
  const edit = d.timeline.find((t) => t.action === 'EDIT');
  assert.deepEqual(edit.old, { number: a.number });
  assert.deepEqual(edit.new, { number: 'CPV-009001' });
  assert.equal(edit.reason, R);
  assert.equal(edit.by, 'Super Admin');
  assert.equal((await s.call(sa, 'audit.verify', {})).ok, true, 'audit chain still valid');
  // the old number is free again and can be given to the other voucher; same number to itself is "no change"
  await s.call(sa, 'vouchers.edit', { id: b.id, reason: R, patch: { number: a.number } });
  await rejects(s.call(sa, 'vouchers.edit', { id: b.id, reason: R, patch: { number: a.number } }), 'VALIDATION');

  // a Cash Received entry has no number to change
  const cr = (await s.call(rahul, 'vouchers.create', { kind: 'RECEIVED', partyName: 'Owner Sharma', amount: '100' })).voucher;
  await rejects(s.call(sa, 'vouchers.edit', { id: cr.id, reason: R, patch: { number: 'CPV-009002' } }), 'VALIDATION');

  // automatic numbering never hands out a number that was typed in by hand
  const raw = await s.load();
  const next = raw.counters.PAYMENT + 1;
  const taken = 'CPV-' + String(next).padStart(6, '0');
  await s.call(sa, 'vouchers.edit', { id: a.id, reason: R, patch: { number: taken } });
  const c = (await s.call(rahul, 'vouchers.create', PAY)).voucher;
  assert.notEqual(c.number, taken);
  assert.equal(c.number, 'CPV-' + String(next + 1).padStart(6, '0'));
  assert.equal(new Set((await s.call(sa, 'vouchers.list', { pageSize: 500 })).rows.map((v) => v.number).filter(Boolean)).size,
    (await s.call(sa, 'vouchers.list', { pageSize: 500 })).rows.filter((v) => v.number).length, 'all voucher numbers unique');
});
