// Static integrity of the web app / installable Android app: nothing referenced is missing, every script parses,
// the manifest and service worker are installable, and the build output is consistent.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const cp = require('node:child_process');

const APP = path.join(__dirname, '..', 'app');
const read = (f) => fs.readFileSync(path.join(APP, f), 'utf8');
const html = read('index.html');

test('index.html: every script, style, icon and manifest it references exists; nothing is loaded from another site', () => {
  const refs = [...html.matchAll(/(?:src|href)="([^"#?]+)"/g)].map((m) => m[1]);
  assert.ok(refs.length > 25);
  for (const r of refs) {
    assert.doesNotMatch(r, /^(https?:)?\/\//, 'external resource: ' + r);
    assert.ok(fs.existsSync(path.join(APP, r)), 'missing: ' + r);
  }
  assert.match(html, /<meta[^>]+name="viewport"/);
  assert.match(html, /<meta[^>]+name="theme-color"/);
  assert.match(html, /rel="manifest"/);
});

test('every JavaScript file is syntactically valid', () => {
  const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : e.name.endsWith('.js') ? [path.join(d, e.name)] : []));
  const files = walk(APP);
  assert.ok(files.length > 25);
  for (const f of files) { const r = cp.spawnSync(process.execPath, ['--check', f], { encoding: 'utf8' }); assert.equal(r.status, 0, f + '\n' + r.stderr); }
});

test('installable app: manifest has name, start_url, standalone display, 192 and 512 icons (incl. maskable) that exist', () => {
  const m = JSON.parse(read('manifest.webmanifest'));
  assert.ok(m.name && m.short_name && m.start_url && m.scope);
  assert.equal(m.display, 'standalone');
  assert.match(m.theme_color, /^#[0-9a-f]{6}$/i);
  const sizes = m.icons.map((i) => i.sizes);
  assert.ok(sizes.includes('192x192') && sizes.includes('512x512'));
  assert.ok(m.icons.some((i) => /maskable/.test(i.purpose || '')), 'a maskable icon for Android');
  for (const i of m.icons) {
    const f = path.join(APP, i.src);
    assert.ok(fs.existsSync(f), 'icon missing: ' + i.src);
    const png = fs.readFileSync(f);
    assert.equal(png.readUInt32BE(16), parseInt(i.sizes, 10), 'icon width matches ' + i.sizes);
  }
});

test('service worker: pre-caches only existing files, never caches API calls, scripts load in dependency order', () => {
  const sw = read('sw.js');
  const shell = (sw.match(/const SHELL = \[([\s\S]*?)\];/)[1].match(/'([^']+)'/g) || []).map((q) => q.slice(1, -1));
  for (const f of shell) if (f !== './') assert.ok(fs.existsSync(path.join(APP, f)), 'pre-cached file missing: ' + f);
  const scripts = [...html.matchAll(/<script[^>]+src="([^"]+)"/g)].map((m) => m[1]);
  for (const s of scripts) assert.ok(shell.includes(s), s + ' is loaded by index.html but not pre-cached (offline start would break)');
  assert.match(sw, /startsWith\('\/api\/'\)/, 'API traffic must bypass the cache');
  const order = (a, b) => assert.ok(scripts.indexOf(a) < scripts.indexOf(b), a + ' must load before ' + b);
  order('js/util.js', 'js/store.js'); order('js/store.js', 'js/server-core.js'); order('js/server-core.js', 'js/server-vouchers.js');
  order('js/server-vouchers.js', 'js/server-tours.js'); order('js/server-tours.js', 'js/server-location.js'); order('js/server-location.js', 'js/server-backup.js'); order('js/server-backup.js', 'js/seed.js'); order('js/views/common.js', 'js/views/tours.js'); order('js/views/tours.js', 'js/views/livemap.js'); order('js/views/livemap.js', 'js/app.js'); order('vendor/leaflet/leaflet.js', 'js/map.js'); order('js/map.js', 'js/tracker.js'); order('js/ui.js', 'js/tracker.js'); order('js/tracker.js', 'js/app.js');
  order('js/api.js', 'js/ui.js'); order('js/ui.js', 'js/views/common.js'); order('js/views/common.js', 'js/views/login.js'); order('js/views/misc.js', 'js/app.js');
});

test('pages never use eval / inline event handlers (needed for the strict Content-Security-Policy)', () => {
  const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : e.name.endsWith('.js') ? [path.join(d, e.name)] : []));
  for (const f of walk(path.join(APP, 'js'))) {
    const src = fs.readFileSync(f, 'utf8');
    assert.doesNotMatch(src, /\beval\s*\(|new Function\s*\(|setTimeout\(\s*['"`]/, f + ' uses eval-like code');
  }
  assert.doesNotMatch(html, /\son[a-z]+="/i, 'inline event handler attributes in index.html');
});

test('build: dist/ is a complete, versioned copy of app/', () => {
  const r = cp.spawnSync(process.execPath, [path.join(__dirname, '..', 'tools', 'build.js')], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  const dist = path.join(__dirname, '..', 'dist');
  const v = JSON.parse(fs.readFileSync(path.join(dist, 'version.json'), 'utf8'));
  assert.match(v.version, /^[0-9a-f]{10}$/);
  assert.match(fs.readFileSync(path.join(dist, 'sw.js'), 'utf8'), new RegExp("VERSION = 'rw-shell-" + v.version + "'"));
  for (const f of ['index.html', 'config.js', 'manifest.webmanifest', 'js/app.js', 'css/app.css', 'fonts/Inter-Regular.woff']) assert.ok(fs.existsSync(path.join(dist, f)), f);
});
