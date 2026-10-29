// The CEO: reads every branch (and signs in from any), can change nothing, has no cash register — plus the CEO Dashboard numbers.
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
const PAY = { type: 'PAYMENT', partyName: 'CEO Test Supplier', particulars: 'Pipes for the CEO test', amount: '1000' };
const R = 'Checked against the paper bill';

test('CEO: signs in from any branch, sees every branch, but nothing can be changed', async () => {
  const s = await fresh();
  const ceo = await login(s, 'NAGPUR', 'ceo');                                  // not the home branch: still allowed
  const sa = await login(s, 'MAIN', 'admin', 'Admin@1234'), rahul = await login(s, 'INDORE', 'indore.accountant');
  const me = await s.call(ceo, 'auth.me', {});
  assert.equal(me.user.role, 'CEO');
  assert.equal(me.user.registerId, null, 'the CEO has no cash register');

  // reads everything
  const all = await s.call(ceo, 'vouchers.list', { pageSize: 500 });
  assert.equal(new Set(all.rows.map((v) => v.branchId)).size, 3);
  assert.equal(all.total, (await s.call(sa, 'vouchers.list', { pageSize: 1 })).total, 'same vouchers as the main admin');
  assert.equal((await s.call(ceo, 'branches.list', {})).rows.length, 3);
  assert.equal(new Set((await s.call(ceo, 'users.list', {})).rows.map((u) => u.branchId)).size, 3);
  assert.equal((await s.call(ceo, 'outstanding.list', { pageSize: 100 })).rows.length, (await s.call(sa, 'outstanding.list', { pageSize: 100 })).rows.length);
  assert.equal((await s.call(ceo, 'audit.list', { pageSize: 5 })).total, (await s.call(sa, 'audit.list', { pageSize: 5 })).total);
  assert.equal((await s.call(ceo, 'reports.branches', { preset: 'month' })).rows.length, 3);
  assert.ok((await s.call(ceo, 'registers.list', {})).rows.length >= 6);
  assert.ok((await s.call(ceo, 'export.vouchers', { filters: {} })).rows.length > 50, 'may export');
  const v = (await s.call(rahul, 'vouchers.create', PAY)).voucher;
  const d = await s.call(ceo, 'vouchers.get', { id: v.id });
  assert.equal(d.canAdmin, false, 'the voucher page offers the CEO no edit / void buttons');
  assert.equal((await s.call(ceo, 'search.global', { q: 'indore' })).branches.length, 1, 'search finds other branches');
  assert.ok((await s.call(ceo, 'notifications.list', {})).total > 0, 'sees the admin notifications');

  // changes nothing
  const NO = [
    ['vouchers.create', PAY], ['vouchers.edit', { id: v.id, reason: R, patch: { amount: '5' } }], ['vouchers.edit', { id: v.id, reason: R, patch: { number: 'CPV-777777' } }],
    ['vouchers.void', { id: v.id, reason: R }], ['vouchers.delete', { id: v.id, reason: R }], ['vouchers.review', { id: v.id, status: 'VALID' }],
    ['vouchers.purge', { ids: [v.id], reason: R }], ['vouchers.removeAttachment', { id: v.id, attachmentId: 'x' }],
    ['registers.setOpening', { userId: 'u_indore', amount: '5', reason: R }],
    ['users.create', { fullName: 'Nope', username: 'nope1', email: 'n@x.com', branchId: 'br_main', role: 'USER' }], ['users.update', { id: 'u_neha', role: 'VIEWER' }],
    ['users.setStatus', { id: 'u_neha', status: 'INACTIVE' }], ['users.resetPassword', { id: 'u_neha' }], ['users.delete', { id: 'u_neha', reason: R }],
    ['outstanding.create', { direction: 'RECEIVABLE', party: 'X', amount: '10' }], ['outstanding.delete', { id: 'x', reason: R }],
    ['branches.create', { name: 'Evil Branch' }], ['branches.setStatus', { id: 'br_indore', status: 'DISABLED' }], ['settings.update', { company: { name: 'Hacked' } }],
    ['system.clear', {}], ['audit.verify', {}],
  ];
  for (const [m, a] of NO) await rejects(s.call(ceo, m, a), 'FORBIDDEN');
  assert.equal((await s.call(sa, 'vouchers.get', { id: v.id })).voucher.status, 'ACTIVE');
  assert.equal((await s.call(sa, 'vouchers.get', { id: v.id })).voucher.number, v.number);
  assert.equal((await s.call(ceo, 'users.list', {})).rows.every((u) => u.canManage === false), true, 'no Manage button for anyone');
  assert.equal((await s.call(sa, 'audit.verify', {})).ok, true);

  // may change their own password (the one thing every account can do)
  await s.call(ceo, 'auth.changePassword', { currentPassword: 'Ravi@1234', newPassword: 'Ceo#Secure99' });
  await login(s, 'MAIN', 'ceo', 'Ceo#Secure99');
});

test('CEO: a disabled branch never locks the CEO out; role can be given and taken away by the main admin only', async () => {
  const s = await fresh();
  const sa = await login(s, 'MAIN', 'admin', 'Admin@1234'), bm = await login(s, 'INDORE', 'indore.manager');
  const ceo = await login(s, 'MAIN', 'ceo');
  await s.call(sa, 'branches.setStatus', { id: 'br_main', status: 'DISABLED' });                 // the CEO's home branch
  await s.call(ceo, 'vouchers.list', {});                                                         // the existing sign-in keeps working
  await login(s, 'INDORE', 'ceo');                                                                // and a new one too
  await s.call(sa, 'branches.setStatus', { id: 'br_main', status: 'ACTIVE' });

  // a CEO is made by the main admin, and gets no register
  await rejects(s.call(bm, 'users.create', { fullName: 'Second Ceo', username: 'ceo2', email: 'c2@x.com', branchId: 'br_indore', role: 'CEO' }), 'FORBIDDEN');
  const c = await s.call(sa, 'users.create', { fullName: 'Second Ceo', username: 'ceo2', email: 'c2@x.com', branchId: 'br_main', role: 'CEO', password: 'Passw0rd1' });
  assert.equal(c.user.role, 'CEO');
  assert.equal(c.user.registerId, null);
  assert.equal((await s.call(sa, 'registers.list', {})).rows.some((r) => r.userId === c.user.id), false);
  // a branch user promoted to CEO keeps their old register; a CEO turned into a branch user gets one
  await s.call(sa, 'users.update', { id: c.user.id, role: 'USER' });
  assert.ok((await s.call(sa, 'registers.list', {})).rows.some((r) => r.userId === c.user.id), 'now a branch user: has a register');
  await rejects(s.call(sa, 'users.update', { id: 'u_admin', role: 'CEO' }), 'VALIDATION');         // the last Super Admin cannot be demoted
});

test('ceo.dashboard: only the CEO and the main admin; numbers add up with the rest of the system', async () => {
  const s = await fresh();
  const sa = await login(s, 'MAIN', 'admin', 'Admin@1234'), ceo = await login(s, 'MAIN', 'ceo');
  for (const who of [['INDORE', 'indore.manager'], ['INDORE', 'indore.accountant'], ['NAGPUR', 'nagpur.auditor']]) await rejects(s.call(await login(s, who[0], who[1]), 'ceo.dashboard', {}), 'FORBIDDEN');
  await rejects(s.call(null, 'ceo.dashboard', {}), 'UNAUTHENTICATED');

  const d = await s.call(ceo, 'ceo.dashboard', { range: 'month' });
  assert.deepEqual(await s.call(sa, 'ceo.dashboard', { range: 'month' }).then((x) => Object.assign({}, x, { generatedAt: 0 })), Object.assign({}, d, { generatedAt: 0 }), 'the main admin sees the very same page');
  assert.equal(d.range.key, 'month');
  assert.equal(d.range.from, d.today.slice(0, 8) + '01');

  // cash in hand = every register's balance = sum of the branch balances
  const regs = (await s.call(sa, 'registers.list', {})).rows;
  assert.equal(d.kpis.cashInHandPaise, regs.reduce((a, r) => a + r.balancePaise, 0));
  assert.equal(d.branches.reduce((a, b) => a + b.balancePaise, 0), d.kpis.cashInHandPaise);
  // period totals = the same totals as the main dashboard and the branch rows
  const dash = await s.call(sa, 'dashboard.get', { range: 'month' });
  assert.equal(d.kpis.inPaise, dash.kpis.inPaise);
  assert.equal(d.kpis.outPaise, dash.kpis.outPaise);
  assert.equal(d.kpis.count, dash.kpis.count);
  assert.equal(d.branches.reduce((a, b) => a + b.inPaise, 0), d.kpis.inPaise);
  assert.equal(d.branches.reduce((a, b) => a + b.outPaise, 0), d.kpis.outPaise);
  assert.equal(d.kpis.netPaise, d.kpis.inPaise - d.kpis.outPaise);
  // review queue = what the voucher list calls "to review"
  const pend = await s.call(sa, 'vouchers.list', { filters: { review: 'PENDING' }, pageSize: 1 });
  assert.equal(d.review.pendingCount, pend.total);
  assert.equal(d.branches.reduce((a, b) => a + b.pendingCount, 0), pend.total);
  // outstanding = the outstanding page
  const os = await s.call(sa, 'outstanding.list', {});
  assert.equal(d.kpis.outstanding.totalPaise, os.summary.total.totalPaise);
  assert.equal(d.kpis.overdue.totalPaise, os.summary.overdue.totalPaise);
  // the previous period is the same number of days just before
  assert.equal(d.prevRange.to, RW.addDays(d.range.from, -1));
  assert.equal(RW.diffDays(d.prevRange.to, d.prevRange.from) + 1, d.range.days);
  assert.equal(d.charts.daily14.length, 14);
  assert.equal(d.charts.monthly12.length, 12);
  assert.equal(d.charts.balanceTrend30.length, 30);
  assert.equal(d.charts.balanceTrend30[29].balancePaise, d.kpis.cashInHandPaise, 'the trend ends at today\'s cash in hand');
  assert.ok(d.feed.length > 0 && d.feed.every((f) => !['LOGIN', 'LOGOUT', 'PDF'].includes(f.action)));
  assert.ok(d.alerts.length > 0 && d.alerts.every((a) => ['bad', 'warn', 'info'].includes(a.level) && a.title && a.href));
  const rank = { bad: 0, warn: 1, info: 2 };
  assert.deepEqual(d.alerts.map((a) => rank[a.level]), d.alerts.map((a) => rank[a.level]).sort(), 'most serious first');

  // other ranges; "all" has nothing to compare with
  for (const key of ['today', 'week', 'year', 'all']) assert.equal((await s.call(ceo, 'ceo.dashboard', { range: key })).range.key, key);
  assert.equal((await s.call(ceo, 'ceo.dashboard', { range: 'all' })).kpis.prev, null);
  assert.equal((await s.call(ceo, 'ceo.dashboard', { range: 'nonsense' })).range.key, 'month', 'unknown range falls back to this month');
});

test('ceo.dashboard: reacts to what happens — review, Not valid, negative cash, big payment, failed sign-ins, corrections', async () => {
  const s = await fresh();
  const sa = await login(s, 'MAIN', 'admin', 'Admin@1234'), ceo = await login(s, 'MAIN', 'ceo'), rahul = await login(s, 'INDORE', 'indore.accountant');
  const before = await s.call(ceo, 'ceo.dashboard', { range: 'month' });

  const big = (await s.call(rahul, 'vouchers.create', { type: 'PAYMENT', partyName: 'Big Spend Traders', particulars: 'Large purchase', amount: '9500000' })).voucher;
  let d = await s.call(ceo, 'ceo.dashboard', { range: 'month' });
  assert.equal(d.review.pendingCount, before.review.pendingCount + 1);
  assert.equal(d.kpis.outPaise, before.kpis.outPaise + 950000000);
  const nLarge = (x) => { const a = x.alerts.find((y) => /large payment/.test(y.title)); return a ? parseInt(a.title, 10) : 0; };
  assert.equal(nLarge(d), nLarge(before) + 1, 'one more payment above the alert limit (₹50,000)');
  assert.ok(d.largePayments.length <= 5 && d.largePayments.every((v, i, a) => !i || a[i - 1].amountPaise >= v.amountPaise), 'the biggest first');
  assert.ok(d.topParties.some((x) => x.name === 'Big Spend Traders'));

  // "Not valid" is not an expense: totals fall back, the amount shows under Not valid
  await s.call(sa, 'vouchers.review', { id: big.id, status: 'INVALID', reason: 'Fake bill, no receipt' });
  d = await s.call(ceo, 'ceo.dashboard', { range: 'month' });
  assert.equal(d.kpis.outPaise, before.kpis.outPaise);
  assert.equal(d.kpis.notValidPaise, 950000000);
  assert.equal(d.kpis.notValidCount, 1);
  assert.equal(d.review.pendingCount, before.review.pendingCount, 'a reviewed payment leaves the queue');
  assert.ok(d.interventions.notValid >= 1);
  assert.ok(d.alerts.some((a) => /Not valid/.test(a.title)));

  // corrections by the main admin are counted
  const v2 = (await s.call(rahul, 'vouchers.create', { type: 'PAYMENT', partyName: 'Small', particulars: 'Tea', amount: '50' })).voucher;
  await s.call(sa, 'vouchers.edit', { id: v2.id, reason: 'Number corrected', patch: { number: 'CPV-888888' } });
  await s.call(sa, 'vouchers.void', { id: v2.id, reason: 'Entered by mistake' });
  d = await s.call(ceo, 'ceo.dashboard', { range: 'month' });
  assert.equal(d.interventions.edit, before.interventions.edit + 1);
  assert.equal(d.interventions.renumber, before.interventions.renumber + 1);
  assert.equal(d.interventions.void, before.interventions.void + 1);
  assert.ok(d.alerts.some((a) => /correction/.test(a.title)));

  // a register that goes below zero is flagged
  assert.equal(d.negativeRegisters.length, before.negativeRegisters.length, 'no register is newly below zero yet');
  // a brand-new user (opening cash ₹0) pays a supplier → the register is ₹500 below zero
  const nu = await s.call(sa, 'users.create', { fullName: 'Neha Joshi Two', username: 'neha.two', email: 'n2@x.com', branchId: 'br_indore', role: 'USER', password: 'Passw0rd1' });
  const nt = await login(s, 'INDORE', 'neha.two', 'Passw0rd1');
  await s.call(nt, 'vouchers.create', { type: 'PAYMENT', partyName: 'Tea Stall', particulars: 'Tea and snacks for the team', amount: '500' });
  void nu;
  d = await s.call(ceo, 'ceo.dashboard', { range: 'month' });
  assert.ok(d.negativeRegisters.some((r) => r.name === 'Neha Joshi Two' && r.balancePaise === -50000), 'the new user is ₹500 below zero');
  assert.equal(d.alerts[0].level, 'bad', 'serious things come first');
  assert.ok(d.alerts.some((a) => /below zero/.test(a.title)));
  assert.equal(d.kpis.cashInHandPaise, (await s.call(sa, 'registers.list', {})).rows.reduce((a, r) => a + r.balancePaise, 0), 'still equals the sum of all registers');

  // failed sign-ins in the last 24 hours show up
  for (let i = 0; i < 3; i++) await rejects(s.call(null, 'auth.login', { branchCode: 'INDORE', identifier: 'neha.joshi', password: 'wrong-' + i }, { device: 't' }), 'UNAUTHENTICATED');
  d = await s.call(ceo, 'ceo.dashboard', { range: 'month' });
  assert.equal(d.security.failedLogins24h, 3);
  assert.ok(d.alerts.some((a) => /failed sign-in/.test(a.title)));
});
