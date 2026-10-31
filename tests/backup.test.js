// Backup file, restore, the reminder, and the copies a self-hosted server keeps by itself.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const RW = require('./load.js');
const { createApp } = require('../server/index.js');
const { FileStorage } = require('../server/storage.js');

const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
const PAY = (n, extra) => Object.assign({ type: 'PAYMENT', partyName: 'Supplier ' + n, particulars: 'Purchase of pipes ' + n, amount: '100' }, extra || {});
const rejects = (p, code, re) => assert.rejects(p, (e) => { assert.equal(e.code, code, 'expected ' + code + ' got ' + e.code + ': ' + e.message); if (re) assert.match(e.message, re); return true; });

async function fresh(o) {
  const server = RW.createServer(Object.assign({ storage: new RW.MemoryStorage(), hashIterations: 1000 }, o || {}));
  await RW.seedDemo(server, { adminActions: true });
  return server;
}
async function login(server, branch, user, pw) {
  return (await server.call(null, 'auth.login', { branchCode: branch, identifier: user, password: pw || 'Ravi@1234' }, { device: 'test' })).token;
}
const adminLogin = (s) => login(s, 'MAIN', 'admin', 'Admin@1234');
const RESTORE = (file, extra) => Object.assign({ backup: file, password: 'Admin@1234', confirm: 'RESTORE' }, extra || {});
// re-seal a file after the test edits its data (a real backup is sealed by the app)
async function seal(file) { file.checksum = await RW.sha256Hex(JSON.stringify(file.data)); return file; }
const wire = (x) => JSON.parse(JSON.stringify(x));      // what a file looks like after it has been saved and opened again

test('backup file: everything in one sealed JSON, without sessions, photos optional', async () => {
  const s = await fresh();
  const sa = await adminLogin(s);
  const v = (await s.call(sa, 'vouchers.create', PAY(1, { attachments: [{ name: 'r.png', dataUrl: PNG }] }))).voucher;
  const { file, name } = await s.call(sa, 'backup.export', {});
  assert.match(name, /^ravi-cash-backup-\d{4}-\d{2}-\d{2}-\d{4}\.json$/);
  assert.equal(file.format, 'ravi-cash-backup');
  assert.equal(file.version, 1);
  assert.equal(file.includesPhotos, true);
  assert.equal(file.photoCount, 1);
  assert.ok(file.createdBy);
  assert.match(file.checksum, /^[0-9a-f]{64}$/);
  assert.equal(file.checksum, await RW.sha256Hex(JSON.stringify(wire(file.data))), 'the seal survives saving and opening the file');
  assert.equal(file.counts.vouchers, (await s.raw()).vouchers.length);
  assert.ok(file.data.db.vouchers.some((x) => x.id === v.id));
  assert.equal(Object.keys(file.data.kv).filter((k) => k.startsWith('att:')).length, 1);
  assert.equal(file.data.db.sessions, undefined, 'nobody\'s sign-in session is in the file');
  assert.equal(file.data.db.loginFails, undefined);
  assert.ok(file.data.db.users.every((u) => u.pwHash && !('password' in u)), 'password hashes, never passwords');
  // without photos
  const lite = (await s.call(sa, 'backup.export', { photos: false })).file;
  assert.equal(lite.includesPhotos, false);
  assert.equal(Object.keys(lite.data.kv).filter((k) => k.startsWith('att:')).length, 0);
  assert.equal(lite.photoCount, 0);
  // taking a backup is itself on the record
  const aud = await s.call(sa, 'audit.list', { filters: { action: 'BACKUP' }, pageSize: 10 });
  assert.ok(aud.total >= 2);
});

test('backup: only the Super Admin can take or restore one', async () => {
  const s = await fresh();
  const sa = await adminLogin(s);
  const { file } = await s.call(sa, 'backup.export', {});
  for (const [branch, user] of [['MAIN', 'ceo'], ['MAIN', 'main.manager'], ['MAIN', 'main.accountant'], ['NAGPUR', 'nagpur.auditor']]) {
    const t = await login(s, branch, user);
    for (const m of ['backup.info', 'backup.export', 'backup.list']) await rejects(s.call(t, m, {}), 'FORBIDDEN');
    await rejects(s.call(t, 'backup.restore', RESTORE(file)), 'FORBIDDEN');
    await rejects(s.call(t, 'backup.configure', { remindDays: 3 }), 'FORBIDDEN');
  }
  await rejects(s.call(null, 'backup.export', {}), 'UNAUTHENTICATED');
});

test('restore: puts back what was erased (vouchers, numbers of money, photos) and says so in the audit trail', async () => {
  const s = await fresh();
  const sa = await adminLogin(s);
  const keepV = (await s.call(sa, 'vouchers.create', PAY(1, { attachments: [{ name: 'r.png', dataUrl: PNG }] }))).voucher;
  const { file } = await s.call(sa, 'backup.export', {});
  const sealed = wire(file);
  const before = await s.raw();
  const nBefore = before.vouchers.length;
  const kpi = (await s.call(sa, 'dashboard.get', { range: 'all' })).kpis;

  // somebody erases it all by mistake
  await s.call(sa, 'vouchers.purge', { ids: [keepV.id], reason: 'by mistake' });
  await s.call(sa, 'system.clear', { scope: 'TRANSACTIONS', confirm: 'DELETE ALL', password: 'Admin@1234' });
  assert.equal((await s.raw()).vouchers.length, 0);
  assert.equal(await s.helpers.storage.get('att:' + before.attachments.find((a) => a.voucherId === keepV.id).id), null, 'the photo file is gone too');

  const r = await s.call(sa, 'backup.restore', RESTORE(sealed, { reason: 'undo the clear' }));
  assert.equal(r.ok, true);
  assert.equal(r.before.vouchers, 0);
  assert.equal(r.after.vouchers, nBefore);
  assert.equal(r.signedOut, false);
  assert.equal(r.photosRestored, 1);
  const now = await s.raw();
  assert.equal(now.vouchers.length, nBefore);
  assert.ok(now.vouchers.some((v) => v.id === keepV.id));
  assert.deepEqual((await s.call(sa, 'dashboard.get', { range: 'all' })).kpis, kpi, 'the books are exactly as they were');
  const att = now.attachments.find((a) => a.voucherId === keepV.id);
  assert.equal(await s.helpers.storage.get('att:' + att.id), PNG, 'the receipt photo is back');
  // the audit trail says what happened, and its hash chain still checks out
  const au = await s.call(sa, 'audit.list', { filters: { action: 'RESTORE' }, pageSize: 5 });
  assert.equal(au.total, 1);
  assert.equal(au.rows[0].reason, 'undo the clear');
  assert.equal(au.rows[0].old.vouchers, 0);
  assert.equal(au.rows[0].new.vouchers, nBefore);
  assert.equal((await s.call(sa, 'audit.verify', {})).ok, true);
  // everybody who looks at the system is told
  const ceo = await login(s, 'MAIN', 'ceo');
  assert.ok((await s.call(ceo, 'notifications.list', {})).rows.some((n) => /restored from a backup/i.test(n.title)), 'the CEO is told');
  // and work goes on: the next voucher gets a fresh id and number
  const next = (await s.call(sa, 'vouchers.create', PAY(2))).voucher;
  assert.ok(!before.vouchers.some((x) => x.id === next.id));
});

test('restore: password again, the word RESTORE, wrong passwords lock it, and nothing changes on any refusal', async () => {
  const s = await fresh();
  const sa = await adminLogin(s);
  const { file } = await s.call(sa, 'backup.export', {});
  const sealed = wire(file);
  await s.call(sa, 'vouchers.create', PAY(9));
  const n = (await s.raw()).vouchers.length;
  await rejects(s.call(sa, 'backup.restore', RESTORE(sealed, { confirm: '' })), 'VALIDATION', /RESTORE/);
  await rejects(s.call(sa, 'backup.restore', RESTORE(sealed, { confirm: 'yes' })), 'VALIDATION', /RESTORE/);
  await rejects(s.call(sa, 'backup.restore', { confirm: 'RESTORE', password: 'Admin@1234' }), 'VALIDATION', /Choose a backup file/);
  for (let i = 0; i < 5; i++) await rejects(s.call(sa, 'backup.restore', RESTORE(sealed, { password: 'wrong-' + i })), 'VALIDATION', /incorrect/);
  await rejects(s.call(sa, 'backup.restore', RESTORE(sealed)), 'RATE_LIMIT');           // even the right password is refused for a few minutes
  assert.equal((await s.raw()).vouchers.length, n, 'nothing was restored');
  assert.ok((await s.call(sa, 'audit.list', { filters: { action: 'RESTORE_FAILED' }, pageSize: 10 })).total >= 5, 'every wrong try is on record');
});

test('restore: a damaged, edited, foreign or too-new file is refused before anything is touched', async () => {
  const s = await fresh();
  const sa = await adminLogin(s);
  const { file } = await s.call(sa, 'backup.export', {});
  const n = (await s.raw()).vouchers.length;
  const run = (f) => s.call(sa, 'backup.restore', RESTORE(f));

  const edited = wire(file); edited.data.db.vouchers[0].amountPaise += 100;                  // somebody changed an amount
  await rejects(run(edited), 'VALIDATION', /damaged or was changed/);
  const cut = wire(file); delete cut.checksum;
  await rejects(run(cut), 'VALIDATION', /no checksum/);
  const foreign = { hello: 'world' };
  await rejects(run(foreign), 'VALIDATION', /not a Ravi Cash backup/);
  const newer = wire(file); newer.version = 2;
  await rejects(run(newer), 'VALIDATION', /newer Ravi Cash/);
  const nodata = wire(file); delete nodata.data;
  await rejects(run(nodata), 'VALIDATION', /incomplete/);

  // structure problems that were sealed properly (a hand-made or broken file)
  const broken = async (mut, re) => { const f = wire(file); mut(f.data.db); await seal(f); await rejects(run(f), 'VALIDATION', re); };
  await broken((db) => { delete db.vouchers; }, /"vouchers" is missing/);
  await broken((db) => { db.vouchers.push(db.vouchers[0]); }, /appears twice/);
  await broken((db) => { db.vouchers[0].amountPaise = 1.5; }, /invalid amount/);
  await broken((db) => { db.users[0].role = 'KING'; }, /unknown role/);
  await broken((db) => { for (const u of db.users) if (u.role === 'SUPER_ADMIN') u.status = 'INACTIVE'; }, /no active Super Admin/);
  const withJunk = wire(file); withJunk.data.kv['../../etc/passwd'] = 'x'; await seal(withJunk);
  await rejects(run(withJunk), 'VALIDATION', /unexpected/);
  const badPhoto = wire(file); badPhoto.data.kv['att:zzz'] = 'not a data url'; await seal(badPhoto);
  await rejects(run(badPhoto), 'VALIDATION', /photo is not valid/);

  assert.equal((await s.raw()).vouchers.length, n, 'nothing was touched');
  // the same checks run in the browser to preview a file
  await assert.rejects(RW.Backup.checkFile(edited), /damaged or was changed/);
  assert.equal((await RW.Backup.checkFile(wire(file))).db.vouchers.length, n);
});

test('restore: old numbers are never handed out twice, signed-in people stay signed in, and an older file is brought up to date', async () => {
  const s = await fresh();
  const sa = await adminLogin(s);
  const staff = await login(s, 'MAIN', 'main.accountant');
  const { file } = await s.call(sa, 'backup.export', {});
  const sealed = wire(file);
  const was = (await s.raw()).counters;
  // work carried on after the backup: three more payments
  const made = [];
  for (let i = 0; i < 3; i++) made.push((await s.call(sa, 'vouchers.create', PAY(20 + i))).voucher);
  const lastNo = made[2].number;
  await s.call(sa, 'backup.restore', RESTORE(sealed));
  const st = await s.raw();
  assert.equal(st.vouchers.some((v) => made.some((m) => m.id === v.id)), false, 'those three are gone, as the backup is older');
  assert.equal(st.counters.PAYMENT, was.PAYMENT + 3, 'but their numbers stay used');
  const next = (await s.call(sa, 'vouchers.create', PAY(30))).voucher;
  assert.notEqual(next.number, lastNo);
  assert.ok(next.number > lastNo, 'the next number is after the last one that was ever given out');
  // nobody was signed out
  assert.equal((await s.call(staff, 'auth.me', {})).user.username, 'main.accountant');
  assert.ok((await s.call(sa, 'auth.me', {})).user);

  // a file from an older version (no tours, no meetings, no seq entries, thin settings) still restores and is completed
  const old = wire(file);
  delete old.data.db.tours; delete old.data.db.visits; delete old.data.db.seq.tour; delete old.data.db.seq.visit; old.data.db.settings = { company: { name: 'OLD CO' } };
  await seal(old);
  await s.call(sa, 'backup.restore', RESTORE(old));
  const cur = await s.raw();
  assert.deepEqual(cur.tours, []); assert.deepEqual(cur.visits, []);
  assert.equal(cur.seq.tour, 0);
  assert.equal(cur.settings.company.name, 'OLD CO');
  assert.equal(cur.settings.numbering.PAYMENT.prefix, 'CPV');
  assert.ok(cur.settings.maxAttachments > 0, 'missing settings get their defaults');
  assert.ok((await s.call(sa, 'dashboard.get', { range: 'all' })).kpis, 'the app still works on it');
});

test('restore: if the backup has no account for you, you are signed out and must use the backup\'s sign-ins', async () => {
  const s = await fresh();
  const sa = await adminLogin(s);
  const { file } = await s.call(sa, 'backup.export', {});
  // a backup from before this person became a Super Admin: another active Super Admin exists, this account does not
  const f = wire(file);
  const me = f.data.db.users.find((u) => u.username === 'admin');
  const other = Object.assign({}, me, { id: 'u_other', username: 'other.admin', email: 'other@example.com' });
  f.data.db.users = f.data.db.users.filter((u) => u.id !== me.id).concat([other]);
  f.data.db.registers = f.data.db.registers.filter((r) => r.userId !== me.id);
  await seal(f);
  const r = await s.call(sa, 'backup.restore', RESTORE(f));
  assert.equal(r.signedOut, true);
  await rejects(s.call(sa, 'auth.me', {}), 'UNAUTHENTICATED');
});

test('reminder: the dashboard asks for a backup until one is taken; the days are the Super Admin\'s choice', async () => {
  let now = Date.parse('2026-10-01T06:00:00Z');
  const s = await fresh({ now: () => now });
  const sa = await adminLogin(s);
  let sa2 = sa;
  const dash = async () => { sa2 = await adminLogin(s); return (await s.call(sa2, 'dashboard.get', { range: 'all' })).backup; };
  let b = await dash();
  assert.equal(b.due, true, 'never backed up, and there is data');
  assert.equal(b.lastAt, null);
  assert.equal(b.remindDays, 7);
  await s.call(sa, 'backup.export', {});
  b = await dash();
  assert.equal(b.due, false);
  assert.ok(b.lastBy);
  now += 6 * 864e5; assert.equal((await dash()).due, false, '6 days later: not yet');
  now += 2 * 864e5; assert.equal((await dash()).due, true, '8 days later: remind');
  await s.call(await adminLogin(s), 'backup.configure', { remindDays: 15 });
  assert.equal((await dash()).due, false);
  assert.equal((await dash()).remindDays, 15);
  await s.call(await adminLogin(s), 'backup.configure', { remindDays: 0 });
  now += 100 * 864e5; assert.equal((await dash()).due, false, '0 = never remind');
  const sa3 = await adminLogin(s);
  await rejects(s.call(sa3, 'backup.configure', { remindDays: 5 }), 'VALIDATION');
  await rejects(s.call(sa3, 'backup.configure', { remindDays: 'x' }), 'VALIDATION');
  // only the main admin sees the reminder
  const ceo = await login(s, 'MAIN', 'ceo');
  assert.equal((await s.call(ceo, 'dashboard.get', { range: 'all' })).backup, undefined);
  // an empty system has nothing to back up, so no nagging
  const e = RW.createServer({ storage: new RW.MemoryStorage(), hashIterations: 1000 });
  const set = await e.call(null, 'system.setup', { companyName: 'Test Company', branchName: 'Main Branch', branchCode: 'MAIN', fullName: 'Owner', email: 'o@example.com', username: 'owner', password: 'Strong#2026' });
  assert.equal((await e.call(set.token, 'dashboard.get', { range: 'all' })).backup.due, false);
  const info = await e.call(set.token, 'backup.info', {});
  assert.equal(info.auto.supported, false, 'the in-browser demo has no server copies');
  assert.deepEqual(await e.call(set.token, 'backup.list', {}), { supported: false, rows: [] });
});

/* ===================================================================== self-hosted server */
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'rw-bk-'));
const SETUP = { companyName: 'Ravi Water Flow Pump', branchName: 'Ravi Water Flow Pump - Rajkot', branchCode: 'RAJKOT', fullName: 'Owner One', email: 'owner@example.com', username: 'owner', password: 'Strong#2026' };
async function boot(dir, o) {
  const app = createApp(Object.assign({ dataDir: dir, staticDir: path.join(__dirname, '..', 'app'), iterations: 1000, log: () => {}, autoSnapshotMs: 0 }, o || {}));
  const addr = await app.listen(0, '127.0.0.1');
  const base = 'http://127.0.0.1:' + addr.port;
  const call = async (token, method, params) => {
    const r = await fetch(base + '/api/call', { method: 'POST', headers: Object.assign({ 'Content-Type': 'application/json' }, token ? { Authorization: 'Bearer ' + token } : {}), body: JSON.stringify({ method, params: params || {} }) });
    return Object.assign({ status: r.status }, await r.json());
  };
  const ok = async (token, method, params) => { const r = await call(token, method, params); assert.equal(r.ok, true, method + ' -> ' + JSON.stringify(r.error)); return r.data; };
  return { app, base, call, ok };
}

test('server: full copies cost no disk and survive the erase; daily copy is taken once a day and old ones are removed', async () => {
  const dir = tmp();
  const st = new FileStorage(dir, { backupEveryMs: 0 });
  await st.set('db', { v: 1, rev: 1, n: 'one' });
  await st.set('att:a1', PNG);
  await st.set('loc', { users: { u1: { lat: 1 } } });
  await st.set('trail:2026-10-30', { u1: [[1, 2]] });
  const rel = await st.snapshot('daily', { keep: 2 });
  assert.match(rel, /^backups\/daily-\d{8}-\d{6}$/);
  const dbA = fs.statSync(path.join(dir, 'db.json')), dbB = fs.statSync(path.join(dir, rel, 'db.json'));
  if (process.platform !== 'win32') assert.equal(dbA.ino, dbB.ino, 'hard-linked: no second copy on the disk');
  // erase everything in the live folder: the copy still has it all
  await st.del('att:a1'); await st.set('db', { v: 1, rev: 2, n: 'two' });
  const c = await st.readBackup(path.basename(rel));
  assert.equal(c.full, true);
  assert.equal(c.db.n, 'one');
  assert.equal(c.kv['att:a1'], PNG);
  assert.deepEqual(Object.keys(c.kv).sort(), ['att:a1', 'loc', 'trail:2026-10-30']);
  // listing
  const list = await st.listBackups();
  const row = list.find((x) => x.id === path.basename(rel));
  assert.equal(row.kind, 'daily'); assert.equal(row.full, true); assert.equal(row.photos, 1);
  assert.ok(list.some((x) => x.kind === 'auto'), 'the hourly rolling copy is listed too');
  assert.equal((await st.readBackup(list.find((x) => x.kind === 'auto').id)).full, false);
  // ids are strict: nothing outside backups/ can be reached
  for (const bad of ['../db', '..', 'x/../../db', 'daily-1-2', 'db-20260101-000000.json', '']) await assert.rejects(st.readBackup(bad), /Bad backup id|not found/i);
  await assert.rejects(st.readBackup('daily-20200101-000000'), /not found/i);
  // once a day
  assert.equal(await st.autoSnapshot(), null, 'a daily copy was taken moments ago');
  fs.renameSync(path.join(dir, rel), path.join(dir, 'backups', 'daily-20200101-000000'));
  assert.match(await st.autoSnapshot(), /backups\/daily-/);
  assert.equal((await st.listBackups()).filter((x) => x.kind === 'daily').length, 2);
  fs.mkdirSync(path.join(dir, 'backups', 'daily-20200102-000000', 'kv'), { recursive: true }); fs.writeFileSync(path.join(dir, 'backups', 'daily-20200102-000000', 'db.json'), '{}');
  fs.mkdirSync(path.join(dir, 'backups', 'daily-20200103-000000', 'kv'), { recursive: true }); fs.writeFileSync(path.join(dir, 'backups', 'daily-20200103-000000', 'db.json'), '{}');
  await st.snapshot('daily', { keep: 2 });
  assert.equal((await st.listBackups()).filter((x) => x.kind === 'daily').length, 2, 'only the newest ones are kept');
  // a safety copy is not repeated within the gap
  assert.match(await st.safetyCopy('before-erase', { minGapMs: 60000 }), /before-erase-/);
  assert.equal(await st.safetyCopy('before-erase', { minGapMs: 60000 }), null);
  await st.close();
});

test('server: erasing for good keeps a full copy first, and that copy restores the voucher AND its photo with no file', async () => {
  const dir = tmp(); const { app, ok, call } = await boot(dir);
  try {
    const setup = await ok(null, 'system.setup', SETUP);
    const t = setup.token;
    const v = (await ok(t, 'vouchers.create', PAY(1, { attachments: [{ name: 'r.png', dataUrl: PNG }] }))).voucher;
    await ok(t, 'vouchers.create', PAY(2));
    const attId = (await ok(t, 'vouchers.get', { id: v.id })).attachments[0].id;
    assert.deepEqual((await ok(t, 'backup.list', {})).rows.filter((r) => r.kind === 'before-erase'), []);

    await ok(t, 'vouchers.purge', { ids: [v.id], reason: 'wrong one' });
    assert.equal(fs.existsSync(path.join(dir, 'kv', 'att__' + attId + '.json')), false, 'the photo file is really gone');
    const list = (await ok(t, 'backup.list', {}));
    assert.equal(list.supported, true);
    const copy = list.rows.find((r) => r.kind === 'before-erase');
    assert.ok(copy && copy.full && copy.photos === 1, 'a full copy was made before the erase');

    // restore it, no file needed
    await call(t, 'backup.restoreCopy', { id: copy.id, confirm: 'RESTORE', password: 'wrong' }).then((r) => assert.equal(r.status, 422));
    const r = await ok(t, 'backup.restoreCopy', { id: copy.id, confirm: 'RESTORE', password: SETUP.password, reason: 'undo' });
    assert.equal(r.after.vouchers, 2);
    assert.match(r.safetyCopy, /^backups\/before-restore-/, 'what was there is kept before it is replaced');
    assert.equal((await ok(t, 'vouchers.get', { id: v.id })).voucher.id, v.id);
    assert.equal(fs.existsSync(path.join(dir, 'kv', 'att__' + attId + '.json')), true, 'the photo is back');
    assert.equal(await app.storage.get('att:' + attId), PNG);
    // downloading a copy gives the normal backup file
    const dl = await ok(t, 'backup.get', { id: copy.id });
    assert.equal(dl.file.format, 'ravi-cash-backup'); assert.equal(dl.file.source, 'server-copy'); assert.equal(dl.file.includesPhotos, true);
    assert.equal((await RW.Backup.checkFile(wire(dl.file))).db.vouchers.length, 2);
    // ids that are not copies are refused
    for (const id of ['../db', 'nope', 'db-20200101-000000']) { const x = await call(t, 'backup.get', { id }); assert.equal(x.ok, false); assert.ok([404, 422].includes(x.status), id + ' -> ' + x.status); }
  } finally { await app.close(); }
});

test('server: a file restore keeps a full copy of the current data first, and the data survives a server restart', async () => {
  const dir = tmp(); let h = await boot(dir);
  let t;
  try {
    t = (await h.ok(null, 'system.setup', SETUP)).token;
    await h.ok(t, 'vouchers.create', PAY(1));
    const { file } = await h.ok(t, 'backup.export', {});
    const sealed = wire(file);
    await h.ok(t, 'vouchers.create', PAY(2));
    await h.ok(t, 'vouchers.create', PAY(3));
    const r = await h.ok(t, 'backup.restore', RESTORE(sealed, { password: SETUP.password }));
    assert.equal(r.after.vouchers, 1);
    const kept = JSON.parse(fs.readFileSync(path.join(dir, r.safetyCopy, 'db.json'), 'utf8'));
    assert.equal(kept.vouchers.length, 3, 'the three vouchers from before the restore are in the safety copy');
    assert.equal((await h.ok(t, 'backup.list', {})).rows.filter((x) => x.kind === 'before-restore').length, 1);
  } finally { await h.app.close(); }
  h = await boot(dir);
  try {
    assert.equal((await h.ok(t, 'vouchers.list', {})).total, 1, 'restored data is on disk');
  } finally { await h.app.close(); }
});

test('server: a big backup file (over the usual 16 MB) is accepted from the Super Admin for restore only', async () => {
  const dir = tmp(); const { app, base, ok, call } = await boot(dir);
  try {
    const t = (await ok(null, 'system.setup', SETUP)).token;
    await ok(t, 'vouchers.create', PAY(1));
    const info = await ok(t, 'backup.info', {});
    assert.equal(info.maxFileMb, 100);
    const { file } = await ok(t, 'backup.export', { photos: false });
    const big = wire(file);
    big.data.kv['att:orphan1'] = 'data:image/png;base64,' + 'A'.repeat(17 * 1024 * 1024);      // 17 MB: over the normal limit
    await seal(big);
    const post = (token, method, params) => fetch(base + '/api/call', { method: 'POST', headers: Object.assign({ 'Content-Type': 'application/json' }, token ? { Authorization: 'Bearer ' + token } : {}), body: JSON.stringify({ method, params }) })
      .then(async (r) => ({ status: r.status, body: await r.json().catch(() => null) })).catch((e) => ({ status: 0, error: e.message }));
    // somebody who is not signed in, or not the Super Admin, cannot push that much
    const anon = await post(null, 'backup.restore', RESTORE(big, { password: SETUP.password }));
    assert.ok(anon.status === 413 || anon.status === 0, 'anonymous big body refused (' + anon.status + ')');
    // any other method with a big body is refused even for the Super Admin
    const other = await post(t, 'vouchers.create', Object.assign(PAY(5), { particulars: 'x'.repeat(17 * 1024 * 1024) }));
    assert.ok(other.status === 413 || other.status === 0, 'other methods keep the 16 MB limit (' + other.status + ')');
    // the Super Admin restoring: accepted
    const good = await post(t, 'backup.restore', RESTORE(big, { password: SETUP.password }));
    assert.equal(good.status, 200, JSON.stringify(good.body && good.body.error));
    assert.equal(good.body.data.photosRestored, 1);
    assert.equal((await app.storage.get('att:orphan1')).length > 17e6, true);
  } finally { await app.close(); }
});

test('server: the daily full copy is taken by the timer, by itself', async () => {
  const dir = tmp(); const { app, ok } = await boot(dir, { autoSnapshotMs: 50 });
  try {
    const t = (await ok(null, 'system.setup', SETUP)).token;
    await ok(t, 'vouchers.create', PAY(1));
    // the first check runs 15 s after start; call the same code path directly instead of waiting
    const r = await app.storage.autoSnapshot();
    assert.match(r, /^backups\/daily-/);
    const rows = (await ok(t, 'backup.list', {})).rows;
    assert.ok(rows.some((x) => x.kind === 'daily' && x.full));
    const info = await ok(t, 'backup.info', {});
    assert.equal(info.auto.supported, true);
  } finally { await app.close(); }
});
