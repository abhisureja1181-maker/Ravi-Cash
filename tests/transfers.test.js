// Money sent from one branch to another is a TRANSFER: neither expense nor income. Registers still move, "on the way" money is shown,
// and the company's Cash In / Cash Out stay exactly what they were.
const test = require('node:test');
const assert = require('node:assert/strict');
const RW = require('./load.js');

async function fresh() {
  const server = RW.createServer({ storage: new RW.MemoryStorage(), hashIterations: 1000 });
  await RW.seedDemo(server, { adminActions: true, transfers: false });   // start without the demo's own sample transfers
  return server;
}
async function login(server, branch, user, pw) {
  const r = await server.call(null, 'auth.login', { branchCode: branch, identifier: user, password: pw || 'Ravi@1234' }, { device: 'test' });
  return r.token;
}
const rejects = (p, code) => assert.rejects(p, (e) => { assert.equal(e.code, code, 'expected ' + code + ' got ' + e.code + ': ' + e.message); return true; });
const PAY = (extra) => Object.assign({ type: 'PAYMENT', date: RW.today(Date.now()), partyName: 'Some Party', particulars: 'Money for the branch', amount: '10000' }, extra);

async function world() {
  const s = await fresh();
  return {
    s,
    sa: await login(s, 'MAIN', 'admin', 'Admin@1234'),
    main: await login(s, 'MAIN', 'main.accountant'),
    mgr: await login(s, 'INDORE', 'indore.manager'),
    rahul: await login(s, 'INDORE', 'indore.accountant'),
    ceo: await login(s, 'MAIN', 'ceo'),
  };
}
const company = async (w) => (await w.s.call(w.sa, 'dashboard.get', { range: 'all', branchId: 'all' })).kpis;
const cashInHand = async (w) => (await w.s.call(w.sa, 'ceo.dashboard', { range: 'all' })).kpis;
const bal = async (w, tok) => (await w.s.call(tok, 'auth.me', {})).register.balancePaise;

test('transfer: sending to a branch and receiving it leaves Cash In / Cash Out unchanged and moves the cash', async () => {
  const w = await world();
  const before = await company(w), cashBefore = await cashInHand(w);
  const mainBal = await bal(w, w.main), indoreBal = await bal(w, w.rahul);

  // 1. head office sends 10,000 to Indore (no person named: anyone in Indore may receive it)
  const sent = (await w.s.call(w.main, 'vouchers.create', PAY({ transfer: { toBranchId: 'br_indore' } }))).voucher;
  assert.ok(sent.number.startsWith('CPV'), 'a transfer-out still has a normal payment voucher number');
  assert.equal(sent.transfer.dir, 'OUT');
  assert.equal(sent.transfer.pending, true);
  assert.match(sent.partyName, /Indore/);
  assert.equal(await bal(w, w.main), mainBal - 1000000, 'the sender register paid it out');

  let c = await company(w);
  assert.equal(c.outPaise, before.outPaise, 'a transfer is not an expense');
  assert.equal(c.inPaise, before.inPaise);
  assert.equal(c.xOutPaise, 1000000);
  assert.equal(c.balancePaise, before.balancePaise - 1000000, 'the money has left a register ...');
  const mid = await w.s.call(w.sa, 'dashboard.get', { range: 'all', branchId: 'all' });
  assert.equal(mid.transit.paise, 1000000, '... and is shown as on the way');
  assert.equal(mid.transit.count, 1);
  assert.equal((await cashInHand(w)).transitPaise, 1000000);

  // 2. Indore sees it waiting, and a person of Indore receives it
  const pend = await w.s.call(w.rahul, 'transfers.pending', {});
  assert.equal(pend.rows.length, 1);
  assert.equal(pend.rows[0].amountPaise, 1000000);
  assert.equal(pend.totalPaise, 1000000);
  assert.equal((await w.s.call(w.main, 'transfers.pending', {})).rows.length, 0, 'the sender has nothing to receive');
  const note = await w.s.call(w.rahul, 'notifications.list', {});
  assert.ok(note.rows.some((n) => n.kind === 'TRANSFER_SENT'), 'the receiving branch is told');

  const got = (await w.s.call(w.rahul, 'vouchers.create', { type: 'RECEIPT', kind: 'RECEIVED', date: RW.today(Date.now()), partyName: 'ignored', amount: '10000', transfer: { link: sent.id } })).voucher;
  assert.equal(got.transfer.dir, 'IN');
  assert.equal(got.transfer.linkNumber, sent.number);
  assert.match(got.partyName, /Suresh Mehta/);
  assert.equal(got.number, '', 'Cash Received has no number');
  assert.equal(await bal(w, w.rahul), indoreBal + 1000000, 'the receiver register got it');

  c = await company(w);
  assert.equal(c.inPaise, before.inPaise, 'receiving it is not income');
  assert.equal(c.outPaise, before.outPaise);
  assert.equal(c.xInPaise, 1000000);
  assert.equal(c.xOutPaise, 1000000);
  assert.equal(c.balancePaise, before.balancePaise, 'company cash in hand is back to what it was');
  assert.equal((await cashInHand(w)).cashInHandPaise, cashBefore.cashInHandPaise);
  const after = await w.s.call(w.sa, 'dashboard.get', { range: 'all', branchId: 'all' });
  assert.equal(after.transit.count, 0);
  assert.equal((await w.s.call(w.rahul, 'transfers.pending', {})).rows.length, 0);
  // the sender is told it arrived
  assert.ok((await w.s.call(w.main, 'notifications.list', {})).rows.some((n) => n.kind === 'TRANSFER_RECEIVED'));
});

test('transfer: every branch and the company still add up (in, out, transfers and balance)', async () => {
  const w = await world();
  const sent = (await w.s.call(w.main, 'vouchers.create', PAY({ amount: '2500.50', transfer: { toBranchId: 'br_indore' } }))).voucher;
  await w.s.call(w.rahul, 'vouchers.create', { type: 'RECEIPT', date: RW.today(Date.now()), amount: '2500.50', transfer: { link: sent.id }, particulars: 'Cash from head office' });   // a numbered receipt works too
  await w.s.call(w.mgr, 'vouchers.create', PAY({ amount: '700', transfer: { toBranchId: 'br_main' } }));      // Indore sends something back, still on the way
  const all = await w.s.call(w.sa, 'dashboard.get', { range: 'all', branchId: 'all' });
  const parts = await Promise.all(['main', 'br_indore', 'br_nagpur'].map((b) => w.s.call(w.sa, 'dashboard.get', { range: 'all', branchId: b })));
  for (const k of ['inPaise', 'outPaise', 'xInPaise', 'xOutPaise', 'netPaise', 'balancePaise']) {
    assert.equal(parts.reduce((a, d) => a + d.kpis[k], 0), all.kpis[k], k + ' adds up across branches');
  }
  const indore = parts[1];
  assert.equal(indore.kpis.xInPaise, 250050);
  assert.equal(indore.kpis.xOutPaise, 70000);
  assert.equal(indore.transit.count, 1, 'the 700 Indore sent is on its way to Main');
  // the books: branch row and its users add up, balance includes transfers
  const b = indore.books.branches.find((x) => x.id === 'br_indore');
  assert.equal(b.users.reduce((a, x) => a + x.balancePaise, 0), b.balancePaise);
  assert.equal(b.users.reduce((a, x) => a + x.xInPaise, 0), b.xInPaise);
  assert.equal(b.balancePaise, b.openingPaise + b.inPaise - b.outPaise + b.xInPaise - b.xOutPaise);
  // the line chart ends at the cash in hand
  const last = (d) => d.charts.balanceTrend30[d.charts.balanceTrend30.length - 1].balancePaise;
  assert.equal(last(all), all.kpis.balancePaise);
  assert.equal(last(indore), indore.kpis.balancePaise);
  // reports: net = in - out; balance includes the transfers
  const rep = await w.s.call(w.sa, 'reports.branches', { preset: 'month' });
  for (const r of rep.rows) assert.equal(r.netPaise, r.inPaise - r.outPaise);
});

test('transfer: the receiver can only take what was sent to them, once, for exactly that amount', async () => {
  const w = await world();
  const sent = (await w.s.call(w.main, 'vouchers.create', PAY({ transfer: { toBranchId: 'br_indore' } }))).voucher;
  const rcv = (amount, tok, link) => w.s.call(tok || w.rahul, 'vouchers.create', { type: 'RECEIPT', kind: 'RECEIVED', date: RW.today(Date.now()), partyName: 'x', amount, transfer: { link: link || sent.id } });
  await rejects(rcv('9000'), 'VALIDATION');                                  // wrong amount
  await rejects(rcv('10000', await login(w.s, 'NAGPUR', 'nagpur.accountant')), 'FORBIDDEN');     // another branch
  await rejects(rcv('10000', w.main), 'FORBIDDEN');                          // the sender's own branch
  await rejects(rcv('10000', w.rahul, 'v_nothing'), 'CONFLICT');             // no such transfer
  const ok = (await rcv('10000')).voucher;
  await rejects(rcv('10000', w.mgr), 'CONFLICT');                            // already received
  // voiding the receiving entry puts the money back "on the way"
  await w.s.call(w.sa, 'vouchers.void', { id: ok.id, reason: 'Entered by mistake' });
  assert.equal((await w.s.call(w.rahul, 'transfers.pending', {})).rows.length, 1);
  assert.equal((await w.s.call(w.sa, 'dashboard.get', { range: 'all' })).transit.count, 1);
  // marking the payment "Not valid" cancels the transfer: nothing left to receive and the sender has the cash back
  const balBefore = await bal(w, w.main);
  await w.s.call(w.sa, 'vouchers.review', { id: sent.id, status: 'INVALID', reason: 'Wrong amount typed' });
  assert.equal((await w.s.call(w.rahul, 'transfers.pending', {})).rows.length, 0);
  assert.equal(await bal(w, w.main), balBefore + 1000000);
  await rejects(rcv('10000'), 'CONFLICT');
});

test('transfer: sending needs a sensible address; a named person is the only one who can receive', async () => {
  const w = await world();
  const t = await w.s.call(w.main, 'transfers.targets', {});
  const indore = t.branches.find((b) => b.id === 'br_indore');
  assert.ok(indore.people.length >= 2 && indore.people.every((p) => p.id && p.name));
  assert.ok(t.branches.find((b) => b.isMain).mine);
  assert.ok(!t.branches.find((b) => b.mine).people.some((p) => p.name === 'Suresh Mehta'), 'you are not offered yourself');
  // the main admin correcting an old entry asks as the person who made it: "own branch" and "yourself" are then that person's
  const asRahul = await w.s.call(w.sa, 'transfers.targets', { asUserId: 'u_indore' });
  assert.equal(asRahul.branches.find((b) => b.mine).id, 'br_indore');
  assert.ok(!asRahul.branches.find((b) => b.mine).people.some((p) => p.id === 'u_indore'));
  assert.equal((await w.s.call(w.main, 'transfers.targets', { asUserId: 'u_indore' })).branches.find((b) => b.mine).id, 'br_main', 'only the main admin can ask on someone else’s behalf');
  await rejects(w.s.call(w.main, 'vouchers.create', PAY({ transfer: {} })), 'VALIDATION');
  await rejects(w.s.call(w.main, 'vouchers.create', PAY({ transfer: { toBranchId: 'br_main' } })), 'VALIDATION');                 // own branch needs a person
  await rejects(w.s.call(w.main, 'vouchers.create', PAY({ transfer: { toBranchId: 'br_indore', toUserId: 'u_nagpur_x' } })), 'VALIDATION');
  await rejects(w.s.call(w.ceo, 'vouchers.create', PAY({ transfer: { toBranchId: 'br_indore' } })), 'FORBIDDEN');
  const mgrPerson = indore.people.find((p) => p.role === 'BRANCH_ADMIN');
  const sent = (await w.s.call(w.main, 'vouchers.create', PAY({ transfer: { toBranchId: 'br_indore', toUserId: mgrPerson.id } }))).voucher;
  assert.match(sent.partyName, new RegExp(mgrPerson.name));
  assert.equal((await w.s.call(w.rahul, 'transfers.pending', {})).rows.length, 0, 'a colleague does not see money addressed to the manager');
  assert.equal((await w.s.call(w.mgr, 'transfers.pending', {})).rows.length, 1);
  await rejects(w.s.call(w.rahul, 'vouchers.create', { type: 'RECEIPT', kind: 'RECEIVED', date: RW.today(Date.now()), amount: '10000', transfer: { link: sent.id } }), 'FORBIDDEN');
  await w.s.call(w.mgr, 'vouchers.create', { type: 'RECEIPT', kind: 'RECEIVED', date: RW.today(Date.now()), amount: '10000', transfer: { link: sent.id } });
});

test('transfer: the main admin can mark an old payment and receipt as a transfer, and take the mark off', async () => {
  const w = await world();
  const before = await company(w);
  // two ordinary entries that really were a transfer: a payment in Main and a "cash received" in Indore
  const pay = (await w.s.call(w.main, 'vouchers.create', PAY({ amount: '5000' }))).voucher;
  const rec = (await w.s.call(w.rahul, 'vouchers.create', { type: 'RECEIPT', kind: 'RECEIVED', date: RW.today(Date.now()), partyName: 'Head office', amount: '5000' })).voucher;
  let c = await company(w);
  assert.equal(c.outPaise, before.outPaise + 500000);
  assert.equal(c.inPaise, before.inPaise + 500000, 'before the fix they look like expense and income');
  const edit = (id, transfer) => w.s.call(w.sa, 'vouchers.edit', { id, reason: 'This was money sent to the branch', patch: { transfer } });
  await rejects(w.s.call(w.main, 'vouchers.edit', { id: pay.id, reason: 'try it', patch: { transfer: { toBranchId: 'br_indore' } } }), 'FORBIDDEN');
  const p2 = (await edit(pay.id, { toBranchId: 'br_indore' })).voucher;
  assert.equal(p2.transfer.dir, 'OUT');
  assert.equal(p2.transfer.pending, false, 'marked as already received by default');
  await edit(rec.id, { fromBranchId: 'br_main' });
  c = await company(w);
  assert.equal(c.outPaise, before.outPaise);
  assert.equal(c.inPaise, before.inPaise);
  assert.equal(c.xOutPaise, 500000);
  assert.equal(c.xInPaise, 500000);
  assert.equal((await w.s.call(w.sa, 'dashboard.get', { range: 'all' })).transit.count, 0);
  // the change is written to the audit trail
  const tl = (await w.s.call(w.sa, 'vouchers.get', { id: pay.id })).timeline.find((x) => x.action === 'EDIT');
  assert.match(tl.new.transfer, /Transfer to .*Indore/);
  assert.equal(tl.old.transfer, 'Not a transfer');
  // taking the mark off puts them back as expense / income
  await edit(pay.id, null);
  await edit(rec.id, null);
  c = await company(w);
  assert.equal(c.outPaise, before.outPaise + 500000);
  assert.equal(c.inPaise, before.inPaise + 500000);
  // a receipt can also be linked to a payment that is still on the way
  const open = (await w.s.call(w.main, 'vouchers.create', PAY({ amount: '300', transfer: { toBranchId: 'br_indore' } }))).voucher;
  const rec2 = (await w.s.call(w.rahul, 'vouchers.create', { type: 'RECEIPT', kind: 'RECEIVED', date: RW.today(Date.now()), partyName: 'Head office', amount: '300' })).voucher;
  await edit(rec2.id, { link: open.id });
  assert.equal((await w.s.call(w.rahul, 'transfers.pending', {})).rows.length, 0);
  await rejects(edit(open.id, null), 'VALIDATION');                          // it was received: first take the mark off the receipt
  await rejects(edit(open.id, { toBranchId: 'br_nagpur' }), 'VALIDATION');
});

test('transfer: lists can show transfers only / waiting ones, and statements keep the register balance right', async () => {
  const w = await world();
  const sent = (await w.s.call(w.main, 'vouchers.create', PAY({ transfer: { toBranchId: 'br_indore' } }))).voucher;
  const l = await w.s.call(w.sa, 'vouchers.list', { filters: { transfer: 'ANY' }, pageSize: 50 });
  assert.deepEqual(l.rows.map((v) => v.id), [sent.id]);
  assert.equal(l.totals.xOutPaise, 1000000);
  assert.equal(l.totals.outPaise, 0);
  assert.equal(l.totals.movePaise, -1000000);
  assert.equal((await w.s.call(w.sa, 'vouchers.list', { filters: { transfer: 'PENDING' } })).total, 1);
  assert.equal((await w.s.call(w.sa, 'vouchers.list', { filters: { transfer: 'NONE' } })).rows.some((v) => v.transfer), false);
  await w.s.call(w.rahul, 'vouchers.create', { type: 'RECEIPT', kind: 'RECEIVED', date: RW.today(Date.now()), amount: '10000', transfer: { link: sent.id } });
  assert.equal((await w.s.call(w.sa, 'vouchers.list', { filters: { transfer: 'PENDING' } })).total, 0);
  // the register statement is the physical cash ledger: transfers are inside it, marked, and it still adds up
  const me = await w.s.call(w.main, 'auth.me', {});
  const reg = await w.s.call(w.main, 'register.get', { userId: me.user.id, from: '2000-01-01', to: RW.today(Date.now()) });
  const row = reg.rows.find((r) => r.id === sent.id);
  assert.equal(row.transfer.dir, 'OUT');
  assert.equal(reg.xOutPaise, 1000000);
  assert.equal(reg.openingPaise + reg.inPaise - reg.outPaise, reg.closingPaise);
  assert.equal(reg.closingPaise, reg.currentBalancePaise);
  const regs = await w.s.call(w.sa, 'registers.list', {});
  for (const r of regs.rows) assert.equal(r.balancePaise, r.openingPaise + r.inPaise - r.outPaise, 'register list reconciles');
  // exports keep Cash In / Out columns equal to the totals, with transfers in their own columns
  const ex = await w.s.call(w.sa, 'export.vouchers', { filters: {} });
  assert.equal(ex.rows.reduce((a, r) => a + (r.cashOut || 0), 0) * 100, ex.totals.outPaise);
  assert.equal(ex.rows.reduce((a, r) => a + (r.transferOut || 0), 0) * 100, ex.totals.xOutPaise);
});

test('transfer: a backup keeps transfers and restoring it gives back the same books', async () => {
  const w = await world();
  const sent = (await w.s.call(w.main, 'vouchers.create', PAY({ transfer: { toBranchId: 'br_indore' } }))).voucher;
  await w.s.call(w.rahul, 'vouchers.create', { type: 'RECEIPT', kind: 'RECEIVED', date: RW.today(Date.now()), amount: '10000', transfer: { link: sent.id } });
  const book = await w.s.call(w.sa, 'dashboard.get', { range: 'all', branchId: 'all' });
  const file = (await w.s.call(w.sa, 'backup.export', { photos: false })).file;
  const w2 = await world();
  await w2.s.call(w2.sa, 'backup.restore', { backup: JSON.parse(JSON.stringify(file)), password: 'Admin@1234', confirm: 'RESTORE' });
  const sa2 = await login(w2.s, 'MAIN', 'admin', 'Admin@1234');
  const again = await w2.s.call(sa2, 'dashboard.get', { range: 'all', branchId: 'all' });
  for (const k of ['inPaise', 'outPaise', 'xInPaise', 'xOutPaise', 'balancePaise']) assert.equal(again.kpis[k], book.kpis[k], k);
  assert.equal(again.transit.count, 0);
});

test('demo data: ships with one received and one on-the-way transfer that add up', async () => {
  const server = RW.createServer({ storage: new RW.MemoryStorage(), hashIterations: 1000 });
  await RW.seedDemo(server, { adminActions: true });
  const sa = await login(server, 'MAIN', 'admin', 'Admin@1234');
  const d = await server.call(sa, 'dashboard.get', { range: 'all', branchId: 'all' });
  assert.equal(d.transit.count, 1, 'the Nagpur transfer is still on the way');
  assert.equal(d.transit.paise, 1200000);
  assert.equal(d.kpis.xInPaise, 2500000);
  assert.equal(d.kpis.xOutPaise, 3700000);
  const nagpur = await login(server, 'NAGPUR', 'nagpur.accountant');
  assert.equal((await server.call(nagpur, 'transfers.pending', {})).rows.length, 1);
  const indore = await login(server, 'INDORE', 'indore.accountant');
  assert.equal((await server.call(indore, 'transfers.pending', {})).rows.length, 0, 'Indore received its transfer already');
  const rows = (await server.call(sa, 'vouchers.list', { filters: { transfer: 'ANY' }, pageSize: 50 })).rows;
  assert.equal(rows.length, 3);
  assert.ok(rows.some((v) => v.transfer.dir === 'IN' && v.transfer.linkNumber));
});
