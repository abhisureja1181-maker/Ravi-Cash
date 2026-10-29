// Permanent deletion and "clear all data": who may do it, what disappears, what must survive, and that the audit chain stays valid.
const test = require('node:test');
const assert = require('node:assert/strict');
const RW = require('./load.js');

async function fresh(opts) {
  const server = RW.createServer(Object.assign({ storage: new RW.MemoryStorage(), hashIterations: 1000 }, opts || {}));
  await RW.seedDemo(server, { adminActions: true });
  return server;
}
async function login(server, branch, user, pw) {
  const r = await server.call(null, 'auth.login', { branchCode: branch, identifier: user, password: pw || 'Ravi@1234' }, { device: 'test' });
  return r.token;
}
const superLogin = (s) => login(s, 'MAIN', 'admin', 'Admin@1234');
const rejects = (p, code) => assert.rejects(p, (e) => { assert.equal(e.code, code, 'expected ' + code + ' got ' + e.code + ': ' + e.message); return true; });
const PAY = { type: 'PAYMENT', partyName: 'Erase Test Supplier', particulars: 'Pipes for the erase test', amount: '1000' };
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
const REASON = 'Entered by mistake while testing';

test('vouchers.purge: Super Admin only, needs a reason, erases the voucher + receipt photo + its effect on the register, keeps numbers moving', async () => {
  const s = await fresh();
  const sa = await superLogin(s), bm = await login(s, 'INDORE', 'indore.manager'), rahul = await login(s, 'INDORE', 'indore.accountant');
  const made = await s.call(rahul, 'vouchers.create', Object.assign({}, PAY, { attachments: [{ name: 'r.png', dataUrl: PNG }] }));
  const v = made.voucher;
  const att = (await s.call(rahul, 'vouchers.get', { id: v.id })).attachments[0];
  const balBefore = (await s.call(rahul, 'register.get', {})).currentBalancePaise;

  await rejects(s.call(bm, 'vouchers.purge', { ids: [v.id], reason: REASON }), 'FORBIDDEN');
  await rejects(s.call(rahul, 'vouchers.purge', { ids: [v.id], reason: REASON }), 'FORBIDDEN');
  await rejects(s.call(sa, 'vouchers.purge', { ids: [v.id], reason: 'no' }), 'VALIDATION');
  await rejects(s.call(sa, 'vouchers.purge', { ids: [] , reason: REASON }), 'VALIDATION');
  await rejects(s.call(sa, 'vouchers.purge', { ids: ['v_nope'], reason: REASON }), 'NOT_FOUND');
  assert.equal((await s.call(sa, 'vouchers.get', { id: v.id })).voucher.number, v.number, 'nothing was erased by the refused calls');

  const r = await s.call(sa, 'vouchers.purge', { ids: [v.id], reason: REASON });
  assert.equal(r.removed, 1);
  await rejects(s.call(sa, 'vouchers.get', { id: v.id }), 'NOT_FOUND');
  await rejects(s.call(sa, 'attachments.get', { id: att.id }), 'NOT_FOUND');
  assert.equal(await s.helpers.storage.get('att:' + att.id), null, 'the stored photo is gone too');
  const balAfter = (await s.call(rahul, 'register.get', {})).currentBalancePaise;
  assert.equal(balAfter, balBefore + 100000, 'the register no longer counts the erased payment');

  const audit = (await s.call(sa, 'audit.list', { filters: { action: 'PURGE' } })).rows;
  assert.equal(audit.length, 1);
  assert.equal(audit[0].entityLabel, v.number);
  assert.equal(audit[0].reason, REASON);
  assert.equal(audit[0].old.amount, 1000);
  assert.equal(audit[0].old.party, 'Erase Test Supplier');
  assert.equal((await s.call(sa, 'audit.verify', {})).ok, true);

  // the number is never handed out again
  const next = await s.call(rahul, 'vouchers.create', PAY);
  assert.ok(next.voucher.seq > v.seq && next.voucher.number !== v.number);
});

test('vouchers.purge: several at once (any status), all-or-nothing', async () => {
  const s = await fresh();
  const sa = await superLogin(s);
  const all = (await s.call(sa, 'vouchers.list', { filters: { status: 'DELETED' }, pageSize: 200 })).rows;
  const voids = (await s.call(sa, 'vouchers.list', { filters: { status: 'VOID' }, pageSize: 200 })).rows;
  assert.ok(voids.length >= 1);
  const active = (await s.call(sa, 'vouchers.list', { filters: { status: 'ACTIVE' }, pageSize: 5 })).rows;
  const ids = [voids[0].id].concat(active.map((x) => x.id)).concat(all.slice(0, 1).map((x) => x.id));
  const before = (await s.call(sa, 'vouchers.list', { filters: {}, pageSize: 1 })).total;
  await rejects(s.call(sa, 'vouchers.purge', { ids: ids.concat(['v_ghost']), reason: REASON }), 'NOT_FOUND');
  assert.equal((await s.call(sa, 'vouchers.list', { filters: {}, pageSize: 1 })).total, before, 'a bad id in the list erases nothing');
  const r = await s.call(sa, 'vouchers.purge', { ids, reason: REASON });
  assert.equal(r.removed, ids.length);
  for (const id of ids) await rejects(s.call(sa, 'vouchers.get', { id }), 'NOT_FOUND');
  assert.equal((await s.call(sa, 'audit.list', { filters: { action: 'PURGE' }, pageSize: 200 })).total, ids.length, 'one audit entry per erased voucher');
  assert.equal((await s.call(sa, 'audit.verify', {})).ok, true);
  await rejects(s.call(sa, 'vouchers.purge', { ids: Array.from({ length: 501 }, (_, i) => 'x' + i), reason: REASON }), 'VALIDATION');
});

test('outstanding.delete: only the main admin (Super Admin); works for settled / cancelled entries too; branch admin is refused', async () => {
  const s = await fresh();
  const sa = await superLogin(s), bm = await login(s, 'INDORE', 'indore.manager');
  const mine = (await s.call(bm, 'outstanding.list', { filters: { status: '' }, pageSize: 50 })).rows;
  assert.ok(mine.length >= 2 && mine.every((o) => o.branchId === 'br_indore'), 'branch admin can still READ their own branch');
  const all = (await s.call(sa, 'outstanding.list', { filters: { status: '' }, pageSize: 100 })).rows;
  const foreign = all.find((o) => o.branchId === 'br_nagpur');
  // Branch admin has no delete / cancel right at all
  await rejects(s.call(bm, 'outstanding.delete', { id: mine[0].id, reason: REASON }), 'FORBIDDEN');
  await rejects(s.call(bm, 'outstanding.delete', { id: foreign.id, reason: REASON }), 'FORBIDDEN');
  await rejects(s.call(bm, 'outstanding.cancel', { id: mine[1].id, reason: 'Customer disputed the invoice' }), 'FORBIDDEN');
  assert.equal((await s.call(sa, 'outstanding.list', { filters: { status: '' }, pageSize: 100 })).rows.length, all.length, 'nothing was deleted');
  // Super admin does it all
  await rejects(s.call(sa, 'outstanding.delete', { id: mine[0].id, reason: '' }), 'VALIDATION');
  await s.call(sa, 'outstanding.delete', { id: mine[0].id, reason: REASON });
  const cancelled = await s.call(sa, 'outstanding.cancel', { id: mine[1].id, reason: 'Customer disputed the invoice' });
  await s.call(sa, 'outstanding.delete', { id: cancelled.item.id, reason: REASON });
  const left = (await s.call(bm, 'outstanding.list', { filters: { status: '' }, pageSize: 50 })).rows;
  assert.equal(left.length, mine.length - 2);
  assert.equal((await s.call(sa, 'outstanding.list', { filters: { status: '' }, pageSize: 100 })).rows.length, all.length - 2, 'other branches untouched');
  const a = (await s.call(sa, 'audit.list', { filters: { entity: 'OUTSTANDING', action: 'DELETE' } })).rows;
  assert.equal(a.length, 2);
  assert.ok(a.every((x) => x.old && x.old.party && x.reason === REASON));
  await s.call(sa, 'outstanding.delete', { id: foreign.id, reason: REASON });
  assert.equal((await s.call(sa, 'audit.verify', {})).ok, true);
});

test('users.erase: removes the person with their vouchers and register; cannot erase yourself; nobody else can use it', async () => {
  const s = await fresh();
  const sa = await superLogin(s), bm = await login(s, 'INDORE', 'indore.manager'), rahul = await login(s, 'INDORE', 'indore.accountant');
  const reg = (await s.call(sa, 'users.list', { filters: {} })).rows.find((u) => u.username === 'indore.accountant');
  assert.ok(reg && reg.registerId);
  const mineBefore = (await s.call(sa, 'vouchers.list', { filters: { userId: reg.id }, pageSize: 1 })).total;
  const othersBefore = (await s.call(sa, 'vouchers.list', { filters: {}, pageSize: 1 })).total - mineBefore;
  assert.ok(mineBefore > 0);
  const pv = await s.call(sa, 'erase.preview', { userId: reg.id });
  assert.equal(pv.vouchers, mineBefore);

  await rejects(s.call(bm, 'users.erase', { id: reg.id, reason: REASON }), 'FORBIDDEN');
  await rejects(s.call(sa, 'users.erase', { id: reg.id, reason: '' }), 'VALIDATION');
  const me = (await s.call(sa, 'auth.me', {})).user;
  await rejects(s.call(sa, 'users.erase', { id: me.id, reason: REASON }), 'VALIDATION');

  const r = await s.call(sa, 'users.erase', { id: reg.id, reason: REASON });
  assert.equal(r.removed.vouchers, mineBefore);
  assert.equal((await s.call(sa, 'users.list', { filters: {} })).rows.some((u) => u.id === reg.id), false);
  assert.equal((await s.call(sa, 'vouchers.list', { filters: {}, pageSize: 1 })).total, othersBefore, 'only that user\'s vouchers went');
  await rejects(s.call(rahul, 'auth.me', {}), 'UNAUTHENTICATED');
  await rejects(login(s, 'INDORE', 'indore.accountant'), 'UNAUTHENTICATED');
  const raw = await s.raw();
  assert.equal(raw.registers.some((x) => x.userId === reg.id), false);
  assert.equal(raw.attachments.every((a) => raw.vouchers.some((v) => v.id === a.voucherId)), true, 'no photo is left without its voucher');
  // screens that mention the erased person must keep working
  await s.call(sa, 'outstanding.list', { filters: {} });
  await s.call(sa, 'dashboard.get', {});
  await s.call(sa, 'audit.list', {});
  const a = (await s.call(sa, 'audit.list', { filters: { action: 'PURGE', entity: 'USER' } })).rows;
  assert.equal(a.length, 1);
  assert.equal(a[0].old.username, 'indore.accountant');
  assert.equal((await s.call(sa, 'audit.verify', {})).ok, true);
});

test('branches.delete: removes the branch with its users, vouchers, outstanding and registers — and nothing else', async () => {
  const s = await fresh();
  const sa = await superLogin(s), bm = await login(s, 'NAGPUR', 'nagpur.accountant');
  const nag = (await s.call(sa, 'branches.list', {})).rows.find((b) => b.code === 'NAGPUR');
  const totalBefore = (await s.call(sa, 'vouchers.list', { filters: {}, pageSize: 1 })).total;
  const nagVouchers = (await s.call(sa, 'vouchers.list', { filters: { branchId: nag.id }, pageSize: 1 })).total;
  const pv = await s.call(sa, 'erase.preview', { branchId: nag.id });
  assert.equal(pv.vouchers, nagVouchers);
  assert.ok(pv.users >= 2 && pv.outstanding >= 1);

  await rejects(s.call(bm, 'branches.delete', { id: nag.id, reason: REASON, confirmCode: 'NAGPUR' }), 'FORBIDDEN');
  await rejects(s.call(sa, 'branches.delete', { id: nag.id, reason: REASON, confirmCode: 'WRONG' }), 'VALIDATION');
  await rejects(s.call(sa, 'branches.delete', { id: nag.id, reason: '', confirmCode: 'NAGPUR' }), 'VALIDATION');
  const main = (await s.call(sa, 'branches.list', {})).rows.find((b) => b.code === 'MAIN');
  await rejects(s.call(sa, 'branches.delete', { id: main.id, reason: REASON, confirmCode: 'MAIN' }), 'VALIDATION');   // holds the Super Admin

  const r = await s.call(sa, 'branches.delete', { id: nag.id, reason: REASON, confirmCode: 'nagpur' });
  assert.equal(r.removed.vouchers, nagVouchers);
  assert.equal((await s.call(sa, 'branches.list', {})).rows.some((b) => b.code === 'NAGPUR'), false);
  assert.equal((await s.call(sa, 'vouchers.list', { filters: {}, pageSize: 1 })).total, totalBefore - nagVouchers);
  await rejects(login(s, 'NAGPUR', 'nagpur.accountant'), 'UNAUTHENTICATED');
  await rejects(s.call(bm, 'auth.me', {}), 'UNAUTHENTICATED');
  const raw = await s.raw();
  assert.ok(raw.users.every((u) => u.branchId !== nag.id) && raw.outstanding.every((o) => o.branchId !== nag.id) && raw.registers.every((x) => x.branchId !== nag.id));
  assert.ok(raw.branches.length === 2);
  await s.call(sa, 'dashboard.get', {}); await s.call(sa, 'reports.branches', { preset: 'month' }); await s.call(sa, 'audit.list', {});
  assert.equal((await s.call(sa, 'audit.verify', {})).ok, true);

  // Indore can go too, but the last branch cannot be deleted
  const ind = (await s.call(sa, 'branches.list', {})).rows.find((b) => b.code === 'INDORE');
  await s.call(sa, 'branches.delete', { id: ind.id, reason: REASON, confirmCode: 'INDORE' });
  await rejects(s.call(sa, 'branches.delete', { id: main.id, reason: REASON, confirmCode: 'MAIN' }), 'VALIDATION');
});

test('system.clear (transactions): needs role, phrase and password; wipes the books, keeps branches + users; restarts numbering', async () => {
  const s = await fresh();
  const sa = await superLogin(s), bm = await login(s, 'INDORE', 'indore.manager');
  const base = { scope: 'TRANSACTIONS', confirm: 'DELETE ALL', password: 'Admin@1234' };
  await rejects(s.call(bm, 'system.clear', Object.assign({}, base, { password: 'Ravi@1234' })), 'FORBIDDEN');
  await rejects(s.call(sa, 'system.clear', Object.assign({}, base, { confirm: 'delete' })), 'VALIDATION');
  await rejects(s.call(sa, 'system.clear', { confirm: 'DELETE ALL', password: 'Admin@1234' }), 'VALIDATION');
  await rejects(s.call(sa, 'system.clear', Object.assign({}, base, { password: 'Wrong@1234' })), 'VALIDATION');
  assert.ok((await s.call(sa, 'vouchers.list', { filters: {}, pageSize: 1 })).total > 100, 'refused calls erased nothing');
  assert.ok((await s.call(sa, 'audit.list', { filters: { action: 'CLEAR_FAILED' } })).total >= 1, 'a wrong password is audited');

  const before = await s.raw();
  const r = await s.call(sa, 'system.clear', base);
  assert.equal(r.scope, 'TRANSACTIONS');
  assert.equal(r.cleared.vouchers, before.vouchers.length);
  const after = await s.raw();
  assert.equal(after.vouchers.length, 0); assert.equal(after.attachments.length, 0); assert.equal(after.outstanding.length, 0); assert.equal(after.statements.length, 0);
  assert.equal(after.branches.length, before.branches.length); assert.equal(after.users.length, before.users.length); assert.equal(after.registers.length, before.registers.length);
  assert.ok(after.registers.every((x) => x.openingPaise === 0), 'opening balances back to zero');
  assert.equal(after.counters.PAYMENT, 0); assert.equal(after.counters.RECEIPT, 0);
  assert.ok(after.audit.length >= before.audit.length, 'the audit history survives by default');
  assert.equal(after.audit[after.audit.length - 1].action, 'CLEAR');
  assert.equal((await s.call(sa, 'audit.verify', {})).ok, true);
  assert.equal((await s.call(null, 'branches.public', {}, {})).empty, false);
  assert.deepEqual(await s.helpers.storage.keys().then((k) => k.filter((x) => x.startsWith('att:'))), [], 'no receipt photo is left in storage');

  // everything still works, numbering starts again at 000001, the session survived
  const rahul = await login(s, 'INDORE', 'indore.accountant');
  const v = (await s.call(rahul, 'vouchers.create', PAY)).voucher;
  assert.equal(v.number, 'CPV-000001');
  assert.equal((await s.call(rahul, 'register.get', {})).currentBalancePaise, -100000);
  assert.equal((await s.call(sa, 'dashboard.get', {})).constructor, Object);
});

test('system.clear (transactions): options — keep numbering, keep opening balances, erase audit history too', async () => {
  const s = await fresh();
  const sa = await superLogin(s);
  const before = await s.raw();
  const opening = before.registers.map((x) => x.openingPaise);
  assert.ok(opening.some((x) => x > 0));
  await s.call(sa, 'system.clear', { scope: 'TRANSACTIONS', confirm: 'DELETE ALL', password: 'Admin@1234', resetNumbers: false, resetOpening: false });
  const a = await s.raw();
  assert.deepEqual(a.registers.map((x) => x.openingPaise), opening);
  assert.equal(a.counters.PAYMENT, before.counters.PAYMENT, 'numbers carry on');
  const rahul = await login(s, 'INDORE', 'indore.accountant');
  const v = (await s.call(rahul, 'vouchers.create', PAY)).voucher;
  assert.equal(v.number, 'CPV-' + String(before.counters.PAYMENT + 1).padStart(6, '0'));

  await s.call(sa, 'system.clear', { scope: 'TRANSACTIONS', confirm: 'DELETE ALL', password: 'Admin@1234', clearAudit: true, reason: 'Starting the real books' });
  const b = await s.raw();
  assert.equal(b.audit.length, 1, 'only the record of the clearing is left');
  assert.equal(b.audit[0].action, 'CLEAR');
  assert.equal(b.audit[0].reason, 'Starting the real books');
  assert.equal(b.audit[0].prevHash, 'GENESIS');
  assert.equal((await s.call(sa, 'audit.verify', {})).ok, true);
  await s.call(rahul, 'vouchers.create', PAY);            // and the chain keeps growing
  assert.equal((await s.call(sa, 'audit.verify', {})).ok, true);
});

test('system.clear: five wrong passwords lock the action', async () => {
  const s = await fresh();
  const sa = await superLogin(s);
  for (let i = 0; i < 5; i++) await rejects(s.call(sa, 'system.clear', { scope: 'TRANSACTIONS', confirm: 'DELETE ALL', password: 'Nope@1234' + i }), 'VALIDATION');
  await rejects(s.call(sa, 'system.clear', { scope: 'TRANSACTIONS', confirm: 'DELETE ALL', password: 'Admin@1234' }), 'RATE_LIMIT');
  assert.ok((await s.call(sa, 'vouchers.list', { filters: {}, pageSize: 1 })).total > 100);
});

test('system.clear: a failing safety backup stops everything; a working one is reported', async () => {
  let calls = 0;
  const bad = await fresh({ beforeWipe: async () => { calls++; throw new Error('disk full'); } });
  const sa = await superLogin(bad);
  await rejects(bad.call(sa, 'system.clear', { scope: 'TRANSACTIONS', confirm: 'DELETE ALL', password: 'Admin@1234' }), 'VALIDATION');
  assert.equal(calls, 1);
  assert.ok((await bad.call(sa, 'vouchers.list', { filters: {}, pageSize: 1 })).total > 100, 'nothing was deleted');

  const good = await fresh({ beforeWipe: async () => 'backups/before-clear-test' });
  const sg = await superLogin(good);
  const r = await good.call(sg, 'system.clear', { scope: 'TRANSACTIONS', confirm: 'DELETE ALL', password: 'Admin@1234' });
  assert.equal(r.backup, 'backups/before-clear-test');
});

test('system.clear (everything): back to a blank installation that offers first-time setup again', async () => {
  const s = await fresh();
  const sa = await superLogin(s), rahul = await login(s, 'INDORE', 'indore.accountant');
  const r = await s.call(sa, 'system.clear', { scope: 'EVERYTHING', confirm: 'DELETE ALL', password: 'Admin@1234', reason: 'Handing over to the shop' });
  assert.equal(r.scope, 'EVERYTHING');
  assert.equal(await s.isEmpty(), true);
  await rejects(s.call(sa, 'auth.me', {}), 'UNAUTHENTICATED');
  await rejects(s.call(rahul, 'auth.me', {}), 'UNAUTHENTICATED');
  await rejects(login(s, 'MAIN', 'admin', 'Admin@1234'), 'UNAUTHENTICATED');
  const pub = await s.call(null, 'branches.public', {}, {});
  assert.equal(pub.empty, true); assert.deepEqual(pub.branches, []);
  const raw = await s.raw();
  assert.equal(raw.vouchers.length + raw.branches.length + raw.users.length + raw.registers.length + raw.attachments.length, 0);
  assert.equal(raw.audit[0].action, 'RESET'); assert.equal(raw.audit[0].prevHash, 'GENESIS'); assert.ok(raw.audit.slice(1).every((a) => a.action === 'LOGIN_FAILED'), 'only the refused sign-in attempt above follows'); assert.equal(raw.audit[0].reason, 'Handing over to the shop');
  assert.equal(raw.counters.PAYMENT, 0);
  assert.deepEqual(await s.helpers.storage.keys().then((k) => k.filter((x) => x.startsWith('att:'))), []);

  // the first-run setup works again, and the history simply continues the chain
  const setup = await s.call(null, 'system.setup', { companyName: 'Ravi Water Flow Pump - Rajkot', branchName: 'Ravi Water Flow Pump - Rajkot', branchCode: 'RAJKOT', fullName: 'Mr Ravi Patel', email: 'ravi@example.com', username: 'ravi', password: 'Sup3rSecret!' }, { device: 'test' });
  assert.ok(setup.token);
  assert.equal((await s.call(setup.token, 'audit.verify', {})).ok, true);
  assert.ok(raw.rev <= (await s.raw()).rev, 'the revision number never goes backwards (live-sync clients rely on it)');
});

test('vouchers.purge by filters: every page at once, only the matching ones, count re-checked, phrase + reason needed, Super Admin only', async () => {
  const s = await fresh();
  const sa = await superLogin(s), bm = await login(s, 'INDORE', 'indore.manager');
  const F = { branchId: 'br_indore', type: 'PAYMENT' };
  const before = await s.call(sa, 'vouchers.list', { filters: F, pageSize: 1 });
  const others = (await s.call(sa, 'vouchers.list', { filters: {}, pageSize: 1 })).total - before.total;
  assert.ok(before.total > 25 && others > 0, 'the filter spans several pages and leaves other vouchers alone');

  await rejects(s.call(bm, 'vouchers.purge', { filters: F, expectCount: before.total, confirm: 'DELETE ALL', reason: REASON }), 'FORBIDDEN');
  await rejects(s.call(sa, 'vouchers.purge', { filters: F, expectCount: before.total, confirm: 'delete', reason: REASON }), 'VALIDATION');
  await rejects(s.call(sa, 'vouchers.purge', { filters: F, expectCount: before.total, confirm: 'DELETE ALL', reason: 'no' }), 'VALIDATION');
  await rejects(s.call(sa, 'vouchers.purge', { filters: F, expectCount: before.total + 1, confirm: 'DELETE ALL', reason: REASON }), 'CONFLICT');
  await rejects(s.call(sa, 'vouchers.purge', { filters: { q: 'zzz-nothing-matches-this' }, expectCount: 0, confirm: 'DELETE ALL', reason: REASON }), 'VALIDATION');
  assert.equal((await s.call(sa, 'vouchers.list', { filters: F, pageSize: 1 })).total, before.total, 'refused calls erased nothing');

  const r = await s.call(sa, 'vouchers.purge', { filters: F, expectCount: before.total, confirm: 'DELETE ALL', reason: REASON });
  assert.equal(r.removed, before.total);
  assert.equal((await s.call(sa, 'vouchers.list', { filters: F, pageSize: 1 })).total, 0);
  assert.equal((await s.call(sa, 'vouchers.list', { filters: {}, pageSize: 1 })).total, others, 'vouchers outside the filter are untouched');
  assert.ok((await s.call(sa, 'audit.list', { filters: { action: 'PURGE' } })).total >= 1);
  assert.equal((await s.call(sa, 'audit.verify', {})).ok, true);
});

test('vouchers.purge by filters: "everything" is one summary audit entry, receipt photos go too, the chain stays valid', async () => {
  const s = await fresh();
  const sa = await superLogin(s);
  const total = (await s.call(sa, 'vouchers.list', { filters: {}, pageSize: 1 })).total;
  assert.ok(total > 500, 'the demo has more vouchers than the per-voucher audit limit');
  const r = await s.call(sa, 'vouchers.purge', { filters: {}, expectCount: total, confirm: 'DELETE ALL', reason: REASON });
  assert.equal(r.removed, total);
  assert.equal((await s.call(sa, 'vouchers.list', { filters: { status: 'DELETED' }, pageSize: 1 })).total, 0);
  assert.equal((await s.call(sa, 'vouchers.list', { filters: {}, pageSize: 1 })).total, 0);
  const log = (await s.call(sa, 'audit.list', { filters: { action: 'PURGE' } })).rows;
  assert.equal(log.length, 1, 'one summary entry instead of hundreds');
  assert.equal(log[0].old.count, total);
  assert.equal(log[0].reason, REASON);
  assert.deepEqual(await s.helpers.storage.keys().then((k) => k.filter((x) => x.startsWith('att:'))), []);
  assert.equal((await s.call(sa, 'audit.verify', {})).ok, true);
  // the cash registers are back to their opening balances
  const regs = (await s.call(sa, 'registers.list', {})).rows;
  assert.ok(regs.every((x) => x.balancePaise === x.openingPaise));
});

test('users.deleteMany: several at once; never yourself or the last Super Admin; all-or-nothing; keep or erase their vouchers', async () => {
  const s = await fresh();
  const sa = await superLogin(s), bm = await login(s, 'INDORE', 'indore.manager');
  const users = (await s.call(sa, 'users.list', {})).rows;
  const id = (name) => users.find((u) => u.username === name).id;
  const [neha, amit] = [id('neha.joshi'), id('nagpur.accountant')];
  const selfId = id('admin');
  const countOf = async (uid) => (await s.call(sa, 'vouchers.list', { filters: { userId: uid }, pageSize: 1 })).total;
  const [nehaV, amitV] = [await countOf(neha), await countOf(amit)];
  assert.ok(nehaV > 0 && amitV > 0);

  await rejects(s.call(bm, 'users.deleteMany', { ids: [neha], reason: REASON }), 'FORBIDDEN');
  await rejects(s.call(sa, 'users.deleteMany', { ids: [], reason: REASON }), 'VALIDATION');
  await rejects(s.call(sa, 'users.deleteMany', { ids: [neha, selfId], reason: REASON }), 'VALIDATION');
  await rejects(s.call(sa, 'users.deleteMany', { ids: [neha, 'u_nope'], reason: REASON }), 'NOT_FOUND');
  await rejects(s.call(sa, 'users.deleteMany', { ids: [neha], reason: 'no' }), 'VALIDATION');
  assert.equal(await countOf(neha), nehaV, 'refused calls changed nothing');
  await login(s, 'INDORE', 'neha.joshi');                         // still able to sign in

  // keep their vouchers
  const r1 = await s.call(sa, 'users.deleteMany', { ids: [neha, amit], erase: false, reason: REASON });
  assert.equal(r1.removed.users, 2);
  await rejects(login(s, 'INDORE', 'neha.joshi'), 'UNAUTHENTICATED');
  await rejects(login(s, 'NAGPUR', 'nagpur.accountant'), 'UNAUTHENTICATED');
  assert.equal(await countOf(neha), nehaV, 'vouchers stay on record');
  assert.equal((await s.call(sa, 'users.list', {})).rows.some((u) => u.id === neha), false, 'no longer listed');
  assert.equal((await s.call(sa, 'audit.list', { filters: { action: 'DELETE', entity: 'USER' } })).total >= 2, true);

  // erase them for good, together with what they created
  const main = id('main.accountant'), mainV = await countOf(main);
  const pv = await s.call(sa, 'erase.preview', { userIds: [main] });
  assert.equal(pv.vouchers, mainV);
  const r2 = await s.call(sa, 'users.deleteMany', { ids: [main], erase: true, reason: REASON });
  assert.equal(r2.removed.vouchers, mainV);
  assert.equal(await countOf(main), 0);
  assert.equal((await s.call(sa, 'audit.list', { filters: { action: 'PURGE', entity: 'USER' } })).total >= 1, true);

  // the last active Super Admin cannot be removed (here: by a second Super Admin who is being removed with them)
  const second = await s.call(sa, 'users.create', { fullName: 'Second Admin', username: 'second.admin', email: 'second@example.com', branchId: 'br_main', role: 'SUPER_ADMIN' });
  await rejects(s.call(sa, 'users.deleteMany', { ids: [second.user.id, selfId], reason: REASON }), 'VALIDATION');
  assert.equal((await s.call(sa, 'audit.verify', {})).ok, true);
});
