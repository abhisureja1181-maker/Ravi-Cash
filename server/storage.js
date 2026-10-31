'use strict';
/* Durable storage for the self-hosted server.
 *
 *  - The whole ledger lives in one JSON document (`db.json`) that is also cached in memory, so reads are
 *    instant and a write costs one serialisation of the document.
 *  - Every write goes to a temporary file, is fsync'ed, then atomically renamed over `db.json`.
 *    A power cut or crash therefore leaves either the old or the new file, never a torn one.
 *  - Receipt photos are stored as separate files (`kv/att__<id>.json`) so the ledger stays small.
 *  - Rolling backups: at most one per hour is copied to `backups/`, the newest 96 are kept, plus one
 *    per day for 90 days. Full copies (database + photos, hard-linked so they cost no space): one a day for 14 days,
 *    one before permanent deletes, one before "clear all data" and before a restore.
 *  - A lock file stops two server processes from writing the same data directory.
 */
const fs = require('node:fs');
const path = require('node:path');

const KEY_RE = /^[A-Za-z0-9_:.-]{1,120}$/;
const fileFor = (dir, key) => path.join(dir, 'kv', key.replace(/:/g, '__') + '.json');

function fsyncWrite(file, data) {
  const fd = fs.openSync(file, 'w', 0o600);
  try { fs.writeSync(fd, data); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
}
function fsyncDir(dir) {
  try { const fd = fs.openSync(dir, 'r'); try { fs.fsyncSync(fd); } finally { fs.closeSync(fd); } } catch (e) { /* not supported everywhere */ }
}

class FileStorage {
  constructor(dir, opts) {
    opts = opts || {};
    this.dir = path.resolve(dir);
    this.freeze = !!opts.freeze;            // test aid: deep-freeze the shared snapshot to catch accidental mutation
    this.backupEveryMs = opts.backupEveryMs === undefined ? 3600000 : opts.backupEveryMs;
    for (const d of ['', 'kv', 'backups']) fs.mkdirSync(path.join(this.dir, d), { recursive: true, mode: 0o700 });
    this.acquireLock();
    this.dbFile = path.join(this.dir, 'db.json');
    this.cache = null;
    this.lastBackup = 0;
    this.chain = Promise.resolve();
    this.recover();
    this.cache = fs.existsSync(this.dbFile) ? JSON.parse(fs.readFileSync(this.dbFile, 'utf8')) : null;
    if (this.cache && this.freeze) deepFreeze(this.cache);
    const latest = this.latestBackupTime();
    this.lastBackup = latest;
  }

  acquireLock() {
    this.lockFile = path.join(this.dir, '.lock');
    if (fs.existsSync(this.lockFile)) {
      const pid = parseInt(fs.readFileSync(this.lockFile, 'utf8'), 10);
      let alive = false;
      if (pid && pid !== process.pid) { try { process.kill(pid, 0); alive = true; } catch (e) { alive = e.code === 'EPERM'; } }
      // A lock written before this computer last started is always stale: after a restart or power cut, Windows may have
      // given that process number to some other program, which would otherwise keep the server from ever starting again.
      let stale = false;
      try { stale = fs.statSync(this.lockFile).mtimeMs < Date.now() - require('node:os').uptime() * 1000 - 60000; } catch (e) { /* unreadable: use the pid check */ }
      if (alive && !stale) throw new Error('Data directory ' + this.dir + ' is already in use by process ' + pid + '. Run only one server per data directory.');
    }
    fs.writeFileSync(this.lockFile, String(process.pid), { mode: 0o600 });
    const release = () => { try { if (fs.readFileSync(this.lockFile, 'utf8') === String(process.pid)) fs.unlinkSync(this.lockFile); } catch (e) { /* gone */ } };
    process.once('exit', release);
    this.release = () => { release(); process.removeListener('exit', release); };
  }

  // If a crash left a finished temp file but no db.json (rename never happened), use it.
  recover() {
    const tmp = this.dbFile + '.tmp';
    if (!fs.existsSync(this.dbFile) && fs.existsSync(tmp)) {
      try { JSON.parse(fs.readFileSync(tmp, 'utf8')); fs.renameSync(tmp, this.dbFile); } catch (e) { /* incomplete temp: ignore */ }
    }
    if (fs.existsSync(tmp) && fs.existsSync(this.dbFile)) { try { fs.unlinkSync(tmp); } catch (e) { /* ignore */ } }
  }

  latestBackupTime() {
    try {
      const f = fs.readdirSync(path.join(this.dir, 'backups')).filter((x) => x.startsWith('db-')).sort().pop();
      return f ? fs.statSync(path.join(this.dir, 'backups', f)).mtimeMs : 0;
    } catch (e) { return 0; }
  }

  backup() {
    if (!fs.existsSync(this.dbFile)) return;
    const now = Date.now();
    if (this.backupEveryMs && now - this.lastBackup < this.backupEveryMs) return;
    const stamp = new Date(now).toISOString().replace(/[-:]/g, '').replace(/\..*/, '').replace('T', '-');
    const dest = path.join(this.dir, 'backups', 'db-' + stamp + '.json');
    fs.copyFileSync(this.dbFile, dest);
    this.lastBackup = now;
    // retention: keep the newest 96, plus the first backup of each of the last 90 days
    const dir = path.join(this.dir, 'backups');
    const files = fs.readdirSync(dir).filter((x) => /^db-\d{8}-\d{6}\.json$/.test(x)).sort();
    const keep = new Set(files.slice(-96));
    const seenDay = new Set();
    for (const f of files.slice().reverse()) {
      const day = f.slice(3, 11);
      if (!seenDay.has(day) && seenDay.size < 90) { seenDay.add(day); keep.add(f); }
    }
    for (const f of files) if (!keep.has(f)) { try { fs.unlinkSync(path.join(dir, f)); } catch (e) { /* ignore */ } }
  }

  /* A complete copy (database + receipt photos) in backups/<label>-<time>/ . The files are hard-linked, not copied: they cost no
   * extra disk space, and they stay intact when the original is later erased, because every write here replaces a file
   * (temp file + rename) instead of changing it in place. Where links are not possible the files are copied.
   * `keep`: how many copies with this label to keep (the oldest are removed); default: all, forever.
   * Returns the folder path relative to the data directory. */
  _stamp(ms) { return new Date(ms || Date.now()).toISOString().replace(/[-:]/g, '').replace(/\..*/, '').replace('T', '-'); }
  _link(src, dst) {
    try { fs.rmSync(dst, { force: true }); fs.linkSync(src, dst); } catch (e) { fs.copyFileSync(src, dst); }
  }
  async snapshot(label, opts) {
    await this.chain;                                  // let any write in flight finish first
    label = String(label || 'snapshot').replace(/[^a-z0-9-]/gi, '');
    const rel = path.join('backups', label + '-' + this._stamp());
    const dir = path.join(this.dir, rel);
    fs.mkdirSync(path.join(dir, 'kv'), { recursive: true, mode: 0o700 });
    if (fs.existsSync(this.dbFile)) this._link(this.dbFile, path.join(dir, 'db.json'));
    const kv = path.join(this.dir, 'kv');
    for (const f of fs.readdirSync(kv)) if (f.endsWith('.json')) this._link(path.join(kv, f), path.join(dir, 'kv', f));
    if (opts && opts.keep > 0) this._prune(label, opts.keep);
    return rel.split(path.sep).join('/');
  }
  _snapshotDirs(label) {
    const re = new RegExp('^' + label + '-(\\d{8})-(\\d{6})$');
    try { return fs.readdirSync(path.join(this.dir, 'backups'), { withFileTypes: true }).filter((e) => e.isDirectory() && re.test(e.name)).map((e) => e.name).sort(); } catch (e) { return []; }
  }
  _prune(label, keep) {
    const all = this._snapshotDirs(label);
    for (const n of all.slice(0, Math.max(0, all.length - keep))) { try { fs.rmSync(path.join(this.dir, 'backups', n), { recursive: true, force: true }); } catch (e) { /* ignore */ } }
  }
  _lastSnapshotAt(label) {
    const n = this._snapshotDirs(label).pop();
    if (!n) return 0;
    const m = /-(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})(\d{2})$/.exec(n);
    return Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]);
  }
  // Before a permanent delete: a full copy, but not again within `minGapMs` of the previous one (deleting 40 vouchers one by one
  // must not make 40 copies); the earlier copy still holds everything that existed before this session of deleting.
  async safetyCopy(label, o) {
    o = o || {};
    if (!fs.existsSync(this.dbFile)) return null;
    if (o.minGapMs && Date.now() - this._lastSnapshotAt(label) < o.minGapMs) return null;
    return this.snapshot(label, { keep: o.keep || 30 });
  }
  // One full copy a day (taken by a timer in server/index.js), the newest `keep` days are kept.
  async autoSnapshot(o) {
    o = o || {};
    if (!fs.existsSync(this.dbFile)) return null;
    if (Date.now() - this._lastSnapshotAt('daily') < (o.everyMs || 20 * 3600000)) return null;
    return this.snapshot('daily', { keep: o.keep || 14 });
  }

  /* What is in backups/, newest first: [{ id, kind, at (ISO), bytes, full, photos }]
   *   kind 'auto'          the hourly rolling copy of the database (no photos)
   *   kind 'daily' / 'before-erase' / 'before-clear' / 'before-restore'   a full copy (database + photos) */
  async listBackups() {
    const dir = path.join(this.dir, 'backups');
    const iso = (d, t) => d.slice(0, 4) + '-' + d.slice(4, 6) + '-' + d.slice(6, 8) + 'T' + t.slice(0, 2) + ':' + t.slice(2, 4) + ':' + t.slice(4, 6) + '.000Z';
    const out = [];
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      let m;
      try {
        if (e.isFile() && (m = /^db-(\d{8})-(\d{6})\.json$/.exec(e.name))) out.push({ id: e.name.slice(0, -5), kind: 'auto', at: iso(m[1], m[2]), bytes: fs.statSync(path.join(dir, e.name)).size, full: false, photos: 0 });
        else if (e.isDirectory() && (m = /^([A-Za-z0-9]+(?:-[A-Za-z0-9]+)*)-(\d{8})-(\d{6})$/.exec(e.name)) && fs.existsSync(path.join(dir, e.name, 'db.json'))) {
          const kv = path.join(dir, e.name, 'kv');
          out.push({ id: e.name, kind: m[1], at: iso(m[2], m[3]), bytes: fs.statSync(path.join(dir, e.name, 'db.json')).size, full: true,
            photos: fs.existsSync(kv) ? fs.readdirSync(kv).filter((f) => f.startsWith('att__')).length : 0 });
        }
      } catch (err) { /* vanished while listing */ }
    }
    return out.sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0));
  }

  /* One of the copies above: { db, kv, full } — kv maps 'att:<id>' / 'loc' / 'trail:<day>' to its stored value. */
  async readBackup(id) {
    if (!/^[A-Za-z0-9]+(?:-[A-Za-z0-9]+)*-\d{8}-\d{6}$/.test(String(id))) throw new Error('Bad backup id');
    const dir = path.join(this.dir, 'backups');
    const file = path.join(dir, id + '.json'), folder = path.join(dir, id);
    if (id.startsWith('db-') && fs.existsSync(file)) return { db: JSON.parse(fs.readFileSync(file, 'utf8')), kv: {}, full: false };
    if (fs.existsSync(path.join(folder, 'db.json'))) {
      const kv = {};
      const kvDir = path.join(folder, 'kv');
      if (fs.existsSync(kvDir)) for (const f of fs.readdirSync(kvDir)) {
        if (!f.endsWith('.json')) continue;
        const key = f.slice(0, -5).replace(/__/g, ':');
        if (key !== 'db' && KEY_RE.test(key)) kv[key] = JSON.parse(fs.readFileSync(path.join(kvDir, f), 'utf8'));
      }
      return { db: JSON.parse(fs.readFileSync(path.join(folder, 'db.json'), 'utf8')), kv, full: true };
    }
    throw new Error('Backup not found');
  }

  _queue(fn) { const run = this.chain.then(fn); this.chain = run.catch(() => {}); return run; }

  async get(key, forWrite) {
    if (!KEY_RE.test(key)) throw new Error('Bad storage key');
    if (key === 'db') {
      if (!this.cache) return null;
      return forWrite ? structuredClone(this.cache) : this.cache;
    }
    const f = fileFor(this.dir, key);
    return fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : null;
  }

  async set(key, value) {
    if (!KEY_RE.test(key)) throw new Error('Bad storage key');
    return this._queue(() => {
      if (key === 'db') {
        const json = JSON.stringify(value);
        const tmp = this.dbFile + '.tmp';
        this.backup();                         // copy the previous good version first
        fsyncWrite(tmp, json);
        fs.renameSync(tmp, this.dbFile);
        fsyncDir(this.dir);
        this.cache = this.freeze ? deepFreeze(value) : value;   // adopt the committed copy (callers never touch it again)
        return;
      }
      const f = fileFor(this.dir, key);
      fsyncWrite(f + '.tmp', JSON.stringify(value));
      fs.renameSync(f + '.tmp', f);
    });
  }

  async del(key) {
    if (!KEY_RE.test(key)) throw new Error('Bad storage key');
    return this._queue(() => {
      if (key === 'db') { this.cache = null; try { fs.unlinkSync(this.dbFile); } catch (e) { /* none */ } return; }
      try { fs.unlinkSync(fileFor(this.dir, key)); } catch (e) { /* none */ }
    });
  }

  async keys(prefix) {
    const out = [];
    if (this.cache && (!prefix || 'db'.startsWith(prefix))) out.push('db');
    for (const f of fs.readdirSync(path.join(this.dir, 'kv'))) {
      if (!f.endsWith('.json')) continue;
      const k = f.slice(0, -5).replace(/__/g, ':');
      if (!prefix || k.startsWith(prefix)) out.push(k);
    }
    return out;
  }

  async clear() { for (const k of await this.keys()) await this.del(k); }

  async close() { await this.chain; this.release(); }
}

function deepFreeze(o) {
  if (o && typeof o === 'object' && !Object.isFrozen(o)) { Object.freeze(o); for (const k of Object.keys(o)) deepFreeze(o[k]); }
  return o;
}

module.exports = { FileStorage };
