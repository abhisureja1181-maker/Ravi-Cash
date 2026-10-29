#!/usr/bin/env node
'use strict';
/* Builds dist/ — a ready-to-host copy of app/ whose service worker cache is versioned by the content of the files,
 * so every release makes installed phones fetch the new version instead of showing an old one.
 * Checks on the way: every file the service worker pre-caches and every script/style index.html loads must exist. */
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const ROOT = path.join(__dirname, '..');
const SRC = path.join(ROOT, 'app');
const OUT = path.join(ROOT, 'dist');

function walk(dir, base = '') {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const rel = path.posix.join(base, e.name);
    return e.isDirectory() ? walk(path.join(dir, e.name), rel) : [rel];
  }).sort();
}

const files = walk(SRC);
const problems = [];
const html = fs.readFileSync(path.join(SRC, 'index.html'), 'utf8');
for (const m of html.matchAll(/(?:src|href)="([^"#?]+)"/g)) {
  const ref = m[1];
  if (/^(https?:|data:|\/\/)/.test(ref)) { problems.push('index.html loads an external file: ' + ref); continue; }
  if (!fs.existsSync(path.join(SRC, ref))) problems.push('index.html references a missing file: ' + ref);
}
const sw = fs.readFileSync(path.join(SRC, 'sw.js'), 'utf8');
const shell = (sw.match(/const SHELL = \[([\s\S]*?)\];/) || [, ''])[1].match(/'([^']+)'/g) || [];
for (const q of shell) { const ref = q.slice(1, -1); if (ref !== './' && !fs.existsSync(path.join(SRC, ref))) problems.push('sw.js pre-caches a missing file: ' + ref); }
if (problems.length) { console.error('Build stopped:\n - ' + problems.join('\n - ')); process.exit(1); }

const hash = crypto.createHash('sha256');
for (const f of files) { hash.update(f); hash.update(fs.readFileSync(path.join(SRC, f))); }
const version = hash.digest('hex').slice(0, 10);

fs.rmSync(OUT, { recursive: true, force: true });
for (const f of files) {
  const to = path.join(OUT, f);
  fs.mkdirSync(path.dirname(to), { recursive: true });
  if (f === 'sw.js') fs.writeFileSync(to, sw.replace(/const VERSION = '[^']*';/, "const VERSION = 'rw-shell-" + version + "';"));
  else fs.copyFileSync(path.join(SRC, f), to);
}
fs.writeFileSync(path.join(OUT, 'version.json'), JSON.stringify({ version, files: files.length, builtAt: new Date().toISOString() }, null, 2) + '\n');
console.log('dist/ ready: ' + files.length + ' files, version ' + version);
