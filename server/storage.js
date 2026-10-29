'use strict';
/* Durable storage for the self-hosted server.
 *
 *  - The whole ledger lives in one JSON document (`db.json`) that is also cached in memory, so reads are
 *    instant and a write costs one serialisation of the document.
 *  - Every write goes to a temporary file, is fsync'ed, then atomically renamed over `db.json`.
 *    A power cut or crash therefore leaves either the old or the new file, never a torn one.
 *  - Receipt photos are stored as separate files (`kv/att__<id>.json`) so the ledger stays small.
 *  - Rolling backups: at most one per hour is copied to `backups/`, the newest 96 are kept, plus one
 *    per day for 90 days.
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

  // A complete copy (database + receipt photos) for "clear all data". Lives in backups/<label>-<time>/ and is never
  // removed by the rolling-backup cleanup. Returns the folder path relative to the data directory.
  async snapshot(label) {
    await this.chain;                                  // let any write in flight finish first
    const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\..*/, '').replace('T', '-');
    const rel = path.join('backups', String(label || 'snapshot').replace(/[^a-z0-9-]/gi, '') + '-' + stamp);
    const dir = path.join(this.dir, rel);
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    if (fs.existsSync(this.dbFile)) fs.copyFileSync(this.dbFile, path.join(dir, 'db.json'));
    fs.cpSync(path.join(this.dir, 'kv'), path.join(dir, 'kv'), { recursive: true });
    return rel.split(path.sep).join('/');
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
