// End-to-end tests of the self-hosted server over real HTTP (no mocks): static hosting + security headers,
// API contract, first-run setup, live sync stream, durability across restarts, concurrency and storage safety.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const { createApp } = require('../server/index.js');
const { FileStorage } = require('../server/storage.js');
const RW = globalThis.RW;

const STATIC = path.join(__dirname, '..', 'app');
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'rw-http-'));

async function boot(dir, o) {
  const app = createApp(Object.assign({ dataDir: dir, staticDir: STATIC, iterations: 1000, freeze: true, log: () => {} }, o || {}));
  const addr = await app.listen(0, '127.0.0.1');
  const base = 'http://127.0.0.1:' + addr.port;
  const call = async (token, method, params) => {
    const r = await fetch(base + '/api/call', { method: 'POST', headers: Object.assign({ 'Content-Type': 'application/json' }, token ? { Authorization: 'Bearer ' + token } : {}), body: JSON.stringify({ method, params: params || {} }) });
    const b = await r.json();
    return { status: r.status, ...b };
  };
  const ok = async (token, method, params) => { const r = await call(token, method, params); assert.equal(r.ok, true, method + ' -> ' + JSON.stringify(r.error)); return r.data; };
  return { app, base, call, ok };
}
const SETUP = { companyName: 'Ravi Water Flow Pump', branchName: 'Ravi Water Flow Pump - Rajkot', branchCode: 'RAJKOT', fullName: 'Owner One', email: 'owner@example.com', username: 'owner', password: 'Strong#2026' };
const PAY = (n) => ({ type: 'PAYMENT', partyName: 'Supplier ' + n, particulars: 'Purchase of pipes ' + n, amount: '100' });

test('static hosting: app files, CSP with script hashes, no path traversal, config switches the app to server mode', async () => {
  const dir = tmp(); const { app, base } = await boot(dir);
  try {
    const idx = await fetch(base + '/');
    assert.equal(idx.status, 200);
    const csp = idx.headers.get('content-security-policy');
    assert.match(csp, /script-src 'self' 'sha256-/);
    assert.doesNotMatch(csp.split(';').find((x) => x.includes('script-src')), /unsafe-inline/);
    assert.match(csp, /frame-ancestors 'none'/);
    assert.equal(idx.headers.get('x-content-type-options'), 'nosniff');
    assert.equal(idx.headers.get('x-frame-options'), 'DENY');
    const html = await idx.text();
    assert.match(html, /Ravi Cash/);
    const cfg = await (await fetch(base + '/config.js')).text();
    assert.match(cfg, /"mode":"server"/);
    // revalidation
    const js = await fetch(base + '/js/app.js', { headers: { 'Accept-Encoding': 'gzip' } });
    assert.equal(js.status, 200);
    const etag = js.headers.get('etag');
    assert.equal((await fetch(base + '/js/app.js', { headers: { 'If-None-Match': etag } })).status, 304);
    // traversal attempts
    for (const p of ['/..%2f..%2fetc%2fpasswd', '/%2e%2e/%2e%2e/etc/passwd', '/js/..%2f..%2fserver%2findex.js', '/data/db.json', '/%00']) {
      const r = await fetch(base + p);
      assert.ok([400, 403, 404].includes(r.status), p + ' -> ' + r.status);
      assert.doesNotMatch(await r.text(), /root:|createApp/);
    }
    assert.equal((await fetch(base + '/api/nothing')).status, 404);
    assert.equal((await fetch(base + '/', { method: 'DELETE' })).status, 405);
  } finally { await app.close(); }
});

test('API contract: setup once, auth, errors map to HTTP codes, bad input is rejected', async () => {
  const dir = tmp(); const { app, call, ok } = await boot(dir);
  try {
    assert.equal((await ok(null, 'branches.public')).empty, true);
    const bad = await call(null, 'system.setup', Object.assign({}, SETUP, { password: 'x' }));
    assert.equal(bad.status, 422); assert.equal(bad.error.code, 'VALIDATION');
    const s = await ok(null, 'system.setup', SETUP);
    assert.ok(s.token && s.user.role === 'SUPER_ADMIN');
    const again = await call(null, 'system.setup', Object.assign({}, SETUP, { username: 'evil' }));
    assert.equal(again.status, 403);
    assert.equal((await call(null, 'auth.me')).status, 401);
    assert.equal((await call('x'.repeat(40), 'auth.me')).status, 401);
    assert.equal((await call(s.token, 'nope.nothing')).status, 404);
    assert.equal((await call(s.token, 'vouchers.get', { id: 'missing' })).status, 404);
    const wrong = await call(null, 'auth.login', { branchCode: 'RAJKOT', identifier: 'owner', password: 'wrongpass1' });
    assert.equal(wrong.status, 401);
    // malformed bodies / content types
    const raw = (body, ct) => fetch(app.httpServer.address() && `http://127.0.0.1:${app.httpServer.address().port}/api/call`, { method: 'POST', headers: { 'Content-Type': ct || 'application/json' }, body });
    assert.equal((await raw('{not json')).status, 400);
    assert.equal((await raw('{"method":"../etc/passwd"}')).status, 400);
    assert.equal((await raw('{"method":"auth.me"}', 'text/plain')).status, 415);
    // a normal user cannot reach admin methods
    const u = await ok(s.token, 'users.create', { fullName: 'Clerk One', username: 'clerk', email: 'clerk@example.com', role: 'USER', branchId: s.branch.id, password: 'Clerk#2026' });
    const lg = await ok(null, 'auth.login', { branchCode: 'RAJKOT', identifier: 'clerk', password: 'Clerk#2026' });
    assert.equal((await call(lg.token, 'users.list')).status, 403);
    assert.equal((await call(lg.token, 'audit.list')).status, 403);
    assert.equal((await call(lg.token, 'users.create', {})).status, 403);
    assert.equal(u.user.mustChangePassword, true);
  } finally { await app.close(); }
});

test('concurrent voucher creation: numbers are unique and gap-free, retries never duplicate, data survives a restart', async () => {
  const dir = tmp();
  let b = await boot(dir);
  let token, numbers;
  try {
    const s = await b.ok(null, 'system.setup', SETUP);
    token = s.token;
    // 30 parallel creations, 10 of which are retries of the same client ids
    const jobs = [];
    for (let i = 0; i < 30; i++) jobs.push(b.ok(token, 'vouchers.create', Object.assign(PAY(i), { clientId: 'c' + (i % 20) })));
    const res = await Promise.all(jobs);
    numbers = res.map((r) => r.voucher.number);
    const uniq = new Set(numbers);
    assert.equal(uniq.size, 20, 'retries with the same clientId must return the same voucher');
    const seqs = [...uniq].map((n) => parseInt(n.slice(4), 10)).sort((x, y) => x - y);
    assert.deepEqual(seqs, Array.from({ length: 20 }, (_, i) => i + 1), 'no gaps, no repeats');
    assert.equal(res.filter((r) => r.duplicate).length, 10);
    const list = await b.ok(token, 'vouchers.list', { filters: {}, page: 1, pageSize: 100 });
    assert.equal(list.total, 20);
  } finally { await b.app.close(); }
  // restart on the same data directory
  b = await boot(dir);
  try {
    const lg = await b.ok(null, 'auth.login', { branchCode: 'RAJKOT', identifier: 'owner', password: 'Strong#2026' });
    const list = await b.ok(lg.token, 'vouchers.list', { filters: {}, page: 1, pageSize: 100 });
    assert.equal(list.total, 20);
    const next = await b.ok(lg.token, 'vouchers.create', Object.assign(PAY(99), { clientId: 'after-restart' }));
    assert.equal(next.voucher.number, 'CPV-000021');
    assert.equal((await b.ok(lg.token, 'audit.verify')).ok, true);
    // the old session token still works after a restart (sessions are stored)
    assert.equal((await b.call(token, 'auth.me')).ok, true);
  } finally { await b.app.close(); }
});

test('live sync: an open stream is told when another device changes something', async () => {
  const dir = tmp(); const { app, base, ok } = await boot(dir);
  try {
    const s = await ok(null, 'system.setup', SETUP);
    const events = [];
    const req = http.get(base + '/api/events', { headers: { Authorization: 'Bearer ' + s.token } });
    const res = await new Promise((resolve, reject) => { req.on('response', resolve); req.on('error', reject); });
    assert.equal(res.statusCode, 200);
    assert.match(res.headers['content-type'], /text\/event-stream/);
    res.setEncoding('utf8'); res.on('data', (d) => events.push(d));
    await new Promise((r) => setTimeout(r, 150));
    await ok(s.token, 'vouchers.create', PAY(1));
    await new Promise((r) => setTimeout(r, 250));
    req.destroy();
    const all = events.join('');
    assert.match(all, /"type":"hello"/);
    assert.match(all, /"type":"changed","rev":\d+/);
    // no stream without a valid session
    const noauth = await fetch(base + '/api/events');
    assert.equal(noauth.status, 401);
  } finally { await app.close(); }
});

test('read-only calls never modify the shared in-memory snapshot (deep-frozen) across every screen of every role', async () => {
  const dir = tmp(); const { app, call, ok } = await boot(dir);
  try {
    // demo company on the real server storage
    await RW.seedDemo(app.server, { device: 'test', adminActions: true });
    const sa = (await ok(null, 'auth.login', { branchCode: 'MAIN', identifier: 'admin', password: 'Admin@1234' })).token;
    const mgr = (await ok(null, 'auth.login', { branchCode: 'INDORE', identifier: 'indore.manager', password: 'Ravi@1234' })).token;
    const usr = (await ok(null, 'auth.login', { branchCode: 'INDORE', identifier: 'indore.accountant', password: 'Ravi@1234' })).token;
    const vw = (await ok(null, 'auth.login', { branchCode: 'NAGPUR', identifier: 'nagpur.auditor', password: 'Ravi@1234' })).token;
    const v = (await ok(sa, 'vouchers.list', { filters: {}, page: 1, pageSize: 5 })).rows[0];
    const users = (await ok(sa, 'users.list', {})).rows;
    const reads = [
      ['auth.me', {}], ['branches.list', { preset: 'month' }], ['users.list', {}], ['settings.get', {}], ['audit.list', { filters: {} }], ['audit.verify', {}],
      ['notifications.list', {}], ['outstanding.list', { filters: {} }], ['dashboard.get', { range: 'month' }], ['dashboard.get', { range: 'year' }],
      ['reports.cash', { preset: 'month' }], ['reports.branches', { preset: 'year' }], ['reports.user', { userId: users[0].id, preset: 'year' }],
      ['search.global', { q: 'CPV' }], ['search.global', { q: 'pipe' }], ['vouchers.list', { filters: {}, page: 1, pageSize: 20 }], ['vouchers.list', { filters: { type: 'PAYMENT', q: 'a' }, page: 2, pageSize: 10 }],
      ['vouchers.get', { id: v.id }], ['attachments.list', { filters: {} }], ['registers.list', {}], ['register.get', {}], ['statements.history', {}],
    ];
    for (const token of [sa, mgr, usr, vw]) for (const [m, p] of reads) {
      const r = await call(token, m, p);
      assert.ok(r.status !== 500, m + ' crashed (status ' + r.status + '): a read tried to modify the shared snapshot? ' + JSON.stringify(r.error));
    }
    // and writes still work on top of the frozen snapshot
    const made = await ok(usr, 'vouchers.create', Object.assign(PAY('z'), { clientId: 'z1' }));
    assert.ok(made.voucher.number);
    const st = await ok(sa, 'statements.generate', { userId: users.find((u) => u.registerId).id, period: 'MONTH' });
    assert.ok(st);
    assert.equal((await ok(sa, 'audit.verify')).ok, true);
  } finally { await app.close(); }
});

test('sign-in is throttled per IP and the account locks after repeated failures', async () => {
  const dir = tmp(); const { app, call, ok } = await boot(dir);
  try {
    await ok(null, 'system.setup', SETUP);
    const codes = [];
    for (let i = 0; i < 7; i++) codes.push((await call(null, 'auth.login', { branchCode: 'RAJKOT', identifier: 'owner', password: 'bad-pass-' + i })).error.code);
    assert.deepEqual(codes.slice(0, 5), Array(5).fill('UNAUTHENTICATED'));
    assert.ok(codes.slice(5).every((c) => c === 'RATE_LIMIT'), 'locked after 5 failures: ' + codes);
    // even the right password is refused while locked
    assert.equal((await call(null, 'auth.login', { branchCode: 'RAJKOT', identifier: 'owner', password: 'Strong#2026' })).error.code, 'RATE_LIMIT');
  } finally { await app.close(); }
  const dir2 = tmp(); const b = await boot(dir2);
  try {
    let limited = 0;
    for (let i = 0; i < 45; i++) { const r = await b.call(null, 'auth.login', { branchCode: 'X', identifier: 'user' + i, password: 'whatever12' }); if (r.status === 429) limited++; }
    assert.ok(limited >= 4, 'the per-IP limiter kicks in (got ' + limited + ')');
  } finally { await b.app.close(); }
});

test('storage: atomic writes, crash recovery, single-process lock, rolling backups, bad keys', async () => {
  const dir = tmp();
  const st = new FileStorage(dir, { backupEveryMs: 0 });
  // a second process on the same data directory is refused while the first is alive
  const { spawn } = require('node:child_process');
  const child = spawn(process.execPath, ['-e', "const {FileStorage}=require(" + JSON.stringify(path.join(__dirname, '..', 'server', 'storage.js')) + ");" +
    "const s=new FileStorage(" + JSON.stringify(dir + '-lock') + ");console.log('locked');setTimeout(()=>s.release(),4000)"], { stdio: ['ignore', 'pipe', 'inherit'] });
  await new Promise((r) => child.stdout.once('data', r));
  assert.throws(() => new FileStorage(dir + '-lock'), /already in use/);
  child.kill('SIGKILL'); await new Promise((r) => child.once('exit', r));
  const afterKill = new FileStorage(dir + '-lock');          // a stale lock from a dead process does not block a restart
  await afterKill.close();
  await st.set('db', { v: 1, rev: 1, n: 'one' });
  await st.set('db', { v: 1, rev: 2, n: 'two' });
  await st.set('att:abc', 'data:image/png;base64,AAAA');
  assert.equal((await st.get('att:abc')), 'data:image/png;base64,AAAA');
  assert.deepEqual((await st.keys('att:')), ['att:abc']);
  assert.ok(fs.readdirSync(path.join(dir, 'backups')).length >= 1, 'a backup of the previous version exists');
  for (const k of ['../x', 'a/b', '', 'x'.repeat(200)]) await assert.rejects(st.get(k), /Bad storage key/);
  // reading for read-only use shares the snapshot; reading for write hands out a private copy
  const shared = await st.get('db'); const copy = await st.get('db', true);
  assert.equal(shared, await st.get('db')); assert.notEqual(copy, shared); copy.n = 'changed'; assert.equal((await st.get('db')).n, 'two');
  await st.close();
  // crash after the temp file was fully written but before the rename
  fs.writeFileSync(path.join(dir, 'db.json.tmp'), JSON.stringify({ v: 1, rev: 3, n: 'recovered' }));
  fs.unlinkSync(path.join(dir, 'db.json'));
  const st2 = new FileStorage(dir);
  assert.equal((await st2.get('db')).n, 'recovered');
  await st2.close();
  // a torn temp file is ignored when a good db.json exists
  fs.writeFileSync(path.join(dir, 'db.json.tmp'), '{"v":1,"rev":4,"n":"tor');
  const st3 = new FileStorage(dir);
  assert.equal((await st3.get('db')).n, 'recovered');
  assert.equal(fs.existsSync(path.join(dir, 'db.json.tmp')), false);
  await st3.close();
  // retention keeps the backup folder bounded
  const st4 = new FileStorage(dir, { backupEveryMs: 0 });
  for (let i = 0; i < 3; i++) { await st4.set('db', { v: 1, rev: 10 + i }); await new Promise((r) => setTimeout(r, 1100)); }
  assert.ok(fs.readdirSync(path.join(dir, 'backups')).length <= 100);
  await st4.close();
});

test('clear all data over HTTP: a full backup copy (database + receipt photos) is saved first, then the real files are gone', async () => {
  const dir = tmp(); const { app, ok } = await boot(dir);
  try {
    const setup = await ok(null, 'system.setup', SETUP);
    const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
    const v = (await ok(setup.token, 'vouchers.create', Object.assign(PAY(1), { attachments: [{ name: 'r.png', dataUrl: png }] }))).voucher;
    const attId = (await ok(setup.token, 'vouchers.get', { id: v.id })).attachments[0].id;
    const kvFiles = () => fs.readdirSync(path.join(dir, 'kv')).filter((f) => f.startsWith('att'));
    assert.equal(kvFiles().length, 1);

    const r = await ok(setup.token, 'system.clear', { scope: 'TRANSACTIONS', confirm: 'DELETE ALL', password: SETUP.password });
    assert.match(r.backup, /^backups\/before-clear-\d{8}-\d{6}$/);
    const bdir = path.join(dir, r.backup);
    const saved = JSON.parse(fs.readFileSync(path.join(bdir, 'db.json'), 'utf8'));
    assert.equal(saved.vouchers.length, 1, 'the backup holds the data as it was before');
    assert.equal(fs.readdirSync(path.join(bdir, 'kv')).filter((f) => f.startsWith('att')).length, 1, 'and the receipt photo');
    assert.equal(kvFiles().length, 0, 'the live photo file is deleted');
    assert.equal((await ok(setup.token, 'vouchers.list', { filters: {} })).total, 0);
    assert.ok(attId);
  } finally { await app.close(); }
});

test('audit review and Cash Received over HTTP: a Not valid payment stays out of the balance and a Cash Received entry stays numberless, also after a restart', async () => {
  const dir = tmp();
  let b = await boot(dir);
  let balance, rcv;
  try {
    const { token } = await b.ok(null, 'system.setup', SETUP);
    const pay = (await b.ok(token, 'vouchers.create', Object.assign(PAY(1), { amount: '400' }))).voucher;
    rcv = (await b.ok(token, 'vouchers.create', { kind: 'RECEIVED', partyName: 'Owner Cash', amount: '1000' })).voucher;
    assert.equal(rcv.number, '');
    assert.equal((await b.ok(token, 'vouchers.create', Object.assign(PAY(2), { amount: '50' }))).voucher.number, 'CPV-000002', 'Cash Received used no voucher number');
    const before = (await b.ok(token, 'register.get', {})).currentBalancePaise;
    const r = await b.ok(token, 'vouchers.review', { id: pay.id, status: 'INVALID', reason: 'Bill is not genuine' });
    assert.equal(r.voucher.counted, false);
    balance = (await b.ok(token, 'register.get', {})).currentBalancePaise;
    assert.equal(balance, before + 40000, 'the 400 is back in the cash balance');
    const again = await b.call(token, 'vouchers.review', { id: pay.id, status: 'INVALID', reason: 'again and again' });
    assert.equal(again.status, 422);
    assert.equal(again.error.code, 'VALIDATION');
  } finally { await b.app.close(); }
  b = await boot(dir);
  try {
    const lg = await b.ok(null, 'auth.login', { branchCode: 'RAJKOT', identifier: 'owner', password: 'Strong#2026' });
    assert.equal((await b.ok(lg.token, 'register.get', {})).currentBalancePaise, balance, 'the review survived the restart');
    const got = await b.ok(lg.token, 'vouchers.get', { id: rcv.id });
    assert.equal(got.voucher.kind, 'RECEIVED');
    assert.equal(got.voucher.number, '');
    assert.equal((await b.ok(lg.token, 'vouchers.list', { filters: { review: 'INVALID' } })).total, 1);
    assert.equal((await b.ok(lg.token, 'audit.verify')).ok, true);
  } finally { await b.app.close(); }
});

test('storage: a lock left over from before the last computer restart does not stop the server from starting', () => {
  const dir = tmp();
  // a "live" process number (the parent of this test) in a lock file that is older than this computer's uptime
  fs.writeFileSync(path.join(dir, '.lock'), String(process.ppid));
  fs.utimesSync(path.join(dir, '.lock'), new Date(0), new Date(0));
  const st = new FileStorage(dir, { backupEveryMs: 0 });
  assert.equal(fs.readFileSync(path.join(dir, '.lock'), 'utf8'), String(process.pid), 'the lock now belongs to the new server');
  st.release();
  // while a fresh lock held by a live process still blocks a second server
  fs.writeFileSync(path.join(dir, '.lock'), String(process.ppid));
  assert.throws(() => new FileStorage(dir, { backupEveryMs: 0 }), /already in use/);
});

test('SETUP_KEY: on a server with a setup key, only the owner can run the first-time setup', async () => {
  const dir = tmp(); const { app, call, ok } = await boot(dir, { setupKey: 'owner-secret-key' });
  try {
    const pub = await ok(null, 'branches.public', {});
    assert.equal(pub.empty, true); assert.equal(pub.setupKeyRequired, true);
    for (const bad of [undefined, '', 'guess', 'owner-secret-key ' + 'x']) {
      const r = await call(null, 'system.setup', Object.assign({}, SETUP, bad === undefined ? {} : { setupKey: bad }));
      assert.equal(r.status, 403, 'setupKey ' + JSON.stringify(bad)); assert.equal(r.error.code, 'FORBIDDEN');
    }
    assert.equal((await ok(null, 'branches.public', {})).empty, true, 'refused attempts created nothing');
    const s = await ok(null, 'system.setup', Object.assign({}, SETUP, { setupKey: '  owner-secret-key ' }));
    assert.ok(s.token);
    const after = await ok(null, 'branches.public', {});
    assert.equal(after.empty, false); assert.equal(after.setupKeyRequired, false, 'the key is no longer asked for once set up');
  } finally { await app.close(); }
});

test('SETUP_KEY: without one (home PC) nothing changes', async () => {
  const dir = tmp(); const { app, ok } = await boot(dir, { setupKey: '' });
  try {
    assert.equal((await ok(null, 'branches.public', {})).setupKeyRequired, false);
    assert.ok((await ok(null, 'system.setup', SETUP)).token);
  } finally { await app.close(); }
});
