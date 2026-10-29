#!/usr/bin/env node
'use strict';
/* Ravi Cash — self-hosted server (no npm dependencies, Node 20+).
 *
 *   node server/index.js
 *
 * It runs the very same business rules as the demo backend (authorisation, atomic numbering, voucher
 * locking, hash-chained audit) — but on the server, with durable storage — and serves the web app and the
 * installable Android app (PWA) from the same address. Every device talks to this one backend, and
 * changes are pushed to all open screens live (server-sent events).
 *
 * Environment:
 *   PORT=8080  HOST=0.0.0.0  DATA_DIR=./data  STATIC_DIR=<app or dist>
 *   TRUST_PROXY=1        read the client IP from X-Forwarded-For (only behind your own reverse proxy)
 *   PUBLIC_HTTPS=1       send HSTS (when you serve the site over HTTPS)
 *   CORS_ORIGIN=https://x  allow a separately hosted front-end to call /api
 *   PBKDF2_ITERATIONS=310000
 *   SETUP_KEY=secret     (online hosting) the first-time setup screen asks for this key, so nobody else can claim a fresh server
 *   MAP_TILE_URL=...     (optional) tile address of a map provider for the Live Map; default is OpenStreetMap
 *   SEED_DEMO=1          fill an EMPTY data directory with the demo company (for trying it out only)
 */
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');
const crypto = require('node:crypto');
const { FileStorage } = require('./storage');

const ROOT = path.join(__dirname, '..');
for (const f of ['util', 'store', 'server-core', 'server-vouchers', 'server-admin', 'server-erase', 'server-tours', 'server-location', 'seed']) require(path.join(ROOT, 'app', 'js', f + '.js'));
const RW = globalThis.RW;

const env = process.env;
const PORT = parseInt(env.PORT || '8080', 10);
const HOST = env.HOST || '0.0.0.0';
// Map background for the Live Map: OpenStreetMap by default (free, fine for a small team). For heavy use set MAP_TILE_URL to the
// address template of a tile provider you have an account with, e.g. https://api.maptiler.com/maps/streets/{z}/{x}/{y}.png?key=YOURKEY
const TILE_URL = String(env.MAP_TILE_URL || '').trim();
let TILE_HOSTS = 'https://tile.openstreetmap.org https://*.tile.openstreetmap.org';
if (TILE_URL) { try { TILE_HOSTS = new URL(TILE_URL.replace(/\{[a-z]\}/g, 'x')).origin; } catch (e) { console.error('MAP_TILE_URL is not a valid address; using OpenStreetMap'); } }
const DATA_DIR = env.DATA_DIR || path.join(ROOT, 'data');
// Serve dist/ (built by `npm run build`, versioned for the installed app) unless app/ has newer files than dist/.
function pickStatic() {
  const app = path.join(ROOT, 'app'), dist = path.join(ROOT, 'dist');
  const stamp = path.join(dist, 'version.json');
  if (!fs.existsSync(stamp)) return app;
  const built = fs.statSync(stamp).mtimeMs;
  const newest = (d) => fs.readdirSync(d, { withFileTypes: true }).reduce((m, e) => Math.max(m, e.isDirectory() ? newest(path.join(d, e.name)) : fs.statSync(path.join(d, e.name)).mtimeMs), 0);
  return newest(app) > built ? app : dist;
}
const STATIC_DIR = env.STATIC_DIR || pickStatic();
const TRUST_PROXY = env.TRUST_PROXY === '1';
const MAX_BODY = 16 * 1024 * 1024;
const ITER = parseInt(env.PBKDF2_ITERATIONS || '310000', 10);

const STATUS = { UNAUTHENTICATED: 401, ACCOUNT_DISABLED: 403, FORBIDDEN: 403, NOT_FOUND: 404, VALIDATION: 422, CONFLICT: 409, LOCKED: 423, RATE_LIMIT: 429 };

/* ------------------------------------------------------------------ core */
function createApp(opts) {
  opts = opts || {};
  const storage = opts.storage || new FileStorage(opts.dataDir || DATA_DIR, { freeze: !!opts.freeze, backupEveryMs: opts.backupEveryMs });
  const bus = RW.makeBus('rw-server', { channel: false });
  // "Clear all data" first takes a full copy (database + receipt photos) into data/backups/before-clear-<time>/
  const beforeWipe = async () => (typeof storage.snapshot === 'function' ? storage.snapshot('before-clear') : null);
  const server = RW.createServer({ storage, bus, hashIterations: opts.iterations || ITER, beforeWipe, setupKey: opts.setupKey !== undefined ? opts.setupKey : env.SETUP_KEY });
  const staticDir = opts.staticDir || STATIC_DIR;
  const trustProxy = opts.trustProxy !== undefined ? opts.trustProxy : TRUST_PROXY;
  const log = opts.log || ((...a) => console.log(new Date().toISOString(), ...a));

  /* ---- static files */
  const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.webmanifest': 'application/manifest+json',
    '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.woff': 'font/woff', '.woff2': 'font/woff2', '.ttf': 'font/ttf', '.txt': 'text/plain; charset=utf-8', '.map': 'application/json' };
  const COMPRESSIBLE = new Set(['.html', '.js', '.css', '.json', '.webmanifest', '.svg', '.txt', '.ttf']);
  const fileCache = new Map();
  let cspValue = null;
  function csp() {
    if (cspValue) return cspValue;
    // inline scripts in index.html are allowed by hash, so no blanket 'unsafe-inline' for scripts
    const hashes = [];
    try {
      const html = fs.readFileSync(path.join(staticDir, 'index.html'), 'utf8');
      for (const m of html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)) hashes.push("'sha256-" + crypto.createHash('sha256').update(m[1]).digest('base64') + "'");
    } catch (e) { /* no index yet */ }
    cspValue = ["default-src 'self'", "script-src 'self' " + hashes.join(' '), "style-src 'self' 'unsafe-inline'", "img-src 'self' data: blob: " + TILE_HOSTS, "font-src 'self' data:",
      "connect-src 'self'" + (env.CORS_ORIGIN ? ' ' + env.CORS_ORIGIN : ''), "worker-src 'self'", "manifest-src 'self'", "media-src 'self' blob:", "object-src 'none'", "base-uri 'none'", "form-action 'self'", "frame-ancestors 'none'"].join('; ');
    return cspValue;
  }
  function secHeaders(h) {
    h['X-Content-Type-Options'] = 'nosniff';
    h['X-Frame-Options'] = 'DENY';
    h['Referrer-Policy'] = 'no-referrer';
    h['Permissions-Policy'] = 'camera=(self), microphone=(), geolocation=(self), payment=()';
    h['Cross-Origin-Opener-Policy'] = 'same-origin';
    if (env.PUBLIC_HTTPS === '1') h['Strict-Transport-Security'] = 'max-age=31536000; includeSubDomains';
    return h;
  }
  function sendStatic(req, res, pathname) {
    let rel;
    try { rel = decodeURIComponent(pathname); } catch (e) { return text(res, 400, 'Bad request'); }
    if (rel.includes('\0')) return text(res, 400, 'Bad request');
    if (rel === '/' || rel === '') rel = '/index.html';
    const file = path.normalize(path.join(staticDir, rel));
    if (file !== staticDir && !file.startsWith(staticDir + path.sep)) return text(res, 403, 'Forbidden');
    let st;
    try { st = fs.statSync(file); } catch (e) { return text(res, 404, 'Not found'); }
    if (!st.isFile()) return text(res, 404, 'Not found');
    const ext = path.extname(file).toLowerCase();
    const type = MIME[ext] || 'application/octet-stream';
    const etag = '"' + st.size.toString(16) + '-' + Math.floor(st.mtimeMs).toString(16) + '"';
    const headers = secHeaders({ 'Content-Type': type, ETag: etag, 'Last-Modified': st.mtime.toUTCString(),
      'Cache-Control': /\.(woff2?|ttf|png|jpg|ico)$/.test(ext) ? 'public, max-age=86400' : 'no-cache', Vary: 'Accept-Encoding' });
    if (ext === '.html') headers['Content-Security-Policy'] = csp();
    if (path.basename(file) === 'sw.js') headers['Service-Worker-Allowed'] = '/';
    if (req.headers['if-none-match'] === etag) { res.writeHead(304, headers); return res.end(); }
    let entry = fileCache.get(file);
    if (!entry || entry.etag !== etag) { entry = { etag, raw: fs.readFileSync(file), gz: null }; if (fileCache.size > 300) fileCache.clear(); fileCache.set(file, entry); }
    let body = entry.raw;
    if (COMPRESSIBLE.has(ext) && /\bgzip\b/.test(req.headers['accept-encoding'] || '') && body.length > 1024) {
      if (!entry.gz) entry.gz = zlib.gzipSync(entry.raw, { level: 9 });
      body = entry.gz; headers['Content-Encoding'] = 'gzip';
    }
    headers['Content-Length'] = body.length;
    res.writeHead(200, headers);
    if (req.method === 'HEAD') return res.end();
    res.end(body);
  }

  /* ---- helpers */
  function text(res, code, msg, extra) { const b = Buffer.from(msg); res.writeHead(code, secHeaders(Object.assign({ 'Content-Type': 'text/plain; charset=utf-8', 'Content-Length': b.length }, extra || {}))); res.end(b); }
  function json(res, code, obj, extra) {
    const b = Buffer.from(JSON.stringify(obj));
    res.writeHead(code, secHeaders(Object.assign({ 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': b.length, 'Cache-Control': 'no-store' }, extra || {})));
    res.end(b);
  }
  function clientIp(req) {
    if (trustProxy) { const x = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim(); if (x) return x; }
    return req.socket.remoteAddress || '';
  }
  function cors(req, extra) {
    const o = env.CORS_ORIGIN;
    if (!o || req.headers.origin !== o) return extra;
    return Object.assign(extra || {}, { 'Access-Control-Allow-Origin': o, 'Access-Control-Allow-Headers': 'Authorization, Content-Type', 'Access-Control-Allow-Methods': 'POST, GET, OPTIONS', 'Access-Control-Max-Age': '600', Vary: 'Origin' });
  }
  function readBody(req) {
    return new Promise((resolve, reject) => {
      const chunks = []; let n = 0;
      req.on('data', (c) => { n += c.length; if (n > MAX_BODY) { reject(Object.assign(new Error('Request too large'), { status: 413 })); req.destroy(); } else chunks.push(c); });
      req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
      req.on('error', reject);
    });
  }
  const bearer = (req) => { const m = /^Bearer ([A-Za-z0-9_-]{16,200})$/.exec(req.headers.authorization || ''); return m ? m[1] : null; };

  /* ---- per-IP throttle for sign-in / setup (per-account lockout is inside the business logic) */
  const hits = new Map();
  function throttled(ip, limit, windowMs) {
    const now = Date.now();
    const a = (hits.get(ip) || []).filter((t) => now - t < windowMs);
    a.push(now); hits.set(ip, a);
    if (hits.size > 5000) for (const [k, v] of hits) if (!v.length || now - v[v.length - 1] > windowMs) hits.delete(k);
    return a.length > limit;
  }

  /* ---- live sync (server-sent events) */
  const streams = new Set();
  bus.on((m) => {
    const data = 'data: ' + JSON.stringify({ type: m.type, rev: m.rev }) + '\n\n';
    for (const s of streams) { try { s.write(data); } catch (e) { streams.delete(s); } }
  });
  const heartbeat = setInterval(() => { for (const s of streams) { try { s.write(': ping\n\n'); } catch (e) { streams.delete(s); } } }, 25000);
  heartbeat.unref();

  async function handleCall(req, res) {
    const ip = clientIp(req);
    let body;
    try { body = JSON.parse(await readBody(req) || '{}'); } catch (e) { return json(res, e.status || 400, { ok: false, error: { code: 'VALIDATION', message: e.status === 413 ? 'The file is too large.' : 'Malformed request' } }, cors(req)); }
    const method = body && typeof body.method === 'string' ? body.method : '';
    if (!/^[A-Za-z]+\.[A-Za-z]+$/.test(method)) return json(res, 400, { ok: false, error: { code: 'VALIDATION', message: 'Unknown method' } }, cors(req));
    if ((method === 'auth.login' || method === 'system.setup') && throttled(ip, 40, 10 * 60000)) {
      return json(res, 429, { ok: false, error: { code: 'RATE_LIMIT', message: 'Too many attempts from this device. Please wait a few minutes.' } }, cors(req, { 'Retry-After': '300' }));
    }
    const params = body.params && typeof body.params === 'object' && !Array.isArray(body.params) ? body.params : {};
    try {
      const data = await server.call(bearer(req), method, params, { device: String(req.headers['user-agent'] || '').slice(0, 160), ip });
      return json(res, 200, { ok: true, data }, cors(req));
    } catch (e) {
      if (e && e.name === 'ApiError') {
        const extra = {}; for (const k of Object.keys(e)) if (k !== 'name' && k !== 'code') extra[k] = e[k];
        return json(res, STATUS[e.code] || 400, { ok: false, error: Object.assign({ code: e.code, message: e.message }, extra) }, cors(req));
      }
      log('ERROR', method, e && e.stack || e);
      return json(res, 500, { ok: false, error: { code: 'SERVER', message: 'Something went wrong on the server. Please try again.' } }, cors(req));
    }
  }

  async function handleEvents(req, res) {
    try { await server.call(bearer(req), 'auth.me', {}); } catch (e) { return json(res, e && STATUS[e.code] || 401, { ok: false, error: { code: e && e.code || 'UNAUTHENTICATED', message: 'Please sign in' } }, cors(req)); }
    res.writeHead(200, secHeaders(cors(req, { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-store', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' })));
    res.write('retry: 3000\n\ndata: ' + JSON.stringify({ type: 'hello' }) + '\n\n');
    streams.add(res);
    req.on('close', () => streams.delete(res));
  }

  const handler = async (req, res) => {
    try {
      const url = new URL(req.url, 'http://x');
      const p = url.pathname;
      if (p === '/api/call') {
        if (req.method === 'OPTIONS') { res.writeHead(204, secHeaders(cors(req, {}) || {})); return res.end(); }
        if (req.method !== 'POST') return text(res, 405, 'Method not allowed', { Allow: 'POST' });
        if (!/^application\/json/i.test(req.headers['content-type'] || '')) return json(res, 415, { ok: false, error: { code: 'VALIDATION', message: 'Unsupported content type' } }, cors(req));
        return await handleCall(req, res);
      }
      if (p === '/api/events') {
        if (req.method === 'OPTIONS') { res.writeHead(204, secHeaders(cors(req, {}) || {})); return res.end(); }
        return await handleEvents(req, res);
      }
      if (p === '/api/health') { const s = await server.load(); return json(res, 200, { ok: true, rev: s.rev || 0, time: new Date().toISOString() }); }
      if (p === '/config.js') {
        // tells the web app to use this server instead of the in-browser demo
        const body = Buffer.from('window.RW_CONFIG = ' + JSON.stringify(Object.assign({ mode: 'server', apiUrl: '/api' }, TILE_URL && TILE_HOSTS !== 'https://tile.openstreetmap.org https://*.tile.openstreetmap.org' ? { tileUrl: TILE_URL } : {})) + ';\n');
        res.writeHead(200, secHeaders({ 'Content-Type': 'text/javascript; charset=utf-8', 'Content-Length': body.length, 'Cache-Control': 'no-cache' }));
        return res.end(body);
      }
      if (p.startsWith('/api/')) return json(res, 404, { ok: false, error: { code: 'NOT_FOUND', message: 'Unknown endpoint' } });
      if (req.method !== 'GET' && req.method !== 'HEAD') return text(res, 405, 'Method not allowed');
      return sendStatic(req, res, p);
    } catch (e) {
      log('ERROR', req.method, req.url, e && e.stack || e);
      if (!res.headersSent) text(res, 500, 'Server error'); else res.end();
    }
  };

  const httpServer = http.createServer(handler);
  httpServer.requestTimeout = 120000;
  httpServer.headersTimeout = 20000;
  httpServer.keepAliveTimeout = 65000;

  return {
    server, storage, bus, httpServer, handler,
    async listen(port, host) {
      await new Promise((resolve, reject) => { httpServer.once('error', reject); httpServer.listen(port, host, resolve); });
      return httpServer.address();
    },
    async close() {
      clearInterval(heartbeat);
      for (const s of streams) { try { s.end(); } catch (e) { /* ignore */ } }
      streams.clear();
      await new Promise((r) => httpServer.close(r));
      if (storage.close) await storage.close();
    },
  };
}

module.exports = { createApp };

/* ------------------------------------------------------------------ main */
/* Hosting services (Render, Docker volumes) mount the data disk owned by root. When the server starts as root and
 * RUN_AS_UID is set, fix the ownership of the data folder and carry on as that ordinary user — never as root. */
function dropRoot() {
  const uid = parseInt(env.RUN_AS_UID || '', 10);
  if (!uid || typeof process.getuid !== 'function' || process.getuid() !== 0) return;
  const gid = parseInt(env.RUN_AS_GID || String(uid), 10);
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const fix = (p) => {
    const st = fs.lstatSync(p);
    if (st.uid !== uid || st.gid !== gid) fs.lchownSync(p, uid, gid);
    if (st.isDirectory()) for (const n of fs.readdirSync(p)) fix(path.join(p, n));
  };
  fix(DATA_DIR);
  process.setgroups([gid]); process.setgid(gid); process.setuid(uid);
  console.log('Running as user ' + uid + ' (the data folder is now owned by it).');
}

if (require.main === module) {
  (async () => {
    dropRoot();
    const app = createApp({ freeze: env.RW_FREEZE === '1' });
    if (env.SEED_DEMO === '1' && await app.server.isEmpty()) {
      console.log('SEED_DEMO=1 and the data directory is empty: creating the demo company (do not use for real records)…');
      await RW.seedDemo(app.server, { device: 'Demo seed' });
    }
    const addr = await app.listen(PORT, HOST);
    const setup = await app.server.isEmpty();
    console.log('Ravi Cash server listening on http://' + (addr.address === '0.0.0.0' ? 'localhost' : addr.address) + ':' + addr.port);
    if (addr.address === '0.0.0.0') {
      // A phone cannot open "localhost" (that is the phone itself). On the same Wi-Fi it can open this PC's address:
      const lan = [];
      for (const list of Object.values(require('node:os').networkInterfaces())) for (const i of list || []) if (i.family === 'IPv4' && !i.internal) lan.push(i.address);
      for (const ip of lan) console.log('  phone on the same Wi-Fi:  http://' + ip + ':' + addr.port + '   (camera works; "Install app" and offline need HTTPS — see README §4)');
    }
    console.log('  data:   ' + path.resolve(DATA_DIR));
    console.log('  app:    ' + STATIC_DIR);
    console.log('  status: ' + (setup ? 'EMPTY — open the site to run the first-time setup (creates the first branch and Super Admin)' : 'ready'));
    if (ITER < 200000) console.log('  WARNING: PBKDF2_ITERATIONS is low (' + ITER + '); use at least 200000 in production.');
    const stop = async (sig) => { console.log('\n' + sig + ' received, shutting down…'); try { await app.close(); } finally { process.exit(0); } };
    process.on('SIGINT', () => stop('SIGINT'));
    process.on('SIGTERM', () => stop('SIGTERM'));
  })().catch((e) => { console.error(e.message || e); process.exit(1); });
}
