// The Live Map's background: tiles come through this server (same origin), so the browser's Referer no longer matters.
// The map provider is played by a small local HTTP server here — the real OpenStreetMap is never contacted by the tests.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const RW = require('./load.js');
const { createApp } = require('../server/index.js');
const { createTiles } = require('../server/tiles.js');

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'rw-tile-'));
const SETUP = { companyName: 'Ravi Water Flow Pump', branchName: 'Ravi Water Flow Pump - Rajkot', branchCode: 'RAJKOT', fullName: 'Owner One', email: 'owner@example.com', username: 'owner', password: 'Strong#2026' };

/* the "map provider" */
async function provider() {
  const seen = [];
  const st = { mode: 'ok', delay: 0, running: 0, peak: 0 };
  const srv = http.createServer(async (req, res) => {
    seen.push({ url: req.url, ua: req.headers['user-agent'] || '', referer: req.headers.referer || '' });
    st.running++; st.peak = Math.max(st.peak, st.running);
    if (st.delay) await new Promise((r) => setTimeout(r, st.delay));
    st.running--;
    if (st.mode === 'block') { res.writeHead(403, { 'Content-Type': 'image/png' }); return res.end(PNG); }          // what OSM does: a 403 with a picture
    if (st.mode === 'down') return req.socket.destroy();
    if (st.mode === 'html') { res.writeHead(200, { 'Content-Type': 'text/html' }); return res.end('<html>nope</html>'); }
    res.writeHead(200, { 'Content-Type': 'image/png' }); res.end(PNG);
  });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  return { seen, st, url: 'http://127.0.0.1:' + srv.address().port + '/{z}/{x}/{y}.png', close: () => new Promise((r) => srv.close(r)) };
}
async function boot(o) {
  const dir = tmp();
  const up = await provider();
  const app = createApp(Object.assign({ dataDir: dir, staticDir: path.join(__dirname, '..', 'app'), iterations: 1000, log: () => {}, autoSnapshotMs: 0, tileUpstream: up.url }, o || {}));
  const addr = await app.listen(0, '127.0.0.1');
  const base = 'http://127.0.0.1:' + addr.port;
  const call = async (token, method, params) => (await fetch(base + '/api/call', { method: 'POST', headers: Object.assign({ 'Content-Type': 'application/json' }, token ? { Authorization: 'Bearer ' + token } : {}), body: JSON.stringify({ method, params: params || {} }) })).json();
  const token = (await call(null, 'system.setup', SETUP)).data.token;
  const cfg = (await call(token, 'map.config', {})).data;
  return { app, up, dir, base, call, token, cfg, tile: (z, x, y, k, init) => fetch(base + '/tiles/' + z + '/' + x + '/' + y + '.png' + (k === undefined ? '?k=' + cfg.key : k === null ? '' : '?k=' + k), init),
    close: async () => { await app.close(); await up.close(); } };
}

test('map.config: a signed-in person gets the server\'s tile address key; the browser demo has none; anonymous people get nothing', async () => {
  const t = await boot();
  try {
    assert.equal(t.cfg.proxy, true);
    assert.match(t.cfg.key, /^[0-9a-z]{6,12}\.[0-9a-f]{32}$/);
    assert.equal((await t.call(null, 'map.config', {})).ok, false, 'not signed in: no key');
    // the browser demo (no server) has no proxy
    const demo = RW.createServer({ storage: new RW.MemoryStorage(), hashIterations: 1000 });
    await RW.seedDemo(demo, { adminActions: true });
    const tk = (await demo.call(null, 'auth.login', { branchCode: 'MAIN', identifier: 'admin', password: 'Admin@1234' })).token;
    assert.deepEqual(await demo.call(tk, 'map.config', {}), { proxy: false });
    // a server started with the proxy switched off says so
    const off = await boot({ mapProxy: false });
    try { assert.deepEqual(off.cfg, { proxy: false }); assert.equal((await off.tile(5, 1, 1)).status, 404); } finally { await off.close(); }
  } finally { await t.close(); }
});

test('tile proxy: the provider gets a proper User-Agent and Referer, the browser needs neither, and the answer is a PNG', async () => {
  const t = await boot();
  try {
    const r = await t.tile(12, 2931, 1862);
    assert.equal(r.status, 200);
    assert.equal(r.headers.get('content-type'), 'image/png');
    assert.match(r.headers.get('cache-control'), /max-age=\d+/);
    assert.equal(r.headers.get('x-content-type-options'), 'nosniff');
    assert.deepEqual(Buffer.from(await r.arrayBuffer()), PNG);
    assert.equal(t.up.seen.length, 1);
    assert.equal(t.up.seen[0].url, '/12/2931/1862.png');
    assert.match(t.up.seen[0].ua, /^RaviCash-LiveMap\/\d/, 'the provider is told which application this is');
    assert.match(t.up.seen[0].referer, /^http:\/\/127\.0\.0\.1:\d+\/$/, 'and which site it is for');
    // the browser asked with NO Referer at all (file://, privacy tools ...) and still got its tile
    const noRef = await t.tile(12, 2931, 1862, undefined, { headers: { Referer: '' }, referrerPolicy: 'no-referrer' });
    assert.equal(noRef.status, 200);
    // kept: the second request, a second browser, a restart of the server — none asks the provider again
    assert.equal(t.up.seen.length, 1, 'served from the cache');
    assert.ok(fs.existsSync(path.join(t.dir, 'tiles', '12', '2931', '1862.png')), 'kept on disk for a week');
    const h = await t.tile(12, 2931, 1862, undefined, { method: 'HEAD' });
    assert.equal(h.status, 200); assert.equal((await h.arrayBuffer()).byteLength, 0);
    // the site address can be told explicitly (PUBLIC_URL)
    process.env.PUBLIC_URL = 'https://ravi-cash.example.org';
    try { await t.tile(12, 2931, 1863); } finally { delete process.env.PUBLIC_URL; }
    assert.equal(t.up.seen[1].referer, 'https://ravi-cash.example.org/');
  } finally { await t.close(); }
});

test('tile proxy: it is not an open proxy — no key, a wrong or expired key, odd paths and impossible tiles are refused without asking the provider', async () => {
  const t = await boot();
  try {
    assert.equal((await t.tile(5, 1, 1, null)).status, 403);
    assert.equal((await t.tile(5, 1, 1, 'abc')).status, 403);
    const [exp, sig] = t.cfg.key.split('.');
    assert.equal((await t.tile(5, 1, 1, exp + '.' + '0'.repeat(32))).status, 403, 'forged signature');
    assert.equal((await t.tile(5, 1, 1, (parseInt(exp, 36) + 3600000).toString(36) + '.' + sig)).status, 403, 'a longer life than it was given');
    assert.equal(t.app.tiles.verifyKey(t.cfg.key, parseInt(exp, 36) + 1), false, 'expired');
    assert.equal(t.app.tiles.verifyKey(t.cfg.key), true);
    assert.equal(t.app.tiles.issueKey(), t.cfg.key, 'the same key for 4 hours, so the browser can keep its tiles');
    assert.notEqual(t.app.tiles.issueKey(Date.now() + 9 * 3600000), t.cfg.key);
    for (const [z, x, y] of [[20, 1, 1], [3, 8, 0], [3, 0, 8], [0, 1, 0]]) assert.equal((await t.tile(z, x, y)).status, 404, [z, x, y].join('/'));
    for (const bad of ['/tiles/../etc/passwd', '/tiles/5/1/1.png/../../x', '/tiles/5/1/1.jpg', '/tiles/5/a/1.png', '/tiles/%2e%2e/1/1.png']) {
      const r = await fetch(t.base + bad + (bad.includes('?') ? '' : '?k=' + t.cfg.key)); assert.ok(r.status === 404 || r.status === 400, bad + ' -> ' + r.status);
    }
    assert.equal((await t.tile(5, 1, 1, undefined, { method: 'POST' })).status, 405);
    assert.equal(t.up.seen.length, 0, 'the provider was never asked for any of these');
    // and every refusal is an ordinary answer, not a crash
    assert.equal((await t.call(t.token, 'auth.me', {})).ok, true);
  } finally { await t.close(); }
});

test('tile proxy: one download per tile however many ask, at most two at a time, failures are not hammered, an old tile beats no tile', async () => {
  const t = await boot();
  try {
    // ten browsers ask for the same new tile at once: one request to the provider
    t.up.st.delay = 60;
    const same = await Promise.all(Array.from({ length: 10 }, () => t.tile(9, 100, 200)));
    assert.deepEqual(same.map((r) => r.status), Array(10).fill(200));
    assert.equal(t.up.seen.length, 1);
    // eight different tiles at once: never more than two downloads running
    t.up.seen.length = 0;
    const many = await Promise.all(Array.from({ length: 8 }, (_, i) => t.tile(10, 300 + i, 300)));
    assert.deepEqual(many.map((r) => r.status), Array(8).fill(200));
    assert.equal(t.up.seen.length, 8);
    assert.ok(t.up.st.peak <= 2, 'at most 2 at a time, saw ' + t.up.st.peak);
    // the provider refuses ("Access blocked"): the browser sees a clean 502, and the same tile is not asked for again at once
    t.up.st.delay = 0; t.up.st.mode = 'block'; t.up.seen.length = 0;
    assert.equal((await t.tile(11, 5, 5)).status, 502);
    assert.equal((await t.tile(11, 5, 5)).status, 502);
    assert.equal(t.up.seen.length, 1, 'remembered for a minute instead of asking again');
    // a provider that answers with a web page, or goes away, is also a clean 502
    t.up.st.mode = 'html'; assert.equal((await t.tile(11, 6, 5)).status, 502);
    t.up.st.mode = 'down'; assert.equal((await t.tile(11, 7, 5)).status, 502);
    // it recovers by itself afterwards (other tiles work again at once)
    t.up.st.mode = 'ok'; assert.equal((await t.tile(11, 8, 5)).status, 200);
  } finally { await t.close(); }
});

test('tile proxy: a tile older than a week is refreshed, and if the provider is gone the old one is still served', async () => {
  const t = await boot({ tileTtlMs: 1 });
  try {
    assert.equal((await t.tile(8, 3, 3)).status, 200);
    await new Promise((r) => setTimeout(r, 20));
    t.up.st.mode = 'down';
    const r = await t.tile(8, 3, 3);                       // the memory copy is fresh enough for the same process; clear it to force the disk path
    assert.equal(r.status, 200);
    const fresh = createTiles({ dir: path.join(t.dir, 'tiles'), upstream: t.up.url, ttlMs: 1, log: () => {} });
    const out = { status: 0, body: null };
    const res = { writeHead(c) { out.status = c; }, end(b) { out.body = b; } };
    await fresh.handle({ method: 'GET' }, res, new URL('http://x/tiles/8/3/3.png?k=' + fresh.issueKey()), { text: () => { out.status = 'text'; }, secHeaders: (x) => x, ip: '1.1.1.1', referer: 'http://x/' });
    assert.equal(out.status, 200, 'the provider is down, the week-old tile is served');
    assert.deepEqual(out.body, PNG);
    assert.equal(fresh.stats.stale, 1);
  } finally { await t.close(); }
});

test('tile proxy: the disk cache stays small — the oldest tiles go first', async () => {
  const dir = tmp();
  const up = await provider();
  const tiles = createTiles({ dir, upstream: up.url, maxDisk: 20, maxMem: 5, log: () => {} });
  try {
    const h = { text: () => {}, secHeaders: (x) => x, ip: '9.9.9.9', referer: 'http://x/' };
    for (let i = 0; i < 40; i++) {
      await tiles.handle({ method: 'GET' }, { writeHead() {}, end() {} }, new URL('http://x/tiles/9/' + i + '/1.png?k=' + tiles.issueKey()), h);
      if (i === 0) await new Promise((r) => setTimeout(r, 15));
    }
    tiles.prune();
    let n = 0; for (const z of fs.readdirSync(dir)) for (const x of fs.readdirSync(path.join(dir, z))) n += fs.readdirSync(path.join(dir, z, x)).length;
    assert.ok(n <= 20, 'kept ' + n);
    assert.ok(n >= 10, 'but not emptied: ' + n);
  } finally { await up.close(); }
});

test('the service worker leaves map tiles to the browser cache, and the page may load them from its own address', async () => {
  const t = await boot();
  try {
    const sw = fs.readFileSync(path.join(__dirname, '..', 'app', 'sw.js'), 'utf8');
    assert.match(sw, /startsWith\('\/tiles\/'\)\) return/);
    const idx = await fetch(t.base + '/');
    assert.match(idx.headers.get('content-security-policy'), /img-src 'self'/);
  } finally { await t.close(); }
});
