/* Ravi Cash — client API layer.
 *   RW.api.call(method, params)   — talks to the backend (demo: in-browser; production: Supabase)
 *   RW.api.onChange(cb)           — live-sync notifications (BroadcastChannel in demo, Realtime in production)
 *   RW.outbox                     — offline queue for voucher creation (idempotent, server assigns numbers)
 */
(function (g) {
  'use strict';
  const RW = (g.RW = g.RW || {});
  const { ApiError } = RW;

  const LS = {
    get(k) { try { return g.localStorage.getItem(k); } catch (e) { return null; } },
    set(k, v) { try { g.localStorage.setItem(k, v); } catch (e) { /* private mode */ } },
    del(k) { try { g.localStorage.removeItem(k); } catch (e) { /* ignore */ } },
  };
  const SS = {
    get(k) { try { return g.sessionStorage.getItem(k); } catch (e) { return null; } },
    set(k, v) { try { g.sessionStorage.setItem(k, v); } catch (e) { /* ignore */ } },
    del(k) { try { g.sessionStorage.removeItem(k); } catch (e) { /* ignore */ } },
  };
  RW.LS = LS;

  /* ------------------------------------------------------------ connectivity */
  const net = (RW.net = {
    simulated: LS.get('rw.simOffline') === '1',
    listeners: new Set(),
    get online() { return !net.simulated && (typeof navigator === 'undefined' || navigator.onLine !== false); },
    setSimulated(on) { net.simulated = !!on; LS.set('rw.simOffline', on ? '1' : '0'); net.emit(); },
    emit() { net.listeners.forEach((l) => { try { l(net.online); } catch (e) { console.error(e); } }); },
    on(cb) { net.listeners.add(cb); return () => net.listeners.delete(cb); },
  });
  if (g.addEventListener) { g.addEventListener('online', () => net.emit()); g.addEventListener('offline', () => net.emit()); }

  /* ---------------------------------------------------------------- session */
  const session = {
    token: null, remember: false,
    load() { this.token = LS.get('rw.token') || SS.get('rw.token'); this.remember = !!LS.get('rw.token'); return this.token; },
    save(token, remember) { this.token = token; this.remember = !!remember; LS.del('rw.token'); SS.del('rw.token'); (remember ? LS : SS).set('rw.token', token); },
    clear() { this.token = null; LS.del('rw.token'); SS.del('rw.token'); },
  };

  /* ------------------------------------------------------- demo (local) adapter */
  function demoAdapter() {
    const storage = RW.makeStorage();
    const bus = RW.makeBus('rw-demo');
    const server = RW.createServer({ storage, bus, lock: RW.makeLock('rw-demo-db') });
    const device = () => (g.navigator && g.navigator.userAgent ? g.navigator.userAgent.slice(0, 120) : 'browser');
    return {
      kind: 'demo', server, storage,
      async call(method, params, o) {
        // tiny delay so the loading states are visible and the UI feels like a real network
        await new Promise((r) => setTimeout(r, (o && o.fast) ? 0 : 40 + Math.random() * 60));
        return server.call((o && o.token === null) ? null : session.token, method, params, { device: device(), ip: 'demo' });
      },
      onChange(cb) { return bus.on((m) => cb(m)); },
      async seed(withImages) {
        const s = await RW.seedDemo(server, { makeReceiptImage: withImages ? RW.makeDemoReceipt : null, device: 'Demo seed' });
        bus.post({ type: 'reset' });
        return s;
      },
      async reset() { await server.wipe(); },
      isEmpty: () => server.isEmpty(),
    };
  }
  RW.demoAdapter = demoAdapter;

  /* ------------------------------------------- real server adapter (self-hosted backend) */
  /* Same contract as the demo adapter, but every call goes to the server over HTTPS and live changes are
   * pushed back through a server-sent-event stream. A failed connection throws an error WITHOUT a `code`,
   * which is how the voucher form knows to keep the work on the device (offline outbox) instead of losing it. */
  function remoteAdapter(cfg) {
    const base = String((cfg && cfg.apiUrl) || '/api').replace(/\/+$/, '');
    let storage;
    try { storage = typeof indexedDB !== 'undefined' ? new RW.IdbStorage('ravi-cash-device') : new RW.MemoryStorage(); } catch (e) { storage = new RW.MemoryStorage(); }
    const listeners = new Set();
    let streaming = false, backoff = 1000, abort = null;
    const emit = (m) => listeners.forEach((l) => { try { l(Object.assign({ remote: true }, m)); } catch (e) { console.error(e); } });

    async function call(method, params, o) {
      const token = (o && o.token === null) ? null : session.token;
      const ctl = new AbortController();
      const timer = setTimeout(() => ctl.abort(), method.startsWith('backup.') ? 600000 : (method === 'vouchers.addAttachment' || method === 'vouchers.create') ? 120000 : 45000);
      let res, body;
      try {
        res = await fetch(base + '/call', { method: 'POST', signal: ctl.signal, credentials: 'omit', cache: 'no-store',
          headers: Object.assign({ 'Content-Type': 'application/json' }, token ? { Authorization: 'Bearer ' + token } : {}),
          body: JSON.stringify({ method, params: params || {} }) });
        body = await res.json().catch(() => null);
      } catch (e) {
        throw new Error('Cannot reach the server. Check your internet connection.');   // no .code → treated as "offline"
      } finally { clearTimeout(timer); }
      if (body && body.ok) return body.data;
      if (body && body.error && body.error.code && body.error.code !== 'SERVER') {
        const { code, message } = body.error; const extra = Object.assign({}, body.error); delete extra.code; delete extra.message;
        throw new ApiError(code, message, extra);
      }
      throw new Error((body && body.error && body.error.message) || 'The server is not responding properly (' + (res ? res.status : '?') + '). Please try again.');
    }

    async function stream() {
      if (streaming) return;
      streaming = true;
      try {
        for (;;) {
          if (!listeners.size) break;
          if (!session.token) { await new Promise((r) => setTimeout(r, 1500)); continue; }
          abort = new AbortController();
          try {
            const res = await fetch(base + '/events', { headers: { Authorization: 'Bearer ' + session.token }, signal: abort.signal, cache: 'no-store', credentials: 'omit' });
            if (!res.ok || !res.body) throw new Error('stream ' + res.status);
            backoff = 1000;
            emit({ type: 'changed', rev: -1 });                // catch up on anything missed while disconnected
            const rd = res.body.getReader(); const dec = new TextDecoder(); let buf = '';
            for (;;) {
              const { value, done } = await rd.read();
              if (done) break;
              buf += dec.decode(value, { stream: true });
              let i;
              while ((i = buf.indexOf('\n\n')) >= 0) {
                const block = buf.slice(0, i); buf = buf.slice(i + 2);
                const line = block.split('\n').find((x) => x.startsWith('data: '));
                if (!line) continue;
                try { const m = JSON.parse(line.slice(6)); if (m.type !== 'hello') emit(m); } catch (e) { /* ignore */ }
              }
            }
          } catch (e) { if (e && e.name === 'AbortError' && !listeners.size) break; }
          await new Promise((r) => setTimeout(r, backoff)); backoff = Math.min(backoff * 2, 15000);
        }
      } finally { streaming = false; }
    }
    if (g.document) {
      g.document.addEventListener('visibilitychange', () => { if (g.document.visibilityState === 'visible' && listeners.size) { if (abort) abort.abort(); emit({ type: 'changed', rev: -1 }); } });
      g.addEventListener('online', () => { if (abort) abort.abort(); });
    }
    return {
      kind: 'server', storage, call,
      onChange(cb) { listeners.add(cb); stream(); return () => { listeners.delete(cb); if (!listeners.size && abort) abort.abort(); }; },
      isEmpty: async () => false,
    };
  }
  RW.remoteAdapter = remoteAdapter;

  /* ------------------------------------------------------------------- facade */
  const api = (RW.api = {
    adapter: null,
    session,
    init(adapter) { api.adapter = adapter; session.load(); return api; },
    get kind() { return api.adapter.kind; },
    async call(method, params, o) {
      try {
        return await api.adapter.call(method, params || {}, o);
      } catch (e) {
        if (e && e.code === 'UNAUTHENTICATED' && !(o && o.noAuthRedirect) && method !== 'auth.login') {
          session.clear();
          if (api.onAuthLost) api.onAuthLost(e);
        }
        if (e && e.code === 'ACCOUNT_DISABLED' && api.onAuthLost && method !== 'auth.login') { session.clear(); api.onAuthLost(e); }
        throw e;
      }
    },
    onChange(cb) { return api.adapter.onChange(cb); },
    onAuthLost: null,
  });

  /* ------------------------------------------------------------ offline outbox */
  /* Vouchers prepared while offline are stored on the device and sent when the connection returns.
   * The server assigns the number (never the client), and the `clientId` makes retries idempotent,
   * so a flaky connection can never create the same voucher twice. */
  const OB = 'outbox:';
  const outbox = (RW.outbox = {
    listeners: new Set(),
    flushing: false,
    st() { return api.adapter.storage || outbox._mem || (outbox._mem = new RW.MemoryStorage()); },
    userKey(uid) { return OB + uid + ':'; },
    async add(userId, payload) {
      const id = 'draft-' + RW.randomHex(8);
      const item = { id, userId, payload: Object.assign({}, payload, { clientId: id }), createdAt: new Date().toISOString(), attempts: 0, error: null };
      await outbox.st().set(outbox.userKey(userId) + id, item);
      outbox.emit();
      return item;
    },
    async list(userId) {
      const st = outbox.st();
      const keys = await st.keys(outbox.userKey(userId));
      const out = [];
      for (const k of keys) { const v = await st.get(k); if (v) out.push(v); }
      return out.sort((a, b) => (a.createdAt < b.createdAt ? -1 : 1));
    },
    async remove(userId, id) { await outbox.st().del(outbox.userKey(userId) + id); outbox.emit(); },
    async count(userId) { return (await outbox.st().keys(outbox.userKey(userId))).length; },
    on(cb) { outbox.listeners.add(cb); return () => outbox.listeners.delete(cb); },
    emit() { outbox.listeners.forEach((l) => { try { l(); } catch (e) { console.error(e); } }); },
    // Send everything that is waiting. Returns the vouchers that were created.
    async flush(userId) {
      if (outbox.flushing || !net.online || !session.token) return [];
      outbox.flushing = true;
      const done = [];
      try {
        for (const item of await outbox.list(userId)) {
          try {
            const r = await api.call('vouchers.create', item.payload, { noAuthRedirect: false });
            await outbox.remove(userId, item.id);
            done.push(r.voucher);
          } catch (e) {
            if (e && (e.code === 'VALIDATION' || e.code === 'FORBIDDEN' || e.code === 'LOCKED')) {
              item.error = e.message; item.attempts++;
              await outbox.st().set(outbox.userKey(userId) + item.id, item); // keep it so the user can fix or discard
              outbox.emit();
            } else break; // network-ish error: try again later
          }
        }
      } finally { outbox.flushing = false; }
      if (done.length) outbox.emit();
      return done;
    },
  });
})(typeof window !== 'undefined' ? window : globalThis);
