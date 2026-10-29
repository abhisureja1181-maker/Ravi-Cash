/* Ravi Cash — storage adapters, cross-tab lock and change bus for the DEMO backend.
 * (Production uses Supabase instead — see /supabase.) */
(function (g) {
  'use strict';
  const RW = (g.RW = g.RW || {});

  /* In-memory storage: used by tests and as a fallback when IndexedDB is unavailable. */
  class MemoryStorage {
    constructor() { this.m = new Map(); }
    async get(k) { return this.m.has(k) ? structuredClone(this.m.get(k)) : null; }
    async set(k, v) { this.m.set(k, structuredClone(v)); }
    async del(k) { this.m.delete(k); }
    async keys(prefix) { return [...this.m.keys()].filter((k) => !prefix || k.startsWith(prefix)); }
    async clear() { this.m.clear(); }
  }

  /* IndexedDB key/value storage (browser). Values are structured-cloned objects/strings. */
  class IdbStorage {
    constructor(name) {
      this.name = name || 'ravi-cash-demo';
      this.dbp = null;
    }
    db() {
      if (!this.dbp) {
        this.dbp = new Promise((res, rej) => {
          const rq = indexedDB.open(this.name, 1);
          rq.onupgradeneeded = () => rq.result.createObjectStore('kv');
          rq.onsuccess = () => res(rq.result);
          rq.onerror = () => rej(rq.error);
        });
      }
      return this.dbp;
    }
    async tx(mode, fn) {
      const db = await this.db();
      return new Promise((res, rej) => {
        const t = db.transaction('kv', mode);
        const out = fn(t.objectStore('kv'));
        t.oncomplete = () => res(out && 'result' in out ? out.result : undefined);
        t.onerror = () => rej(t.error);
        t.onabort = () => rej(t.error);
      });
    }
    async get(k) { const v = await this.tx('readonly', (s) => s.get(k)); return v === undefined ? null : v; }
    async set(k, v) { await this.tx('readwrite', (s) => s.put(v, k)); }
    async del(k) { await this.tx('readwrite', (s) => s.delete(k)); }
    async keys(prefix) {
      const all = await this.tx('readonly', (s) => s.getAllKeys());
      return (all || []).filter((k) => !prefix || String(k).startsWith(prefix));
    }
    async clear() { await this.tx('readwrite', (s) => s.clear()); }
  }

  RW.MemoryStorage = MemoryStorage;
  RW.IdbStorage = IdbStorage;
  /* IndexedDB when the browser allows it; otherwise (a sandboxed preview, a locked-down browser) the demo still runs,
   * keeping its data in memory until the page is closed. RW.storageMode tells which one is in use. */
  class SafeStorage {
    constructor() { this.idb = new IdbStorage(); this.mem = new MemoryStorage(); this.target = null; }
    async pick() {
      if (!this.target) {
        try { await this.idb.db(); this.target = this.idb; RW.storageMode = 'saved'; }
        catch (e) { this.target = this.mem; RW.storageMode = 'memory'; }
      }
      return this.target;
    }
    async get(k) { return (await this.pick()).get(k); }
    async set(k, v) { return (await this.pick()).set(k, v); }
    async del(k) { return (await this.pick()).del(k); }
    async keys(prefix) { return (await this.pick()).keys(prefix); }
    async clear() { return (await this.pick()).clear(); }
  }
  RW.SafeStorage = SafeStorage;
  RW.makeStorage = function () {
    try { if (typeof indexedDB !== 'undefined' && indexedDB) return new SafeStorage(); } catch (e) { /* fall through */ }
    RW.storageMode = 'memory';
    return new MemoryStorage();
  };

  /* A lock that serialises read-modify-write cycles. In browsers it uses the Web Locks API so two
   * tabs/windows can never interleave (this is what makes voucher numbering atomic in the demo). */
  RW.makeLock = function (name) {
    let tail = Promise.resolve();
    const local = (fn) => {
      const run = tail.then(() => fn());
      tail = run.catch(() => {});
      return run;
    };
    let web = false;
    try { web = !!(typeof navigator !== 'undefined' && navigator.locks && navigator.locks.request); } catch (e) { web = false; }
    if (!web) return local;
    // Some sandboxed previews refuse the Web Locks API; then this tab simply uses its own queue.
    return (fn) => {
      if (!web) return local(fn);
      let started = false;
      const wrapped = () => { started = true; return fn(); };
      let p;
      try { p = navigator.locks.request(name, wrapped); } catch (e) { web = false; return local(fn); }
      return Promise.resolve(p).catch((e) => { if (!started && e && e.name === 'SecurityError') { web = false; return local(fn); } throw e; });
    };
  };

  /* Change bus: tells every open tab that the database changed (the demo's "live sync"). */
  RW.makeBus = function (name, opts) {
    const listeners = new Set();
    let ch = null;
    if (!(opts && opts.channel === false) && typeof BroadcastChannel !== 'undefined') {
      ch = new BroadcastChannel(name);
      ch.onmessage = (e) => listeners.forEach((l) => { try { l(Object.assign({ remote: true }, e.data)); } catch (err) { console.error(err); } });
    }
    return {
      post(msg) {
        if (ch) ch.postMessage(msg);
        listeners.forEach((l) => { try { l(Object.assign({ remote: false }, msg)); } catch (err) { console.error(err); } });
      },
      on(cb) { listeners.add(cb); return () => listeners.delete(cb); },
      close() { if (ch) ch.close(); listeners.clear(); },
    };
  };
})(typeof window !== 'undefined' ? window : globalThis);
