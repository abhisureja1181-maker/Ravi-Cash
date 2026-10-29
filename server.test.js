const test = require('node:test');
const assert = require('node:assert/strict');
const RW = require('./load.js');

async function fresh(opts) {
  const server = RW.createServer({ storage: new RW.MemoryStorage(), hashIterations: 1000 });
  const info = await server.seed ? null : null;
  await RW.seedDemo(server, Object.assign({ adminActions: true }, opts || {}));
  return server;
}
async function login(server, branch, user, pw) {
  const r = await server.call(null, 'auth.login', { branchCode: branch, identifier: user, password: pw || 'Ravi@1234' }, { device: 'test' });
  return r.token;
}
const rejects = (p, code) => assert.rejects(p, (e) => { assert.equal(e.code, code, 'expected ' + code + ' got ' + e.code + ': ' + e.message); return true; });
const PAY = { type: 'PAYMENT', partyName: 'Test Supplier', particulars: 'Test purchase of pipes', amount: '1000' };

test('amount in words (Indian numbering)', () => {
  const w = RW.amountInWords;
  assert.equal(w(12550000), 'Rupees One Lakh Twenty-Five Thousand Five Hundred Only');
  assert.equal(w(500000), 'Rupees Five Thousand Only');
  assert.equal(w(100), 'Rupees One Only');
  assert.equal(w(5005050), 'Rupees Fifty Thousand Fifty and Fifty Paise Only'.replace('Fifty Thousand Fifty and', 'Fifty Thousand Fifty and'));
  assert.equal(w(1000000000), 'Rupees One Crore Only');
  assert.equal(w(1234567800), 'Rupees One Crore Twenty-Three Lakh Forty-Five Thousand Six Hundred Seventy-Eight Only');
  assert.equal(w(2550), 'Rupees Twenty-Five and Fifty Paise Only');
  assert.equal(w(50), 'Fifty Paise Only');
  assert.equal(w(10100), 'Rupees One Hundred One Only');
  assert.equal(w(101), 'Rupees One and One Paise Only');
  assert.equal(w(10000000000), 'Rupees Ten Crore Only');
});

test('money parsing and Indian formatting', () => {
  assert.equal(RW.toPaise('1,25,500.50'), 12550050);
  assert.equal(RW.toPaise('₹ 5000'), 500000);
  assert.equal(RW.toPaise(19.99), 1999);
  assert.throws(() => RW.toPaise('10.555'), /2 decimals/);
  assert.throws(() => RW.toPaise('abc'));
  assert.throws(() => RW.toPaise('-5'));
  assert.throws(() => RW.toPaise('1e5'));
  assert.equal(RW.fmtINR(12550000), '₹1,25,500');
  assert.equal(RW.fmtINR(12550050), '₹1,25,500.50');
  assert.equal(RW.fmtINR(-500000), '-₹5,000');
  assert.equal(RW.fmtINR(123456789000), '₹1,23,45,67,890');
  assert.equal(RW.compactINR(12550000), '₹1.26 L');
  assert.equal(RW.compactINR(25000000), '₹2.5 L');
});

test('date helpers: weeks, fiscal year, IST', () => {
  assert.equal(RW.startOfWeek('2026-10-12'), '2026-10-12'); // Monday
  assert.equal(RW.startOfWeek('2026-10-18'), '2026-10-12'); // Sunday belongs to the Monday week
  assert.equal(RW.fiscalStart('2026-10-12', 4), '2026-04-01');
  assert.equal(RW.fiscalStart('2027-02-01', 4), '2026-04-01');
  assert.equal(RW.fiscalEnd('2026-10-12', 4), '2027-03-31');
  assert.equal(RW.fiscalLabel('2026-10-12', 4), '2026-27');
  assert.equal(RW.endOfMonth('2028-02-10'), '2028-02-29');
  assert.equal(RW.istDate(Date.parse('2026-10-12T19:00:00Z')), '2026-10-13'); // 00:30 IST next day
  assert.equal(RW.fmtDateTime('2026-10-12T06:12:00Z'), '12 Oct 2026, 11:42 AM');
  assert.equal(RW.isValidDate('2026-02-30'), false);
});

test('login: success, wrong password, wrong branch, lockout', async () => {
  const s = await fresh();
  const ok = await s.call(null, 'auth.login', { branchCode: 'INDORE', identifier: 'indore.accountant', password: 'Ravi@1234' }, {});
  assert.equal(ok.user.fullName, 'Rahul Patel');
  assert.equal(ok.user.registerId, 'IND-RP-001');
  assert.ok(!('pwHash' in ok.user));
  await rejects(s.call(null, 'auth.login', { branchCode: 'INDORE', identifier: 'indore.accountant', password: 'wrong' }), 'UNAUTHENTICATED');
  // right password, but the user belongs to another branch
  await rejects(s.call(null, 'auth.login', { branchCode: 'NAGPUR', identifier: 'indore.accountant', password: 'Ravi@1234' }), 'UNAUTHENTICATED');
  // super admin may sign in under any branch
  const sa = await s.call(null, 'auth.login', { branchCode: 'NAGPUR', identifier: 'admin', password: 'Admin@1234' });
  assert.equal(sa.user.role, 'SUPER_ADMIN');
  for (let i = 0; i < 5; i++) await s.call(null, 'auth.login', { branchCode: 'MAIN', identifier: 'main.accountant', password: 'bad' }).catch(() => {});
  await rejects(s.call(null, 'auth.login', { branchCode: 'MAIN', identifier: 'main.accountant', password: 'Ravi@1234' }), 'RATE_LIMIT');
  await rejects(s.call('not-a-token', 'vouchers.list', {}), 'UNAUTHENTICATED');
});

test('voucher numbers are unique and gapless under heavy concurrency', async () => {
  const s = await fresh();
  const before = await s.load();
  const startP = before.counters.PAYMENT, startR = before.counters.RECEIPT;
  const tokens = [await login(s, 'MAIN', 'main.accountant'), await login(s, 'INDORE', 'indore.accountant'), await login(s, 'NAGPUR', 'nagpur.accountant'), await login(s, 'INDORE', 'neha.joshi')];
  const jobs = [];
  for (let i = 0; i < 60; i++) {
    const type = i % 3 === 0 ? 'RECEIPT' : 'PAYMENT';
    jobs.push(s.call(tokens[i % 4], 'vouchers.create', { type, partyName: 'Party ' + i, particulars: 'Concurrent test ' + i, amount: String(100 + i) }));
  }
  const res = await Promise.all(jobs);
  const nums = res.map((r) => r.voucher.number);
  assert.equal(new Set(nums).size, 60, 'duplicate numbers!');
  const pay = nums.filter((n) => n.startsWith('CPV-')).map((n) => +n.slice(4)).sort((a, b) => a - b);
  const rec = nums.filter((n) => n.startsWith('CRV-')).map((n) => +n.slice(4)).sort((a, b) => a - b);
  assert.deepEqual(pay, Array.from({ length: pay.length }, (_, i) => startP + 1 + i));
  assert.deepEqual(rec, Array.from({ length: rec.length }, (_, i) => startR + 1 + i));
  const all = (await s.load()).vouchers.map((v) => v.number);
  assert.equal(new Set(all).size, all.length);
});

test('create validation and ownership come from the server, not the client', async () => {
  const s = await fresh();
  const t = await login(s, 'INDORE', 'indore.accountant');
  await rejects(s.call(t, 'vouchers.create', Object.assign({}, PAY, { amount: '0' })), 'VALIDATION');
  await rejects(s.call(t, 'vouchers.create', Object.assign({}, PAY, { amount: '-5' })), 'VALIDATION');
  await rejects(s.call(t, 'vouchers.create', Object.assign({}, PAY, { amount: '10.999' })), 'VALIDATION');
  await rejects(s.call(t, 'vouchers.create', Object.assign({}, PAY, { amount: '99999999999' })), 'VALIDATION');
  await rejects(s.call(t, 'vouchers.create', Object.assign({}, PAY, { partyName: ' ' })), 'VALIDATION');
  await rejects(s.call(t, 'vouchers.create', Object.assign({}, PAY, { particulars: '' })), 'VALIDATION');
  await rejects(s.call(t, 'vouchers.create', Object.assign({}, PAY, { type: 'TRANSFER' })), 'VALIDATION');
  await rejects(s.call(t, 'vouchers.create', Object.assign({}, PAY, { date: RW.addDays(RW.today(), 1) })), 'VALIDATION');
  await rejects(s.call(t, 'vouchers.create', Object.assign({}, PAY, { date: RW.addDays(RW.today(), -30) })), 'VALIDATION');
  await rejects(s.call(t, 'vouchers.create', Object.assign({}, PAY, { date: '2026-02-30' })), 'VALIDATION');
  // A hostile client tries to choose a different branch/user/number — those fields are ignored.
  const r = await s.call(t, 'vouchers.create', Object.assign({}, PAY, { branchId: 'br_nagpur', userId: 'u_nagpur', number: 'CPV-000001', amountInWords: 'Free' }));
  assert.equal(r.voucher.branchId, 'br_indore');
  assert.equal(r.voucher.userId, 'u_indore');
  assert.notEqual(r.voucher.number, 'CPV-000001');
  assert.equal(r.voucher.amountInWords, 'Rupees One Thousand Only');
  assert.equal(r.voucher.locked, true);
  // attachments
  await rejects(s.call(t, 'vouchers.create', Object.assign({}, PAY, { attachments: [{ name: 'x.exe', dataUrl: 'data:application/x-msdownload;base64,AAAA' }] })), 'VALIDATION');
  const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
  const withAtt = await s.call(t, 'vouchers.create', Object.assign({}, PAY, { attachments: [{ name: 'r.png', dataUrl: png }] }));
  assert.equal(withAtt.voucher.attachmentCount, 1);
  const det = await s.call(t, 'vouchers.get', { id: withAtt.voucher.id });
  const blob = await s.call(t, 'attachments.get', { id: det.attachments[0].id });
  assert.equal(blob.dataUrl, png);
});

test('offline retry is idempotent (same clientId never creates a second voucher)', async () => {
  const s = await fresh();
  const t = await login(s, 'MAIN', 'main.accountant');
  const before = (await s.load()).counters.PAYMENT;
  const a = await s.call(t, 'vouchers.create', Object.assign({ clientId: 'draft-abc' }, PAY));
  const b = await s.call(t, 'vouchers.create', Object.assign({ clientId: 'draft-abc' }, PAY));
  assert.equal(a.voucher.id, b.voucher.id);
  assert.equal(b.duplicate, true);
  assert.equal((await s.load()).counters.PAYMENT, before + 1);
  // parallel duplicates too
  const [x, y] = await Promise.all([1, 2].map(() => s.call(t, 'vouchers.create', Object.assign({ clientId: 'draft-par' }, PAY))));
  assert.equal(x.voucher.id, y.voucher.id);
});

test('voucher lock: normal users cannot edit, void or delete', async () => {
  const s = await fresh();
  const t = await login(s, 'INDORE', 'indore.accountant');
  const { voucher } = await s.call(t, 'vouchers.create', PAY);
  await rejects(s.call(t, 'vouchers.edit', { id: voucher.id, patch: { amount: '1' }, reason: 'sneaky change' }), 'FORBIDDEN');
  await rejects(s.call(t, 'vouchers.void', { id: voucher.id, reason: 'sneaky void' }), 'FORBIDDEN');
  await rejects(s.call(t, 'vouchers.delete', { id: voucher.id, reason: 'sneaky delete' }), 'FORBIDDEN');
  await rejects(s.call(t, 'audit.list', {}), 'FORBIDDEN');
  await rejects(s.call(t, 'users.list', {}), 'FORBIDDEN');
  await rejects(s.call(t, 'settings.update', { fiscalYearStartMonth: 1 }), 'FORBIDDEN');
  const got = await s.call(t, 'vouchers.get', { id: voucher.id });
  assert.equal(got.voucher.amountPaise, 100000);
  assert.equal(got.canAdmin, false);
});

test('data isolation between users and branches (also via direct API parameters)', async () => {
  const s = await fresh();
  const rahul = await login(s, 'INDORE', 'indore.accountant');
  const neha = await login(s, 'INDORE', 'neha.joshi');
  const amit = await login(s, 'NAGPUR', 'nagpur.accountant');
  const raw = await s.load();
  const amitV = raw.vouchers.find((v) => v.userId === 'u_nagpur' && v.status === 'ACTIVE');
  const nehaV = raw.vouchers.find((v) => v.userId === 'u_neha' && v.attachmentIds.length) || raw.vouchers.find((v) => v.userId === 'u_neha');
  // fetching another branch's / user's voucher by id or number
  await rejects(s.call(rahul, 'vouchers.get', { id: amitV.id }), 'NOT_FOUND');
  await rejects(s.call(rahul, 'vouchers.get', { number: amitV.number }), 'NOT_FOUND');
  await rejects(s.call(rahul, 'vouchers.get', { id: nehaV.id }), 'NOT_FOUND'); // same branch, different user
  // list with a hostile filter still only returns own rows
  const l1 = await s.call(rahul, 'vouchers.list', { filters: { userId: 'u_nagpur', branchId: 'br_nagpur' }, pageSize: 200 });
  assert.equal(l1.total, 0);
  const l2 = await s.call(rahul, 'vouchers.list', { filters: {}, pageSize: 200 });
  assert.ok(l2.total > 20);
  assert.ok(l2.rows.every((v) => v.userId === 'u_indore'));
  // registers, statements, reports, search
  await rejects(s.call(rahul, 'register.get', { userId: 'u_neha' }), 'NOT_FOUND');
  await rejects(s.call(rahul, 'statements.generate', { userId: 'u_nagpur', period: 'MONTH' }), 'NOT_FOUND');
  await rejects(s.call(rahul, 'reports.user', { userId: 'u_neha', preset: 'month' }), 'FORBIDDEN');
  await rejects(s.call(rahul, 'reports.branches', { preset: 'month' }), 'FORBIDDEN');
  await rejects(s.call(rahul, 'outstanding.list', {}), 'FORBIDDEN');
  await rejects(s.call(rahul, 'export.vouchers', {}), 'FORBIDDEN');
  assert.equal((await s.call(rahul, 'registers.list', {})).rows.length, 1);
  const srch = await s.call(rahul, 'search.global', { q: amitV.number });
  assert.equal(srch.exact, null);
  assert.equal(srch.vouchers.length, 0);
  const srch2 = await s.call(rahul, 'search.global', { q: 'Amit' });
  assert.equal(srch2.users.length, 0);
  // attachments
  const withAtt = raw.attachments[0];
  if (withAtt) {
    const owner = raw.users.find((u) => u.id === withAtt.userId);
    const other = owner.id === 'u_nagpur' ? rahul : amit;
    await rejects(s.call(other, 'attachments.get', { id: withAtt.id }), 'NOT_FOUND');
  }
  await rejects(s.call(rahul, 'vouchers.addAttachment', { voucherId: nehaV.id, attachment: { name: 'a.png', dataUrl: 'data:image/png;base64,AAAA' } }), 'NOT_FOUND');
  // dashboards only count the user's own cash
  const dash = await s.call(neha, 'dashboard.get', {});
  assert.equal(dash.level, 'SELF');
  assert.ok(dash.recent.every((v) => v.userId === 'u_neha'));
  // notifications: a normal user never sees admin notifications
  const n = await s.call(rahul, 'notifications.list', {});
  assert.ok(n.rows.every((x) => /corrected|voided/i.test(x.title)));
});

test('branch admin sees only own branch; viewer is read-only; super admin sees everything', async () => {
  const s = await fresh();
  const bm = await login(s, 'INDORE', 'indore.manager');
  const viewer = await login(s, 'NAGPUR', 'nagpur.auditor');
  const sa = await login(s, 'MAIN', 'admin', 'Admin@1234');
  const raw = await s.load();
  const mainV = raw.vouchers.find((v) => v.branchId === 'br_main' && v.status === 'ACTIVE');
  const indV = raw.vouchers.find((v) => v.branchId === 'br_indore' && v.userId === 'u_neha' && v.status === 'ACTIVE');
  const l = await s.call(bm, 'vouchers.list', { pageSize: 200 });
  assert.ok(l.rows.every((v) => v.branchId === 'br_indore'));
  assert.ok(new Set(l.rows.map((v) => v.userId)).size >= 2);
  await rejects(s.call(bm, 'vouchers.get', { id: mainV.id }), 'NOT_FOUND');
  await rejects(s.call(bm, 'vouchers.edit', { id: mainV.id, patch: { amount: '5' }, reason: 'cross-branch edit' }), 'FORBIDDEN'); // branch admins cannot edit at all
  await rejects(s.call(bm, 'vouchers.delete', { id: indV.id, reason: 'branch admin cannot delete' }), 'FORBIDDEN');
  await rejects(s.call(bm, 'branches.create', { name: 'Evil Branch' }), 'FORBIDDEN');
  await rejects(s.call(bm, 'users.create', { fullName: 'New Boss', username: 'newboss', email: 'nb@x.com', role: 'SUPER_ADMIN', password: 'Passw0rd1' }), 'FORBIDDEN');
  const bu = await s.call(bm, 'users.list', {});
  assert.ok(bu.rows.every((u) => u.branchId === 'br_indore'));
  const br = await s.call(bm, 'branches.list', {});
  assert.equal(br.rows.length, 1);
  await rejects(s.call(bm, 'vouchers.edit', { id: indV.id, patch: { particulars: 'Corrected narration text' }, reason: 'Fix narration typo' }), 'FORBIDDEN');
  await rejects(s.call(bm, 'vouchers.void', { id: indV.id, reason: 'branch admin cannot void' }), 'FORBIDDEN');
  const ed = await s.call(sa, 'vouchers.edit', { id: indV.id, patch: { particulars: 'Corrected narration text' }, reason: 'Fix narration typo' });
  assert.equal(ed.voucher.particulars, 'Corrected narration text');
  const au = await s.call(bm, 'audit.list', { pageSize: 200 });
  assert.ok(au.rows.every((a) => a.branchId === 'br_indore'));
  // viewer
  const vl = await s.call(viewer, 'vouchers.list', { pageSize: 200 });
  assert.ok(vl.rows.every((v) => v.branchId === 'br_nagpur'));
  await rejects(s.call(viewer, 'vouchers.create', PAY), 'FORBIDDEN');
  await rejects(s.call(viewer, 'vouchers.edit', { id: vl.rows[0].id, patch: { amount: '1' }, reason: 'viewer edit' }), 'FORBIDDEN');
  await rejects(s.call(viewer, 'export.vouchers', {}), 'FORBIDDEN');
  assert.equal((await s.call(viewer, 'registers.list', {})).rows.every((r) => r.branchId === 'br_nagpur'), true);
  const stmt = await s.call(viewer, 'statements.generate', { userId: 'u_nagpur', period: 'MONTH' });
  assert.equal(stmt.user.fullName, 'Amit Deshmukh');
  await rejects(s.call(viewer, 'statements.generate', { userId: 'u_indore', period: 'MONTH' }), 'NOT_FOUND');
  // super admin
  const all = await s.call(sa, 'vouchers.list', { pageSize: 200 });
  assert.equal(new Set(all.rows.map((v) => v.branchId)).size, 3);
});

test('admin edit / void / delete write complete audit trail and keep numbers', async () => {
  const s = await fresh();
  const user = await login(s, 'INDORE', 'neha.joshi');
  const sa = await login(s, 'MAIN', 'admin', 'Admin@1234');
  const { voucher } = await s.call(user, 'vouchers.create', { type: 'PAYMENT', partyName: 'Old Party', particulars: 'Old particulars', amount: '5000' });
  await rejects(s.call(sa, 'vouchers.edit', { id: voucher.id, patch: { amount: '5500' } }), 'VALIDATION'); // reason required
  await rejects(s.call(sa, 'vouchers.edit', { id: voucher.id, patch: {}, reason: 'nothing changes here' }), 'VALIDATION');
  const e = await s.call(sa, 'vouchers.edit', { id: voucher.id, patch: { amount: '5500', partyName: 'New Party' }, reason: 'Corrected as per bill' });
  assert.equal(e.voucher.number, voucher.number);
  assert.equal(e.voucher.amountInWords, 'Rupees Five Thousand Five Hundred Only');
  assert.equal(e.voucher.version, 2);
  let d = await s.call(sa, 'vouchers.get', { id: voucher.id });
  const edit = d.timeline.find((t) => t.action === 'EDIT');
  assert.deepEqual(edit.old, { amount: 5000, partyName: 'Old Party' });
  assert.deepEqual(edit.new, { amount: 5500, partyName: 'New Party' });
  assert.equal(edit.reason, 'Corrected as per bill');
  assert.equal(edit.by, 'Super Admin');
  // the owner sees the timeline entry but not the old/new values
  d = await s.call(user, 'vouchers.get', { id: voucher.id });
  assert.ok(d.timeline.some((t) => t.action === 'EDIT'));
  assert.equal(d.timeline.find((t) => t.action === 'EDIT').old, null);
  // void removes it from cash balance; owner is notified
  const balBefore = (await s.call(user, 'auth.me', {})).register.balancePaise;
  await s.call(sa, 'vouchers.void', { id: voucher.id, reason: 'Entered by mistake' });
  const balAfter = (await s.call(user, 'auth.me', {})).register.balancePaise;
  assert.equal(balAfter - balBefore, 550000);
  await rejects(s.call(sa, 'vouchers.edit', { id: voucher.id, patch: { amount: '1' }, reason: 'edit after void' }), 'LOCKED');
  const note = await s.call(user, 'notifications.list', {});
  assert.ok(note.rows.some((n) => /voided/i.test(n.title)));
  // delete = soft delete, visible to super admin audit only
  await s.call(sa, 'vouchers.delete', { id: voucher.id, reason: 'Removed after audit review' });
  await rejects(s.call(user, 'vouchers.get', { id: voucher.id }), 'NOT_FOUND');
  const raw = await s.load();
  assert.ok(raw.vouchers.find((v) => v.id === voucher.id), 'record is retained');
  const au = await s.call(sa, 'audit.list', { filters: { q: voucher.number }, pageSize: 50 });
  assert.deepEqual(au.rows.map((a) => a.action).reverse().filter((x, i, a) => a.indexOf(x) === i), ['CREATE', 'EDIT', 'VOID', 'DELETE']);
  // numbers are never reused
  const next = await s.call(user, 'vouchers.create', PAY);
  assert.ok(+next.voucher.number.slice(4) > +voucher.number.slice(4));
});

test('audit hash chain verifies and detects tampering', async () => {
  const s = await fresh();
  const sa = await login(s, 'MAIN', 'admin', 'Admin@1234');
  const ok = await s.call(sa, 'audit.verify', {});
  assert.equal(ok.ok, true);
  assert.ok(ok.count > 100);
  const raw = await s.load();
  raw.audit[40].new = { amount: 1 };
  await s.replaceState(raw);
  const bad = await s.call(sa, 'audit.verify', {});
  assert.equal(bad.ok, false);
  assert.equal(bad.brokenAt, raw.audit[40].seq);
});

test('cash register maths: opening + inflow - outflow = closing (running balance)', async () => {
  const s = await fresh({ adminActions: false });
  // brand-new branch user with the spec example: opening 50,000, payment 5,000 -> 45,000
  const sa = await login(s, 'MAIN', 'admin', 'Admin@1234');
  const created = await s.call(sa, 'users.create', { fullName: 'Test Cashier', username: 'test.cashier', email: 'tc@example.com', branchId: 'br_nagpur', role: 'USER', password: 'Passw0rd1' });
  await s.call(sa, 'registers.setOpening', { userId: created.user.id, amount: '50000', reason: 'Opening cash handed over' });
  const t = await login(s, 'NAGPUR', 'test.cashier', 'Passw0rd1');
  await s.call(t, 'vouchers.create', { type: 'PAYMENT', partyName: 'Vendor', particulars: 'Spare parts', amount: '5000' });
  let me = await s.call(t, 'auth.me', {});
  assert.equal(me.register.balancePaise, 4500000);
  await s.call(t, 'vouchers.create', { type: 'RECEIPT', partyName: 'Customer', particulars: 'Cash sale', amount: '12500.50' });
  const reg = await s.call(t, 'register.get', { from: RW.addDays(RW.today(), -30), to: RW.today() });
  assert.equal(reg.openingPaise, 5000000);
  assert.equal(reg.inPaise, 1250050);
  assert.equal(reg.outPaise, 500000);
  assert.equal(reg.closingPaise, 5000000 + 1250050 - 500000);
  assert.equal(reg.rows[0].balancePaise, 4500000);
  assert.equal(reg.rows[1].balancePaise, 5750050);
  assert.equal(reg.register.id, 'NAG-TC-001');
  // statement for a period starting in the future-of-vouchers carries the balance forward
  const stm = await s.call(t, 'statements.generate', { period: 'CUSTOM', from: RW.addDays(RW.today(), -10), to: RW.addDays(RW.today(), -5) });
  assert.equal(stm.openingPaise, 5000000);
  assert.equal(stm.closingPaise, 5000000);
  assert.equal(stm.count, 0);
});

test('seeded registers reconcile: every register closing equals opening + net, running balances never negative', async () => {
  const s = await fresh();
  const raw = await s.load();
  for (const r of raw.registers) {
    const mine = raw.vouchers.filter((v) => v.userId === r.userId && v.status === 'ACTIVE');
    const net = mine.reduce((a, v) => a + (v.type === 'RECEIPT' ? v.amountPaise : -v.amountPaise), 0);
    const t = (await s.call(await login(s, 'MAIN', 'admin', 'Admin@1234'), 'register.get', { userId: r.userId, from: '2000-01-01', to: RW.today() }));
    assert.equal(t.closingPaise, r.openingPaise + net, r.id);
    assert.equal(t.currentBalancePaise, r.openingPaise + net);
    // chronological running balance is consistent row to row
    let run = t.openingPaise;
    for (const row of t.rows) { run += row.inPaise - row.outPaise; assert.equal(row.balancePaise, run); }
  }
});

test('statement: weekly/monthly/yearly periods, identity block and notification', async () => {
  const s = await fresh();
  const t = await login(s, 'INDORE', 'indore.accountant');
  const m = await s.call(t, 'statements.generate', { period: 'MONTH' });
  assert.equal(m.user.fullName, 'Rahul Patel');
  assert.equal(m.register.id, 'IND-RP-001');
  assert.equal(m.branch.name, 'Ravi Water Flow Pump - Indore');
  assert.equal(m.period.from, RW.startOfMonth(RW.today()));
  assert.equal(m.closingPaise, m.openingPaise + m.inPaise - m.outPaise);
  assert.equal(m.count, m.rows.length);
  const y = await s.call(t, 'statements.generate', { period: 'YEAR' });
  assert.match(y.period.label, /Financial Year 20\d\d-\d\d/);
  assert.equal(y.period.from.slice(5), '04-01');
  const w = await s.call(t, 'statements.generate', { period: 'WEEK' });
  assert.equal(RW.dow(w.period.from), 1);
  await rejects(s.call(t, 'statements.generate', { period: 'CUSTOM', from: '2026-10-10', to: '2026-10-01' }), 'VALIDATION');
  const hist = await s.call(t, 'statements.history', {});
  assert.equal(hist.rows.length, 3);
  const sa = await login(s, 'MAIN', 'admin', 'Admin@1234');
  const notes = await s.call(sa, 'notifications.list', {});
  assert.ok(notes.rows.some((n) => /statement generated/i.test(n.title)));
});

test('user management: roles, immediate deactivation, last super admin guard', async () => {
  const s = await fresh();
  const sa = await login(s, 'MAIN', 'admin', 'Admin@1234');
  const bm = await login(s, 'INDORE', 'indore.manager');
  // branch admin has NO user-management rights at all — only the main admin (Super Admin) manages users
  const NEWU = { fullName: 'Deepak Verma', username: 'deepak.v', email: 'dv@example.com', branchId: 'br_indore', role: 'USER' };
  await rejects(s.call(bm, 'users.create', NEWU), 'FORBIDDEN');
  await rejects(s.call(bm, 'users.update', { id: 'u_neha', role: 'VIEWER' }), 'FORBIDDEN');
  await rejects(s.call(bm, 'users.setStatus', { id: 'u_neha', status: 'INACTIVE' }), 'FORBIDDEN');
  await rejects(s.call(bm, 'users.resetPassword', { id: 'u_neha' }), 'FORBIDDEN');
  await rejects(s.call(bm, 'users.setStatus', { id: 'u_nagpur', status: 'INACTIVE' }), 'FORBIDDEN');
  await rejects(s.call(bm, 'users.setStatus', { id: 'u_admin', status: 'INACTIVE' }), 'FORBIDDEN');
  assert.ok((await s.call(bm, 'users.list', {})).rows.every((u) => u.branchId === 'br_indore'), 'branch admin can still SEE their own branch users');
  // the Super Admin creates the user in the branch they choose
  const c = await s.call(sa, 'users.create', Object.assign({}, NEWU, { branchId: 'br_nagpur' }));
  assert.equal(c.user.branchId, 'br_nagpur');
  assert.ok(c.tempPassword && c.tempPassword.length >= 10);
  assert.equal(c.user.mustChangePassword, true);
  await rejects(s.call(sa, 'users.create', { fullName: 'Dup', username: 'deepak.v', email: 'other@example.com', branchId: 'br_nagpur' }), 'CONFLICT');
  await rejects(s.call(sa, 'users.create', { fullName: 'Weak', username: 'weak.pw', email: 'w@example.com', branchId: 'br_nagpur', password: 'abc' }), 'VALIDATION');
  // new user signs in, then is suspended: the existing token dies at once
  const tok = await login(s, 'NAGPUR', 'deepak.v', c.tempPassword);
  await s.call(tok, 'vouchers.list', {});
  await s.call(sa, 'users.setStatus', { id: c.user.id, status: 'SUSPENDED' });
  await rejects(s.call(tok, 'vouchers.list', {}), 'UNAUTHENTICATED');
  await rejects(s.call(null, 'auth.login', { branchCode: 'NAGPUR', identifier: 'deepak.v', password: c.tempPassword }), 'ACCOUNT_DISABLED');
  // reset password logs the user out
  const rp = await s.call(sa, 'users.resetPassword', { id: 'u_indore' });
  assert.ok(rp.tempPassword);
  // last super admin can never be disabled, demoted or deleted
  await rejects(s.call(sa, 'users.setStatus', { id: 'u_admin', status: 'INACTIVE' }), 'VALIDATION');
  await rejects(s.call(sa, 'users.delete', { id: 'u_admin', reason: 'cleanup account' }), 'VALIDATION');
  // role change forces re-login
  await s.call(sa, 'users.update', { id: 'u_neha', role: 'VIEWER' });
  await rejects(s.call(sa, 'users.update', { id: 'u_admin', role: 'USER' }), 'VALIDATION');
  // soft delete keeps history
  await s.call(sa, 'users.delete', { id: 'u_nagpur', reason: 'Left the company' });
  const raw = await s.load();
  assert.ok(raw.vouchers.some((v) => v.userId === 'u_nagpur'));
  await rejects(s.call(null, 'auth.login', { branchCode: 'NAGPUR', identifier: 'nagpur.accountant', password: 'Ravi@1234' }), 'UNAUTHENTICATED');
  // disabling a branch blocks its users
  const ind = await login(s, 'INDORE', 'neha.joshi');
  await s.call(sa, 'branches.setStatus', { id: 'br_indore', status: 'DISABLED' });
  await rejects(s.call(ind, 'vouchers.list', {}), 'UNAUTHENTICATED');
});

test('branches: unique generated codes and register prefixes', async () => {
  const s = await fresh();
  const sa = await login(s, 'MAIN', 'admin', 'Admin@1234');
  const a = await s.call(sa, 'branches.create', { name: 'Ravi Water Flow Pump - Surat', address: 'Ring Road, Surat', contact: '+91 261 000 0000' });
  const b = await s.call(sa, 'branches.create', { name: 'Ravi Water Flow Pump - Surat', address: 'Another', contact: '-' });
  assert.equal(a.branch.code, 'SURAT');
  assert.notEqual(b.branch.code, a.branch.code);
  await rejects(s.call(sa, 'branches.create', { name: 'Clash', code: 'SURAT' }), 'CONFLICT');
  const u = await s.call(sa, 'users.create', { fullName: 'Hiral Shah', username: 'hiral', email: 'hs@example.com', branchId: a.branch.id, role: 'USER', password: 'Passw0rd1' });
  assert.equal(u.user.registerId, 'SUR-HS-001');
  const pub = await s.call(null, 'branches.public', {});
  assert.equal(pub.branches.length, 5);
});

test('settings: numbering can only move forward; counters never repeat', async () => {
  const s = await fresh();
  const sa = await login(s, 'MAIN', 'admin', 'Admin@1234');
  const cur = (await s.load()).counters.PAYMENT;
  await rejects(s.call(sa, 'settings.update', { advanceCounter: { type: 'PAYMENT', to: cur - 1 } }), 'VALIDATION');
  await s.call(sa, 'settings.update', { advanceCounter: { type: 'PAYMENT', to: cur + 99 } });
  const t = await login(s, 'MAIN', 'main.accountant');
  const v = await s.call(t, 'vouchers.create', PAY);
  assert.equal(v.voucher.number, 'CPV-' + String(cur + 100).padStart(6, '0'));
  await rejects(s.call(sa, 'settings.update', { numbering: { PAYMENT: { prefix: 'XX', pad: 6 }, RECEIPT: { prefix: 'XX', pad: 6 } } }), 'VALIDATION');
});

test('outstanding: summary cards, partial settlement, voucher link rules', async () => {
  const s = await fresh();
  const sa = await login(s, 'MAIN', 'admin', 'Admin@1234');
  const bm = await login(s, 'INDORE', 'indore.manager');
  const all = await s.call(sa, 'outstanding.list', {});
  assert.ok(all.summary.total.totalPaise > 0);
  assert.ok(all.summary.overdue.count >= 3);
  assert.ok(all.summary.dueWeek.count >= 1);
  assert.equal(all.summary.total.totalPaise, all.summary.total.receivablePaise + all.summary.total.payablePaise);
  assert.equal(all.summary.byBranch.reduce((a, b) => a + b.totalPaise, 0), all.summary.total.totalPaise);
  const mine = await s.call(bm, 'outstanding.list', {});
  assert.ok(mine.rows.every((r) => r.branchId === 'br_indore'));
  const rec = mine.rows.find((r) => r.direction === 'RECEIVABLE');
  // a branch admin can read the list but cannot settle / create / change / cancel anything
  for (const [m, a] of [['outstanding.settle', { id: rec.id, amount: '1' }], ['outstanding.cancel', { id: rec.id, reason: 'branch admin cannot cancel' }],
    ['outstanding.update', { id: rec.id, notes: 'x' }], ['outstanding.create', { direction: 'RECEIVABLE', party: 'X', amount: '10' }]]) await rejects(s.call(bm, m, a), 'FORBIDDEN');
  assert.equal((await s.call(sa, 'outstanding.list', {})).rows.find((r) => r.id === rec.id).balancePaise, rec.balancePaise, 'refused calls changed nothing');
  await rejects(s.call(sa, 'outstanding.settle', { id: rec.id, amount: String(rec.balancePaise / 100 + 1) }), 'VALIDATION');
  const part = await s.call(sa, 'outstanding.settle', { id: rec.id, amount: '1000' });
  assert.equal(part.item.balancePaise, rec.balancePaise - 100000);
  const full = await s.call(sa, 'outstanding.settle', { id: rec.id, amount: String(part.item.balancePaise / 100) });
  assert.equal(full.item.status, 'SETTLED');
  await rejects(s.call(sa, 'outstanding.settle', { id: rec.id, amount: '1' }), 'LOCKED');
  const payable = mine.rows.find((r) => r.direction === 'PAYABLE');
  const raw = await s.load();
  const recVoucher = raw.vouchers.find((v) => v.branchId === 'br_indore' && v.type === 'RECEIPT' && v.status === 'ACTIVE');
  await rejects(s.call(sa, 'outstanding.settle', { id: payable.id, amount: '10', voucherNumber: recVoucher.number }), 'VALIDATION');
});

test('dashboards: totals agree with voucher data; export is filtered and audited', async () => {
  const s = await fresh();
  const sa = await login(s, 'MAIN', 'admin', 'Admin@1234');
  const raw = await s.load();
  const today = RW.today();
  const d = await s.call(sa, 'dashboard.get', { range: 'month' });
  const from = RW.startOfMonth(today);
  const inM = raw.vouchers.filter((v) => v.status === 'ACTIVE' && v.type === 'RECEIPT' && v.date >= from).reduce((a, v) => a + v.amountPaise, 0);
  const outM = raw.vouchers.filter((v) => v.status === 'ACTIVE' && v.type === 'PAYMENT' && v.date >= from).reduce((a, v) => a + v.amountPaise, 0);
  assert.equal(d.kpis.inPaise, inM);
  assert.equal(d.kpis.outPaise, outM);
  assert.equal(d.kpis.netPaise, inM - outM);
  assert.equal(d.kpis.activeBranches, 3);
  assert.equal(d.branches.reduce((a, b) => a + b.inPaise, 0), inM);
  assert.equal(d.charts.daily14.length, 14);
  assert.equal(d.charts.monthly12.length, 12);
  assert.equal(d.charts.balanceTrend30.length, 30);
  // balance trend ends at the true cash in hand
  const opening = raw.registers.reduce((a, r) => a + r.openingPaise, 0);
  const net = raw.vouchers.filter((v) => v.status === 'ACTIVE').reduce((a, v) => a + (v.type === 'RECEIPT' ? v.amountPaise : -v.amountPaise), 0);
  assert.equal(d.charts.balanceTrend30[29].balancePaise, opening + net);
  assert.equal(d.kpis.balancePaise, opening + net);
  // export applies filters first
  const ex = await s.call(sa, 'export.vouchers', { filters: { branchId: 'br_indore', userId: 'u_indore', type: 'PAYMENT', from: RW.startOfMonth(RW.addDays(today, -30)), to: today } });
  assert.ok(ex.rows.length > 0);
  assert.ok(ex.rows.every((r) => r.branch === 'Ravi Water Flow Pump - Indore' && r.user === 'Rahul Patel' && r.type === 'Cash Payment' && r.cashOut > 0));
  const au = await s.call(sa, 'audit.list', { filters: { entity: 'EXPORT' } });
  assert.equal(au.rows.length, 1);
  // user-wise report
  const ur = await s.call(sa, 'reports.user', { userId: 'u_neha', preset: 'year' });
  assert.equal(ur.user.fullName, 'Neha Joshi');
  assert.equal(ur.netPaise, ur.inPaise - ur.outPaise);
  const br = await s.call(sa, 'reports.branches', { preset: 'year' });
  assert.equal(br.rows.length, 3);
  assert.equal(br.series[0].inPaise.length, 12);
});

test('export: voided vouchers keep their amount but never count towards cash in / cash out', async () => {
  const s = await fresh();
  const sa = await login(s, 'MAIN', 'admin', 'Admin@1234');
  const raw = await s.load();
  const v = raw.vouchers.find((x) => x.status === 'ACTIVE' && x.type === 'PAYMENT');
  await s.call(sa, 'vouchers.void', { id: v.id, reason: 'Entered twice by mistake' });
  const ex = await s.call(sa, 'export.vouchers', {});
  const row = ex.rows.find((r) => r.number === v.number);
  assert.equal(row.status, 'VOID');
  assert.equal(row.cashOut, null);
  assert.equal(row.cashIn, null);
  assert.equal(row.amount, v.amountPaise / 100);
  const sumIn = ex.rows.reduce((a, r) => a + Math.round((r.cashIn || 0) * 100), 0);
  const sumOut = ex.rows.reduce((a, r) => a + Math.round((r.cashOut || 0) * 100), 0);
  assert.equal(sumIn, ex.totals.inPaise);
  assert.equal(sumOut, ex.totals.outPaise);
});

test('first-run setup: creates branch + super admin exactly once, then is closed', async () => {
  const server = RW.createServer({ storage: new RW.MemoryStorage(), hashIterations: 1000 });
  assert.equal((await server.call(null, 'branches.public', {})).empty, true);
  await rejects(server.call(null, 'system.setup', { branchName: 'Rajkot', fullName: 'Owner One', email: 'o@x.com', username: 'owner', password: 'short' }), 'VALIDATION');
  const r = await server.call(null, 'system.setup', { companyName: 'Ravi Water Flow Pump', branchName: 'Ravi Water Flow Pump - Rajkot', branchCode: 'rajkot', fullName: 'Owner One', email: 'owner@example.com', username: 'Owner', password: 'Strong#2026' });
  assert.equal(r.user.role, 'SUPER_ADMIN');
  assert.equal(r.branch.code, 'RAJKOT');
  assert.equal(r.user.registerId, 'RAJ-OO-001');
  const me = await server.call(r.token, 'auth.me', {});
  assert.equal(me.user.username, 'owner');
  assert.equal((await server.call(null, 'branches.public', {})).empty, false);
  // closed for good - also for a second racing request
  await rejects(server.call(null, 'system.setup', { branchName: 'Evil Branch', fullName: 'Mallory Two', email: 'm@x.com', username: 'mallory', password: 'Strong#2026' }), 'FORBIDDEN');
  // the setup is audited and the owner can sign in normally
  const lg = await server.call(null, 'auth.login', { branchCode: 'RAJKOT', identifier: 'owner', password: 'Strong#2026' });
  const au = await server.call(lg.token, 'audit.list', { filters: {} });
  assert.ok(au.rows.some((x) => x.entityLabel === 'First-time setup'));
  assert.equal((await server.call(lg.token, 'audit.verify', {})).ok, true);
});

test('global search finds a voucher by number in any common spelling', async () => {
  const s = await fresh();
  const sa = await login(s, 'MAIN', 'admin', 'Admin@1234');
  const raw = await s.load();
  const v = raw.vouchers[40];
  for (const q of [v.number, v.number.toLowerCase(), v.number.replace('-', ''), v.number.replace(/-0+/, '-')]) {
    const r = await s.call(sa, 'search.global', { q });
    assert.equal(r.exact && r.exact.id, v.id, q);
  }
  const byParty = await s.call(sa, 'search.global', { q: v.partyName.slice(0, 8) });
  assert.ok(byParty.vouchers.length > 0);
  const byAmt = await s.call(sa, 'search.global', { q: String(v.amountPaise / 100) });
  assert.ok(byAmt.vouchers.some((x) => x.id === v.id));
});

test('pagination never returns the whole table at once', async () => {
  const s = await fresh();
  const sa = await login(s, 'MAIN', 'admin', 'Admin@1234');
  const p = await s.call(sa, 'vouchers.list', { page: 2, pageSize: 10 });
  assert.equal(p.rows.length, 10);
  assert.equal(p.page, 2);
  assert.ok(p.total > 100 && p.pages > 5);
  const big = await s.call(sa, 'vouchers.list', { pageSize: 99999 });
  assert.ok(big.rows.length <= 200);
});
