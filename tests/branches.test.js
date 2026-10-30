// Branch-wise books on the dashboard (Main and every branch kept apart, users separate inside each branch)
// and "Add branch" creating the branch's own sign-in.
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
const ADMIN = { fullName: 'Rakesh Verma', username: 'pune.admin' };

test('dashboard: Main, every branch and the whole company are separate sets of books that add up', async () => {
  const s = await fresh();
  const sa = await login(s, 'MAIN', 'admin', 'Admin@1234');
  const all = await s.call(sa, 'dashboard.get', { range: 'all', branchId: 'all' });
  const main = await s.call(sa, 'dashboard.get', { range: 'all', branchId: 'main' });
  const indore = await s.call(sa, 'dashboard.get', { range: 'all', branchId: 'br_indore' });
  const nagpur = await s.call(sa, 'dashboard.get', { range: 'all', branchId: 'br_nagpur' });

  assert.equal(all.scope.branchId, '');
  assert.equal(main.scope.branchId, 'br_main');
  assert.equal(main.scope.isMain, true);
  assert.equal(indore.scope.isMain, false);
  // each scope only holds its own cash ...
  assert.ok(main.kpis.inPaise > 0 && indore.kpis.inPaise > 0);
  assert.ok(main.kpis.inPaise < all.kpis.inPaise, 'Main alone is less than the company');
  // ... and the three together are exactly the company (nothing lost, nothing counted twice)
  for (const k of ['inPaise', 'outPaise', 'netPaise', 'count', 'balancePaise']) {
    assert.equal(main.kpis[k] + indore.kpis[k] + nagpur.kpis[k], all.kpis[k], k + ' adds up across branches');
  }
  assert.equal(main.kpis.activeUsers + indore.kpis.activeUsers + nagpur.kpis.activeUsers, all.kpis.activeUsers);
  assert.ok(main.recent.every((v) => v.branchId === 'br_main'), 'recent vouchers belong to the chosen branch only');
  assert.ok(indore.recent.length && indore.recent.every((v) => v.branchId === 'br_indore'));
  // the balance trend ends at the cash in hand of that scope
  const last = (d) => d.charts.balanceTrend30[d.charts.balanceTrend30.length - 1].balancePaise;
  assert.equal(last(main), main.kpis.balancePaise);
  assert.equal(last(all), all.kpis.balancePaise);
  // outstanding is scoped too
  assert.ok(main.kpis.outstandingPaise < all.kpis.outstandingPaise);
  // the branch cards / chips still list every branch, Main first
  assert.deepEqual(main.branches.map((b) => b.id), ['br_main', 'br_indore', 'br_nagpur']);
  assert.equal(main.branches[0].isMain, true);
  // 'main' is an alias for the first branch; an unknown branch falls back to the whole company
  assert.equal((await s.call(sa, 'dashboard.get', { range: 'all', branchId: 'nope' })).kpis.inPaise, all.kpis.inPaise);
  assert.equal((await s.call(sa, 'dashboard.get', { range: 'all' })).kpis.inPaise, all.kpis.inPaise, 'no scope = whole company, as before');
});

test('dashboard: branch-wise accounts list every branch and every user separately and reconcile', async () => {
  const s = await fresh();
  const sa = await login(s, 'MAIN', 'admin', 'Admin@1234');
  const d = await s.call(sa, 'dashboard.get', { range: 'all', branchId: 'all' });
  const B = d.books;
  assert.deepEqual(B.branches.map((b) => b.id), ['br_main', 'br_indore', 'br_nagpur']);
  assert.equal(B.branches[0].isMain, true);
  for (const b of B.branches) {
    assert.ok(b.users.length >= 1, b.name + ' lists its own users');
    // every user row is inside its branch, and the rows add up to the branch (so nothing is hidden)
    for (const k of ['inPaise', 'outPaise', 'count', 'balancePaise']) assert.equal(b.users.reduce((a, u) => a + u[k], 0), b[k], b.code + ' ' + k);
    assert.equal(b.netPaise, b.inPaise - b.outPaise);
  }
  assert.ok(B.branches[1].users.every((u) => ['u_indore', 'u_neha', 'u_indadm'].includes(u.id)), 'Indore lists only Indore people');
  const rahul = B.branches[1].users.find((u) => u.id === 'u_indore');
  assert.ok(rahul.registerId && rahul.inPaise >= 0 && rahul.outPaise > 0);
  assert.equal(rahul.balancePaise, (await s.call(sa, 'registers.list', {})).rows.find((r) => r.userId === 'u_indore').balancePaise, 'a user row shows that register’s balance');
  // company total = sum of the branches and equals the all-branch KPIs
  for (const k of ['inPaise', 'outPaise', 'count', 'balancePaise']) {
    assert.equal(B.total[k], B.branches.reduce((a, b) => a + b[k], 0));
    assert.equal(B.total[k], d.kpis[k === 'balancePaise' ? 'balancePaise' : k]);
  }
  // choosing one branch shows just that branch's block
  const one = (await s.call(sa, 'dashboard.get', { range: 'all', branchId: 'br_nagpur' })).books;
  assert.deepEqual(one.branches.map((b) => b.id), ['br_nagpur']);
  assert.equal(one.total.inPaise, one.branches[0].inPaise);
  // the date range limits the cash in / out but never the balance
  const today = await s.call(sa, 'dashboard.get', { range: 'today', branchId: 'all' });
  assert.ok(today.books.total.inPaise <= B.total.inPaise);
  assert.equal(today.books.total.balancePaise, B.total.balancePaise);
});

test('dashboard: who may pick a branch, and what they get', async () => {
  const s = await fresh();
  const ceo = await login(s, 'MAIN', 'ceo'), mgr = await login(s, 'INDORE', 'indore.manager'), rahul = await login(s, 'INDORE', 'indore.accountant');
  // the CEO can look at one branch at a time too
  assert.equal((await s.call(ceo, 'dashboard.get', { range: 'all', branchId: 'br_nagpur' })).books.branches[0].id, 'br_nagpur');
  // a branch admin always stays inside their own branch, whatever they ask for
  const m = await s.call(mgr, 'dashboard.get', { range: 'all', branchId: 'br_nagpur' });
  assert.deepEqual(m.books.branches.map((b) => b.id), ['br_indore']);
  assert.deepEqual(m.branches.map((b) => b.id), ['br_indore']);
  assert.ok(m.recent.every((v) => v.branchId === 'br_indore'));
  assert.ok(m.books.branches[0].users.length >= 2, 'their own users are listed with separate accounts');
  // a user has neither the books nor any branch view
  const u = await s.call(rahul, 'dashboard.get', { range: 'all', branchId: 'br_nagpur' });
  assert.equal(u.books, undefined);
  assert.equal(u.branches, undefined);
  assert.ok(u.recent.every((v) => v.userId === 'u_indore'));
});

test('add branch: the branch gets its own sign-in with its own password, created together', async () => {
  const s = await fresh();
  const sa = await login(s, 'MAIN', 'admin', 'Admin@1234');
  const before = (await s.call(sa, 'branches.list', {})).rows.length;
  const r = await s.call(sa, 'branches.create', { name: 'Ravi Water Flow Pump - Pune', code: 'PUNE', admin: Object.assign({ mobile: '9876543210' }, ADMIN) });
  assert.equal(r.branch.code, 'PUNE');
  assert.equal(r.branch.isMain, false);
  assert.equal(r.admin.role, 'BRANCH_ADMIN');
  assert.equal(r.admin.branchId, r.branch.id);
  assert.equal(r.admin.username, 'pune.admin');
  assert.ok(r.admin.registerId && r.admin.registerId.startsWith(r.branch.code.slice(0, 3)), 'the branch admin has a cash register of this branch');
  assert.ok(r.tempPassword && r.tempPassword.length >= 8, 'a password is generated when none is typed');
  assert.equal((await s.call(sa, 'branches.list', {})).rows.length, before + 1);

  // the new sign-in works with the branch code ...
  const lg = await s.call(null, 'auth.login', { branchCode: 'PUNE', identifier: 'pune.admin', password: r.tempPassword }, { device: 't' });
  assert.equal(lg.user.mustChangePassword, true, 'must choose a new password at first sign-in');
  // ... and only with its own branch code
  await rejects(s.call(null, 'auth.login', { branchCode: 'MAIN', identifier: 'pune.admin', password: r.tempPassword }, { device: 't' }), 'UNAUTHENTICATED');
  await rejects(s.call(null, 'auth.login', { branchCode: 'PUNE', identifier: 'pune.admin', password: 'Wrong@1234' }, { device: 't' }), 'UNAUTHENTICATED');
  // it only ever sees its own branch
  const me = lg.token;
  assert.deepEqual((await s.call(me, 'branches.list', {})).rows.map((b) => b.code), ['PUNE']);
  assert.equal((await s.call(me, 'vouchers.list', { pageSize: 100 })).total, 0);
  assert.deepEqual((await s.call(me, 'dashboard.get', { range: 'all' })).books.branches.map((b) => b.code), ['PUNE']);
  await rejects(s.call(me, 'branches.create', { name: 'Not allowed' }), 'FORBIDDEN');
  // the audit log recorded both
  const log = (await s.call(sa, 'audit.list', { pageSize: 10 })).rows;
  assert.ok(log.some((a) => a.entity === 'BRANCH' && a.action === 'CREATE' && /Pune/.test(a.entityLabel)));
  assert.ok(log.some((a) => a.entity === 'USER' && a.action === 'CREATE' && /pune\.admin/.test(a.entityLabel)));
});

test('add branch: a password you type is used as it is; the email is optional', async () => {
  const s = await fresh();
  const sa = await login(s, 'MAIN', 'admin', 'Admin@1234');
  const r = await s.call(sa, 'branches.create', { name: 'Ravi Water Flow Pump - Surat', admin: { fullName: 'Meena Desai', username: 'surat.admin', password: 'Surat@2026', email: '' } });
  assert.equal(r.tempPassword, null, 'nothing generated when the admin typed one');
  assert.equal(r.admin.email, '');
  const lg = await s.call(null, 'auth.login', { branchCode: r.branch.code, identifier: 'surat.admin', password: 'Surat@2026' }, { device: 't' });
  assert.equal(lg.user.role, 'BRANCH_ADMIN');
  // two branches may both have no email; a given email still has to be unique
  await s.call(sa, 'branches.create', { name: 'Ravi Water Flow Pump - Vapi', admin: { fullName: 'Kiran Naik', username: 'vapi.admin' } });
  await s.call(sa, 'branches.create', { name: 'Ravi Water Flow Pump - Bhuj', admin: { fullName: 'Hari Om', username: 'bhuj.admin', email: 'hari@example.com' } });
  await rejects(s.call(sa, 'branches.create', { name: 'Ravi Water Flow Pump - Anand', admin: { fullName: 'Hari Two', username: 'anand.admin', email: 'hari@example.com' } }), 'CONFLICT');
});

test('add branch: if the sign-in is not acceptable, nothing is created', async () => {
  const s = await fresh();
  const sa = await login(s, 'MAIN', 'admin', 'Admin@1234');
  const count = async () => ({ b: (await s.call(sa, 'branches.list', {})).rows.length, u: (await s.call(sa, 'users.list', {})).rows.length });
  const was = await count();
  await rejects(s.call(sa, 'branches.create', { name: 'Ravi Water Flow Pump - Goa', admin: { fullName: 'Goa Admin', username: 'admin' } }), 'CONFLICT');              // username taken
  await rejects(s.call(sa, 'branches.create', { name: 'Ravi Water Flow Pump - Goa', admin: { fullName: 'Goa Admin', username: 'goa admin!' } }), 'VALIDATION');         // bad username
  await rejects(s.call(sa, 'branches.create', { name: 'Ravi Water Flow Pump - Goa', admin: { fullName: 'Goa Admin', username: 'goa.admin', password: '123' } }), 'VALIDATION'); // weak password
  await rejects(s.call(sa, 'branches.create', { name: 'Ravi Water Flow Pump - Goa', admin: { fullName: 'G', username: 'goa.admin' } }), 'VALIDATION');                   // name too short
  await rejects(s.call(sa, 'branches.create', { name: 'Ravi Water Flow Pump - Goa', admin: { fullName: 'Goa Admin', username: 'goa.admin', mobile: '12345' } }), 'VALIDATION');
  await rejects(s.call(sa, 'branches.create', { name: 'Ravi Water Flow Pump - Goa', code: 'MAIN', admin: { fullName: 'Goa Admin', username: 'goa.admin' } }), 'CONFLICT');   // code taken
  assert.deepEqual(await count(), was, 'no half-created branch or user is left behind');
  // creating a branch with no sign-in still works for older callers
  const plain = await s.call(sa, 'branches.create', { name: 'Ravi Water Flow Pump - Goa' });
  assert.equal(plain.admin, undefined);
});

test('a new branch keeps its own money apart from Main and from every other branch', async () => {
  const s = await fresh();
  const sa = await login(s, 'MAIN', 'admin', 'Admin@1234');
  const mainBefore = await s.call(sa, 'dashboard.get', { range: 'all', branchId: 'main' });
  const allBefore = await s.call(sa, 'dashboard.get', { range: 'all', branchId: 'all' });
  const r = await s.call(sa, 'branches.create', { name: 'Ravi Water Flow Pump - Pune', code: 'PUNE', admin: Object.assign({ password: 'Pune@2026' }, ADMIN) });
  // a brand-new branch starts at zero and does not change Main
  const fresh0 = await s.call(sa, 'dashboard.get', { range: 'all', branchId: r.branch.id });
  assert.equal(fresh0.kpis.inPaise, 0); assert.equal(fresh0.kpis.outPaise, 0); assert.equal(fresh0.kpis.balancePaise, 0);
  assert.equal(fresh0.books.branches[0].users.length, 1, 'just its branch admin so far');
  assert.equal((await s.call(sa, 'dashboard.get', { range: 'all', branchId: 'main' })).kpis.inPaise, mainBefore.kpis.inPaise);

  // the branch admin handles cash of this branch only
  const pune = await login(s, 'PUNE', 'pune.admin', 'Pune@2026');
  await s.call(pune, 'vouchers.create', { kind: 'RECEIVED', partyName: 'Owner Cash', amount: '50000' });
  await s.call(pune, 'vouchers.create', { type: 'PAYMENT', partyName: 'Pune Supplier', particulars: 'Pipes', amount: '12000' });
  const after = await s.call(sa, 'dashboard.get', { range: 'all', branchId: r.branch.id });
  assert.equal(after.kpis.inPaise, 5000000); assert.equal(after.kpis.outPaise, 1200000); assert.equal(after.kpis.balancePaise, 3800000);
  const main = await s.call(sa, 'dashboard.get', { range: 'all', branchId: 'main' });
  assert.equal(main.kpis.inPaise, mainBefore.kpis.inPaise, 'Main is untouched');
  assert.equal(main.kpis.balancePaise, mainBefore.kpis.balancePaise);
  const all = await s.call(sa, 'dashboard.get', { range: 'all', branchId: 'all' });
  assert.equal(all.kpis.inPaise, allBefore.kpis.inPaise + 5000000, 'the company total includes the new branch');
  assert.equal(all.books.branches.length, 4);
  const row = all.books.branches.find((b) => b.id === r.branch.id);
  assert.equal(row.users[0].fullName, 'Rakesh Verma');
  assert.equal(row.users[0].balancePaise, 3800000, 'the branch admin’s own account');
});
