/* Ravi Cash — DEMO BACKEND core.
 *
 * This file models the server-side rules (authorization, atomic numbering, locking, audit) that the
 * production Supabase backend enforces with Row Level Security and database functions. In demo mode
 * it runs in the browser, so it demonstrates behaviour — it is NOT a security boundary. For real
 * deployments use the SQL in /supabase, which is the actual enforcement layer.
 */
(function (g) {
  'use strict';
  const RW = (g.RW = g.RW || {});
  const { ApiError } = RW;
  RW.serverModules = RW.serverModules || [];

  const DEFAULT_SETTINGS = () => ({
    company: {
      name: 'RAVI WATER FLOW PUMPS',
      tagline: 'Water Flow Pumps & Irrigation Solutions',
      address: 'Main Road, Rajkot, Gujarat 360001',
      phone: '+91 281 000 0000',
      email: 'accounts@raviwaterflow.example',
      gstin: '',
    },
    numbering: { PAYMENT: { prefix: 'CPV', pad: 6 }, RECEIPT: { prefix: 'CRV', pad: 6 } },
    fiscalYearStartMonth: 4,
    maxVoucherAmountPaise: 1000000000, // ₹1,00,00,000
    largePaymentAlertPaise: 5000000, // ₹50,000 raises an "important" admin notification
    blockNegativeCash: false,
    userBackdateDays: 7,
    locationTracking: true,       // staff share their live location with the main admin and the CEO
    locationKeepDays: 30,         // how long the day-wise routes are kept
    maxAttachments: 6,
    maxAttachmentChars: 8 * 1024 * 1024,
    sessionHours: 12,
    rememberDays: 30,
  });

  const emptyState = () => ({
    v: 1,
    rev: 0,
    counters: { PAYMENT: 0, RECEIPT: 0 },
    seq: { audit: 0, voucher: 0, notif: 0, statement: 0, outstanding: 0, tour: 0, visit: 0 },
    branches: [],
    users: [],
    registers: [],
    vouchers: [],
    attachments: [],
    statements: [],
    outstanding: [],
    tours: [],
    visits: [],
    notifications: [],
    audit: [],
    settings: DEFAULT_SETTINGS(),
    sessions: {},
    loginFails: {},
  });

  RW.createServer = function (opts) {
    opts = opts || {};
    const storage = opts.storage;
    const bus = opts.bus || RW.makeBus('rw-demo', { channel: false });
    const lock = opts.lock || RW.makeLock('rw-demo-db');
    const clock = opts.now || (() => Date.now());
    const iterations = opts.hashIterations || 60000;
    const KEY = 'db';
    const M = {}; // method table

    const nowIso = () => new Date(clock()).toISOString();
    const todayIst = () => RW.today(clock());

    // `forWrite` lets a server-side storage hand out a private copy only when the caller will mutate it
    // (read-only calls can share the cached snapshot). Browser storages always return a fresh copy.
    async function load(forWrite) {
      const s = await storage.get(KEY, !!forWrite);
      return s ? withDefaults(s, !!forWrite) : emptyState();
    }
    // A database written by an older version lacks the newer lists (tours, meetings). Fill them in. A read-only
    // call may be handed a shared (even frozen) snapshot, so it gets a shallow copy instead of changing it.
    function withDefaults(s, mutate) {
      const e = emptyState();
      const missing = Object.keys(e).some((k) => s[k] === undefined) || Object.keys(e.seq).some((k) => !s.seq || s.seq[k] === undefined);
      if (!missing) return s;
      const t = mutate ? s : Object.assign({}, s);
      for (const k of Object.keys(e)) if (t[k] === undefined) t[k] = e[k];
      t.seq = Object.assign({}, e.seq, s.seq);
      return t;
    }
    async function commit(state, blobs) {
      if (blobs) for (const id of Object.keys(blobs)) await storage.set('att:' + id, blobs[id]);
      state.rev = (state.rev || 0) + 1;
      await storage.set(KEY, state);
      bus.post({ type: 'changed', rev: state.rev });
    }

    /* ------------------------------------------------------------ helpers */
    const userById = (s, id) => s.users.find((u) => u.id === id) || null;
    const branchById = (s, id) => s.branches.find((b) => b.id === id) || null;
    const isSuper = (u) => u.role === 'SUPER_ADMIN';                                  // the main admin: the ONLY role that can change things
    const seesAll = (u) => u.role === 'SUPER_ADMIN' || u.role === 'CEO';             // reads every branch, signs in from any branch
    const isAdmin = (u) => u.role === 'SUPER_ADMIN' || u.role === 'BRANCH_ADMIN' || u.role === 'CEO';   // admin-level screens (read-only for the CEO)
    const level = (u) => (seesAll(u) ? 'ALL' : u.role === 'USER' ? 'SELF' : 'BRANCH');

    function requireRole(ctx, roles) {
      if (!roles.includes(ctx.user.role)) throw new ApiError('FORBIDDEN', 'You do not have permission to do this');
    }
    function canSeeVoucher(u, v) {
      switch (level(u)) {
        case 'ALL': return true;
        case 'BRANCH': return v.branchId === u.branchId;
        default: return v.userId === u.id;
      }
    }
    // Can actor read the data of target user (register, statement, reports)?
    function canSeeUser(actor, target) {
      if (!target || target.deleted) return false;
      switch (level(actor)) {
        case 'ALL': return true;
        case 'BRANCH': return target.branchId === actor.branchId;
        default: return target.id === actor.id;
      }
    }
    // Can actor correct a voucher (edit, void, change its number, remove its attachments, review it)?
    // Only the main (Super) admin. Branch admins can see their branch's vouchers but not change them.
    function canAdminVoucher(actor, v) {
      return actor.role === 'SUPER_ADMIN';
    }
    // Tours and meetings (tour details) are seen like vouchers: a User sees own, a Branch Admin / Viewer the branch, Super Admin and CEO everything.
    function canSeeOwned(u, rec) {
      switch (level(u)) {
        case 'ALL': return true;
        case 'BRANCH': return rec.branchId === u.branchId;
        default: return rec.userId === u.id;
      }
    }
    const scopeBranches = (s, u) => (seesAll(u) ? s.branches.filter((b) => true) : s.branches.filter((b) => b.id === u.branchId));

    function pubUser(s, u) {
      if (!u) return null;
      const b = branchById(s, u.branchId);
      const r = s.registers.find((x) => x.userId === u.id);
      return {
        id: u.id, fullName: u.fullName, username: u.username, email: u.email, mobile: u.mobile,
        designation: u.designation || '', branchId: u.branchId, branchName: b ? b.name : '', branchCode: b ? b.code : '',
        role: u.role, status: u.status, joiningDate: u.joiningDate, createdAt: u.createdAt,
        lastLoginAt: u.lastLoginAt || null, lastActivityAt: u.lastActivityAt || null,
        mustChangePassword: !!u.mustChangePassword, registerId: r ? r.id : null,
      };
    }
    /* A voucher's money counts only while it is ACTIVE and has not been marked "Not valid" in the audit review. */
    const counted = (v) => v.status === 'ACTIVE' && v.review !== 'INVALID';
    /* Review state shown to the client: payments are PENDING until an admin marks them; receipts / cash received are not reviewed. */
    const reviewOf = (v) => (v.type === 'PAYMENT' ? v.review || 'PENDING' : 'NA');
    const vlabel = (v) => v.number || 'Cash Received';
    function vView(s, v) {
      const b = branchById(s, v.branchId);
      const u = userById(s, v.userId);
      const cb = userById(s, v.createdBy);
      const ub = userById(s, v.updatedBy);
      const r = s.registers.find((x) => x.userId === v.userId);
      return {
        id: v.id, seq: v.seq, number: v.number, kind: v.kind === 'RECEIVED' ? 'RECEIVED' : 'VOUCHER', label: vlabel(v), type: v.type, branchId: v.branchId,
        branchName: b ? b.name : '', branchCode: b ? b.code : '',
        userId: v.userId, userName: u ? u.fullName : 'Unknown', registerId: r ? r.id : '',
        date: v.date, partyName: v.partyName, particulars: v.particulars, notes: v.notes || '',
        amountPaise: v.amountPaise, amount: v.amountPaise / 100, amountInWords: v.amountInWords,
        status: v.status, locked: true, attachmentCount: v.attachmentIds.length,
        createdAt: v.createdAt, createdBy: cb ? cb.fullName : '', updatedAt: v.updatedAt,
        updatedBy: ub ? ub.fullName : '', voidReason: v.voidReason || '', version: v.version,
        review: reviewOf(v), counted: counted(v), reviewReason: v.reviewReason || '', reviewedAt: v.reviewedAt || null,
        reviewedBy: (userById(s, v.reviewedBy) || {}).fullName || '',
      };
    }

    async function audit(ctx, e) {
      const s = ctx.state;
      const last = s.audit[s.audit.length - 1];
      const entry = {
        id: 'au_' + (++s.seq.audit), seq: s.seq.audit, at: e.at || nowIso(),
        actorId: ctx.user ? ctx.user.id : null,
        actorName: ctx.user ? ctx.user.fullName : e.actorName || 'Anonymous',
        actorRole: ctx.user ? ctx.user.role : '',
        branchId: e.branchId !== undefined ? e.branchId : ctx.user ? ctx.user.branchId : null,
        entity: e.entity, entityId: e.entityId || null, entityLabel: e.entityLabel || '',
        action: e.action, old: e.old === undefined ? null : e.old, new: e.new === undefined ? null : e.new,
        reason: e.reason || '', device: (ctx.meta && ctx.meta.device) || '', ip: (ctx.meta && ctx.meta.ip) || 'demo',
        prevHash: last ? last.hash : 'GENESIS',
      };
      entry.hash = await RW.sha256Hex(entry.prevHash + RW.canonical(entry));
      s.audit.push(entry);
      return entry;
    }

    function notify(ctx, n) {
      const s = ctx.state;
      s.notifications.push({
        id: 'nt_' + (++s.seq.notif), at: n.at || nowIso(), kind: n.kind, title: n.title, body: n.body || '',
        branchId: n.branchId === undefined ? null : n.branchId, forAdmins: n.forAdmins !== false,
        targetUserId: n.targetUserId || null, voucherId: n.voucherId || null, important: !!n.important,
        actorId: ctx.user ? ctx.user.id : null, readBy: {},
      });
      if (s.notifications.length > 3000) s.notifications.splice(0, s.notifications.length - 3000);
    }

    function checkPassword(pw) {
      if (typeof pw !== 'string' || pw.length < 8) throw new ApiError('VALIDATION', 'Password must be at least 8 characters');
      if (!/[A-Za-z]/.test(pw) || !/\d/.test(pw)) throw new ApiError('VALIDATION', 'Password must contain letters and numbers');
      if (pw.length > 128) throw new ApiError('VALIDATION', 'Password is too long');
    }

    async function makeCredentials(password) {
      const salt = RW.randomHex(16);
      return { pwSalt: salt, pwIter: iterations, pwHash: await RW.hashPassword(password, salt, iterations) };
    }

    /* Balance of one register up to (and excluding) `before` (YYYY-MM-DD) or overall. */
    function netFor(s, predicate) {
      let i = 0, o = 0, n = 0;
      for (const v of s.vouchers) {
        if (!counted(v) || !predicate(v)) continue;
        n++;
        if (v.type === 'RECEIPT') i += v.amountPaise; else o += v.amountPaise;
      }
      return { inPaise: i, outPaise: o, count: n, netPaise: i - o };
    }
    const registerOf = (s, userId) => s.registers.find((r) => r.userId === userId) || null;
    function currentBalance(s, userId) {
      const r = registerOf(s, userId);
      const t = netFor(s, (v) => v.userId === userId);
      return (r ? r.openingPaise : 0) + t.netPaise;
    }

    /* -------------------------------------------------------- authentication */
    const DUMMY_SALT = '00112233445566778899aabbccddeeff';
    async function authenticate(ctx, token) {
      if (!token) throw new ApiError('UNAUTHENTICATED', 'Please sign in');
      const key = await RW.sha256Hex(String(token));
      const sess = ctx.state.sessions[key];
      if (!sess || Date.parse(sess.expiresAt) < clock()) throw new ApiError('UNAUTHENTICATED', 'Your session has expired. Please sign in again.');
      const u = userById(ctx.state, sess.userId);
      if (!u || u.deleted) throw new ApiError('UNAUTHENTICATED', 'Account not found');
      if (u.status !== 'ACTIVE') throw new ApiError('ACCOUNT_DISABLED', 'Your account has been deactivated. Contact your administrator.');
      const b = branchById(ctx.state, u.branchId);
      if (!seesAll(u) && (!b || b.status !== 'ACTIVE')) throw new ApiError('ACCOUNT_DISABLED', 'Your branch has been disabled. Contact your administrator.');
      ctx.user = u;
      ctx.branch = b;
      ctx.sessionKey = key;
    }

    /* --------------------------------------------------------------- dispatcher */
    function def(name, o, fn) { M[name] = Object.assign({ fn }, o); }

    async function call(token, method, params, meta) {
      const d = M[method];
      if (!d) throw new ApiError('NOT_FOUND', 'Unknown method: ' + method);
      const run = async () => {
        const state = await load(!!d.w);
        const ctx = {
          state, meta: meta || {}, user: null, branch: null, blobs: {}, dirty: true, storage,
          save: async () => { await commit(state, ctx.blobs); ctx.blobs = {}; ctx.dirty = false; },
        };
        if (!d.pub) await authenticate(ctx, token);
        if (d.roles && !d.roles.includes(ctx.user.role)) throw new ApiError('FORBIDDEN', 'You do not have permission to do this');
        const res = await d.fn(ctx, params || {}, token);
        if (d.w && ctx.dirty) {
          if (ctx.user) {
            const u = userById(state, ctx.user.id);
            if (u) u.lastActivityAt = nowIso();
          }
          await commit(state, ctx.blobs);
        }
        return res;
      };
      return d.w ? lock(run) : run();
    }

    const H = {
      ApiError, def, M, storage, bus, iterations, clock, nowIso, todayIst, load, commit, emptyState, DEFAULT_SETTINGS,
      userById, branchById, isSuper, seesAll, isAdmin, level, requireRole, canSeeVoucher, canSeeUser, canSeeOwned, canAdminVoucher, scopeBranches,
      pubUser, vView, counted, reviewOf, vlabel, audit, notify, checkPassword, makeCredentials, netFor, registerOf, currentBalance, authenticate,
      setupKey: String(opts.setupKey || '').trim(),   // optional: first-time setup on a public server needs this key
      beforeWipe: opts.beforeWipe || null,   // optional: a server with real storage makes a safety backup before "clear all data"
      beforeErase: opts.beforeErase || null,      // optional: ... and a (cheap, throttled) copy before any permanent delete of vouchers, users or branches
      beforeRestore: opts.beforeRestore || null,  // optional: ... and a full copy of what is there before a backup is restored over it
      maxBackupMb: opts.maxBackupMb || 0,         // the largest backup file this server accepts (0 = no limit, e.g. the browser demo)
    };

    /* ------------------------------------------------------------ auth methods */
    def('auth.login', { pub: true, w: true }, async (ctx, p) => {
      const s = ctx.state;
      const ident = String(p.identifier || '').trim().toLowerCase();
      const password = String(p.password || '');
      const code = String(p.branchCode || '').trim().toUpperCase();
      if (!ident || !password) throw new ApiError('VALIDATION', 'Enter your username and password');
      const f = s.loginFails[ident];
      if (f && f.lockedUntil && f.lockedUntil > clock()) {
        const mins = Math.ceil((f.lockedUntil - clock()) / 60000);
        ctx.dirty = false;
        throw new ApiError('RATE_LIMIT', 'Too many failed attempts. Try again in ' + mins + ' minute' + (mins > 1 ? 's' : '') + '.');
      }
      const u = s.users.find((x) => !x.deleted && (x.username === ident || (x.email || '').toLowerCase() === ident));
      const hash = await RW.hashPassword(password, u ? u.pwSalt : DUMMY_SALT, u ? u.pwIter : iterations);
      const branch = s.branches.find((b) => b.code === code);
      const ok = !!(u && branch && RW.timingSafeEqualHex(hash, u.pwHash) && (seesAll(u) || u.branchId === branch.id));
      if (!ok) {
        const rec = s.loginFails[ident] && s.loginFails[ident].first > clock() - 600000 ? s.loginFails[ident] : { count: 0, first: clock() };
        rec.count++;
        if (rec.count >= 5) { rec.lockedUntil = clock() + 300000; rec.count = 0; rec.first = clock(); }
        s.loginFails[ident] = rec;
        ctx.meta.device = ctx.meta.device || '';
        await audit(ctx, { entity: 'AUTH', action: 'LOGIN_FAILED', entityLabel: ident, branchId: branch ? branch.id : null, actorName: ident });
        await ctx.save();
        throw new ApiError('UNAUTHENTICATED', 'Invalid branch, username or password');
      }
      delete s.loginFails[ident];
      if (u.status !== 'ACTIVE') throw new ApiError('ACCOUNT_DISABLED', 'Your account is ' + u.status.toLowerCase() + '. Contact your administrator.');
      const ub = branchById(s, u.branchId);
      if (!seesAll(u) && ub.status !== 'ACTIVE') throw new ApiError('ACCOUNT_DISABLED', 'This branch is disabled. Contact your administrator.');
      // purge expired sessions
      for (const k of Object.keys(s.sessions)) if (Date.parse(s.sessions[k].expiresAt) < clock()) delete s.sessions[k];
      const token = RW.randomHex(24);
      const hours = p.remember ? s.settings.rememberDays * 24 : s.settings.sessionHours;
      const expiresAt = new Date(clock() + hours * 3600000).toISOString();
      s.sessions[await RW.sha256Hex(token)] = { userId: u.id, createdAt: nowIso(), expiresAt, device: ctx.meta.device || '' };
      u.lastLoginAt = nowIso();
      ctx.user = u;
      await audit(ctx, { entity: 'AUTH', action: 'LOGIN', entityId: u.id, entityLabel: u.username });
      return { token, expiresAt, user: pubUser(s, u), branch: branchById(s, u.branchId) };
    });

    def('auth.logout', { w: true }, async (ctx) => {
      delete ctx.state.sessions[ctx.sessionKey];
      await audit(ctx, { entity: 'AUTH', action: 'LOGOUT', entityId: ctx.user.id, entityLabel: ctx.user.username });
      return { ok: true };
    });

    def('auth.me', {}, async (ctx) => {
      const s = ctx.state;
      const r = registerOf(s, ctx.user.id);
      return {
        user: pubUser(s, ctx.user), branch: branchById(s, ctx.user.branchId),
        register: r ? { id: r.id, openingPaise: r.openingPaise, balancePaise: currentBalance(s, ctx.user.id) } : null,
        settings: { company: s.settings.company, fiscalYearStartMonth: s.settings.fiscalYearStartMonth, maxAttachments: s.settings.maxAttachments, userBackdateDays: s.settings.userBackdateDays, maxVoucherAmountPaise: s.settings.maxVoucherAmountPaise, numbering: s.settings.numbering, blockNegativeCash: !!s.settings.blockNegativeCash },
        today: todayIst(),
      };
    });

    def('auth.changePassword', { w: true }, async (ctx, p) => {
      const u = ctx.user;
      const cur = await RW.hashPassword(String(p.currentPassword || ''), u.pwSalt, u.pwIter);
      if (!RW.timingSafeEqualHex(cur, u.pwHash)) throw new ApiError('VALIDATION', 'Current password is incorrect');
      checkPassword(p.newPassword);
      if (p.newPassword === p.currentPassword) throw new ApiError('VALIDATION', 'Choose a different password');
      Object.assign(u, await makeCredentials(p.newPassword));
      u.mustChangePassword = false;
      // sign out every other session of this user
      const keep = ctx.sessionKey;
      for (const k of Object.keys(ctx.state.sessions)) if (k !== keep && ctx.state.sessions[k].userId === u.id) delete ctx.state.sessions[k];
      await audit(ctx, { entity: 'USER', action: 'PASSWORD_CHANGED', entityId: u.id, entityLabel: u.username });
      return { ok: true };
    });

    // Branch list for the login screen: names only, no sensitive data.
    def('branches.public', { pub: true }, async (ctx) => ({
      branches: ctx.state.branches.filter((b) => b.status === 'ACTIVE').map((b) => ({ id: b.id, code: b.code, name: b.name })),
      company: ctx.state.settings.company,
      empty: ctx.state.users.length === 0,
      setupKeyRequired: ctx.state.users.length === 0 && !!H.setupKey,
    }));

    def('system.ping', { pub: true }, async () => ({ ok: true, time: nowIso() }));

    /* ------------------------------------------------------------ plug in modules */
    RW.serverModules.forEach((m) => m(H));

    return {
      call,
      helpers: H,
      load,
      async raw() { return load(); },
      async isEmpty() { const s = await load(); return s.users.length === 0; },
      async replaceState(s) { await storage.set(KEY, s); bus.post({ type: 'changed', rev: s.rev || 0 }); },
      async wipe() {
        const keys = await storage.keys();
        for (const k of keys) await storage.del(k);
        bus.post({ type: 'reset' });
      },
      bus,
    };
  };
  RW.emptyState = emptyState;
})(typeof window !== 'undefined' ? window : globalThis);
