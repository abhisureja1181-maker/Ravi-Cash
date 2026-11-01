'use strict';
/* Same-origin map tile proxy for the Live Map.
 *
 * Why: OpenStreetMap's public tile servers refuse a request that arrives without a Referer ("Access blocked — tile usage policy").
 * Whether a phone or a PC sends that Referer depends on the browser, privacy tools, an antivirus, a sandboxed preview, ...
 * — things this app cannot control. So the browser asks THIS server for tiles (same origin: nothing to block), and the server
 * fetches them with a proper User-Agent and Referer, keeps what it fetched (memory + disk, a week) and so also asks the provider far less.
 *
 *   GET /tiles/{z}/{x}/{y}.png?k=KEY      KEY comes from the signed-in-only API call `map.config` and is valid for 4–8 hours,
 *                                         so this is not an open proxy for the whole internet.
 *
 * Limits that keep us a polite client of a volunteer-run service: 2 downloads at a time, one download per tile (concurrent
 * requests for the same tile share it), failures are remembered for a minute instead of retried at once, and tiles are only
 * ever fetched for the zoom levels and positions a real map asks for.
 */
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const TILE_RE = /^\/tiles\/(\d{1,2})\/(\d{1,8})\/(\d{1,8})\.png$/;
const STEP = 4 * 3600 * 1000;           // a key is the same for 4 hours (so the browser can keep tiles) and valid for 4 to 8 hours

function createTiles(o) {
  o = o || {};
  const dir = o.dir;
  const upstream = String(o.upstream || 'https://tile.openstreetmap.org/{z}/{x}/{y}.png');
  const ttlMs = o.ttlMs === undefined ? 7 * 864e5 : o.ttlMs;
  const maxMem = o.maxMem || 400, maxDisk = o.maxDisk || 4000;
  const threads = Math.max(1, o.threads || 2);
  const timeoutMs = o.timeoutMs || 8000;
  const doFetch = o.fetch || globalThis.fetch;
  const log = o.log || (() => {});
  const contact = String(o.contact || '').replace(/[^\x20-\x7e]/g, '').slice(0, 120);
  const secret = crypto.randomBytes(32);

  const mem = new Map();                // tile -> { buf, type }   (least recently used first)
  const failed = new Map();             // tile -> time until which we do not ask the provider again
  const inflight = new Map();           // tile -> Promise of { buf, type }
  const stats = { memory: 0, disk: 0, fetched: 0, failed: 0, stale: 0 };
  let active = 0, writes = 0, lastWarn = 0;
  const waiting = [];
  const hits = new Map();

  /* ---------------------------------------------------------------- keys */
  const sign = (exp) => crypto.createHmac('sha256', secret).update('tiles:' + exp).digest('hex').slice(0, 32);
  function issueKey(now) { const exp = (Math.floor((now || Date.now()) / STEP) + 2) * STEP; return exp.toString(36) + '.' + sign(exp); }
  function verifyKey(k, now) {
    const m = /^([0-9a-z]{6,12})\.([0-9a-f]{32})$/.exec(String(k || ''));
    if (!m) return false;
    const exp = parseInt(m[1], 36);
    if (!(exp > (now || Date.now()))) return false;
    return crypto.timingSafeEqual(Buffer.from(sign(exp)), Buffer.from(m[2]));
  }

  /* ------------------------------------------------------- polite client */
  const slot = () => new Promise((res, rej) => {
    if (active < threads) { active++; res(); return; }
    if (waiting.length > 150) { rej(new Error('busy')); return; }
    waiting.push(res);
  });
  const release = () => { const n = waiting.shift(); if (n) n(); else active--; };
  const warn = (...a) => { const t = Date.now(); if (t - lastWarn > 60000) { lastWarn = t; log(...a); } };

  function rateLimited(ip) {
    const now = Date.now();
    let r = hits.get(ip);
    if (!r || r.until < now) { r = { n: 0, until: now + 60000 }; hits.set(ip, r); if (hits.size > 2000) for (const [k, v] of hits) if (v.until < now) hits.delete(k); }
    return ++r.n > 3000;
  }

  /* ------------------------------------------------------------ the cache */
  const file = (z, x, y) => path.join(dir, String(z), String(x), y + '.png');
  function remember(id, v) { mem.delete(id); mem.set(id, v); if (mem.size > maxMem) mem.delete(mem.keys().next().value); }

  function prune() {
    try {
      const all = [];
      for (const z of fs.readdirSync(dir)) for (const x of fs.readdirSync(path.join(dir, z))) for (const f of fs.readdirSync(path.join(dir, z, x))) {
        const p = path.join(dir, z, x, f);
        try { all.push([p, fs.statSync(p).mtimeMs]); } catch (e) { /* gone */ }
      }
      if (all.length <= maxDisk) return;
      all.sort((a, b) => a[1] - b[1]);
      for (const [p] of all.slice(0, all.length - Math.floor(maxDisk * 0.85))) { try { fs.unlinkSync(p); } catch (e) { /* gone */ } }
    } catch (e) { /* nothing cached yet */ }
  }

  async function download(z, x, y, ctx) {
    await slot();
    try {
      const url = upstream.replace('{z}', z).replace('{x}', x).replace('{y}', y).replace('{s}', 'a').replace('{r}', '');
      const ctl = new AbortController();
      const timer = setTimeout(() => ctl.abort(), timeoutMs);
      try {
        const r = await doFetch(url, { signal: ctl.signal, redirect: 'follow', headers: {
          'User-Agent': 'RaviCash-LiveMap/5.4 (self-hosted app for a small team; +' + ctx.referer + (contact ? '; ' + contact : '') + ')',
          Referer: ctx.referer, Accept: 'image/png,image/*;q=0.8' } });
        const type = String(r.headers.get('content-type') || '');
        if (r.status !== 200 || !/^image\//i.test(type)) { warn('Map tiles: the map provider answered ' + r.status + ' (' + type.slice(0, 40) + ') for ' + url.replace(/key=[^&]+/i, 'key=…') + ' — the map background will not load until it accepts requests again.'); throw new Error('provider ' + r.status); }
        const buf = Buffer.from(await r.arrayBuffer());
        if (!buf.length || buf.length > 2 * 1024 * 1024) throw new Error('unexpected tile size');
        return { buf, type: type.split(';')[0] };
      } finally { clearTimeout(timer); }
    } finally { release(); }
  }

  async function load(z, x, y, ctx) {
    const id = z + '/' + x + '/' + y;
    const m = mem.get(id);
    if (m) { remember(id, m); stats.memory++; return m; }
    if ((failed.get(id) || 0) > Date.now()) throw new Error('recently failed');
    let stale = null;
    try {
      const f = file(z, x, y);
      const st = await fs.promises.stat(f);
      const buf = await fs.promises.readFile(f);
      const v = { buf, type: 'image/png' };
      if (Date.now() - st.mtimeMs < ttlMs) { remember(id, v); stats.disk++; return v; }
      stale = v;
    } catch (e) { /* not on disk */ }
    if (inflight.has(id)) return inflight.get(id);
    const p = (async () => {
      try {
        const v = await download(z, x, y, ctx);
        stats.fetched++;
        remember(id, v);
        try {
          const f = file(z, x, y);
          await fs.promises.mkdir(path.dirname(f), { recursive: true, mode: 0o700 });
          const tmp = f + '.' + process.pid + '.tmp';
          await fs.promises.writeFile(tmp, v.buf, { mode: 0o600 });
          await fs.promises.rename(tmp, f);
          if (++writes % 300 === 0) setImmediate(prune);
        } catch (e) { /* the disk cache is only a bonus */ }
        return v;
      } catch (e) {
        if (stale) { stats.stale++; remember(id, stale); return stale; }     // better an old tile than none
        stats.failed++;
        failed.set(id, Date.now() + 60000);
        if (failed.size > 5000) failed.clear();
        throw e;
      } finally { inflight.delete(id); }
    })();
    inflight.set(id, p);
    return p;
  }

  /* h = { text(res, code, msg), secHeaders(headers), ip, referer } */
  async function handle(req, res, url, h) {
    const m = TILE_RE.exec(url.pathname);
    if (!m) return h.text(res, 404, 'Not found');
    if (req.method !== 'GET' && req.method !== 'HEAD') return h.text(res, 405, 'Method not allowed', { Allow: 'GET, HEAD' });
    if (!verifyKey(url.searchParams.get('k'))) return h.text(res, 403, 'The map key is missing or has expired');
    const z = +m[1], x = +m[2], y = +m[3];
    if (z > 19 || x >= 2 ** z || y >= 2 ** z) return h.text(res, 404, 'No such tile');
    if (rateLimited(h.ip)) return h.text(res, 429, 'Too many map requests', { 'Retry-After': '30' });
    let v;
    try { v = await load(z, x, y, { referer: h.referer }); } catch (e) { return h.text(res, 502, 'The map provider is not reachable right now'); }
    res.writeHead(200, h.secHeaders({ 'Content-Type': v.type || 'image/png', 'Content-Length': v.buf.length, 'Cache-Control': 'private, max-age=604800' }));
    if (req.method === 'HEAD') return res.end();
    res.end(v.buf);
  }

  if (dir) { try { fs.mkdirSync(dir, { recursive: true, mode: 0o700 }); setImmediate(prune); } catch (e) { /* read-only: memory cache only */ } }
  return { handle, issueKey, verifyKey, stats, upstream, prune };
}

module.exports = { createTiles, TILE_RE };
