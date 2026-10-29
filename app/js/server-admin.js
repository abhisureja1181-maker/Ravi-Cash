/* Ravi Cash — DEMO BACKEND: users, branches, settings, audit, notifications, outstanding,
 * dashboards, reports, search and export. */
(function (g) {
  'use strict';
  const RW = (g.RW = g.RW || {});
  RW.serverModules = RW.serverModules || [];

  RW.serverModules.push(function (H) {
    const { ApiError, def, userById, branchById, isAdmin, isSuper, seesAll, level, counted, canSeeUser, canSeeVoucher, vView, pubUser, audit, notify, nowIso, todayIst, cleanText, cleanMultiline, filterVouchers, totalsOf } = H;

    const ADMINS = ['SUPER_ADMIN', 'BRANCH_ADMIN', 'CEO'];   // may open the admin screens (only SUPER_ADMIN can change anything)
    const ROLES = ['SUPER_ADMIN', 'CEO', 'BRANCH_ADMIN', 'USER', 'VIEWER'];
    const NO_REGISTER = ['VIEWER', 'CEO'];                 // these roles do not handle cash, so they have no cash register
    const STATUSES = ['ACTIVE', 'INACTIVE', 'SUSPENDED'];

    /* ================================================================ branches */
    function branchStats(s, b, from, to) {
      const t = totalsOf(s.vouchers.filter((v) => v.branchId === b.id && (!from || v.date >= from) && (!to || v.date <= to)));
      const all = totalsOf(s.vouchers.filter((v) => v.branchId === b.id));
      const opening = s.registers.reduce((a, r) => { const u = userById(s, r.userId); return u && u.branchId === b.id ? a + r.openingPaise : a; }, 0);
      return {
        id: b.id, code: b.code, name: b.name, address: b.address, contact: b.contact, status: b.status, createdAt: b.createdAt,
        userCount: s.users.filter((u) => u.branchId === b.id && !u.deleted && u.status === 'ACTIVE').length,
        inPaise: t.inPaise, outPaise: t.outPaise, netPaise: t.netPaise, count: t.count,
        balancePaise: opening + all.netPaise, openingPaise: opening,
      };
    }
    H.branchStats = branchStats;

    function makeBranchCode(s, name) {
      const tail = String(name).split(/\s[-–—]\s/).pop().replace(/[^A-Za-z0-9 ]/g, '').trim();
      let base = (tail.split(/\s+/)[0] || 'BR').toUpperCase().slice(0, 8);
      if (base.length < 2) base = 'BR';
      let code = base, n = 1;
      while (s.branches.some((b) => b.code === code)) code = base.slice(0, 6) + String(++n);
      return code;
    }
    function makeRegPrefix(s, code) {
      const letters = code.replace(/[^A-Z]/g, '') || 'BRN';
      for (let len = 3; len <= Math.max(3, letters.length); len++) {
        const pre = letters.slice(0, len);
        if (!s.branches.some((b) => b.regPrefix === pre)) return pre;
      }
      return (letters.slice(0, 3) + RW.randomHex(1).toUpperCase()).slice(0, 5);
    }
    H.makeRegPrefix = makeRegPrefix;

    def('branches.list', {}, async (ctx, p) => {
      const s = ctx.state;
      const r = p && p.preset ? RW.rangeFor(p.preset, todayIst(), s.settings.fiscalYearStartMonth) : null;
      const list = H.scopeBranches(s, ctx.user).map((b) => branchStats(s, b, r && r.from, r && r.to));
      return { rows: list };
    });

    def('branches.create', { w: true, roles: ['SUPER_ADMIN'] }, async (ctx, p) => {
      const s = ctx.state;
      const name = cleanText(p.name, 3, 100, 'Branch name');
      let code = p.code ? String(p.code).trim().toUpperCase() : makeBranchCode(s, name);
      if (!/^[A-Z0-9]{2,10}$/.test(code)) throw new ApiError('VALIDATION', 'Branch code must be 2-10 letters or digits');
      if (s.branches.some((b) => b.code === code)) throw new ApiError('CONFLICT', 'Branch code ' + code + ' is already used');
      const b = {
        id: RW.uid('br'), code, regPrefix: makeRegPrefix(s, code), name, address: cleanText(p.address || '-', 1, 300, 'Address'),
        contact: cleanText(p.contact || '-', 1, 100, 'Contact'), status: 'ACTIVE', createdAt: nowIso(),
      };
      s.branches.push(b);
      await audit(ctx, { entity: 'BRANCH', entityId: b.id, entityLabel: b.name, action: 'CREATE', branchId: b.id, new: { code: b.code, name: b.name } });
      return { branch: branchStats(s, b) };
    });

    def('branches.update', { w: true, roles: ['SUPER_ADMIN'] }, async (ctx, p) => {
      const s = ctx.state;
      const b = branchById(s, p.id);
      if (!b) throw new ApiError('NOT_FOUND', 'Branch not found');
      const old = { name: b.name, address: b.address, contact: b.contact };
      if (p.name !== undefined) b.name = cleanText(p.name, 3, 100, 'Branch name');
      if (p.address !== undefined) b.address = cleanText(p.address, 1, 300, 'Address');
      if (p.contact !== undefined) b.contact = cleanText(p.contact, 1, 100, 'Contact');
      await audit(ctx, { entity: 'BRANCH', entityId: b.id, entityLabel: b.name, action: 'EDIT', branchId: b.id, old, new: { name: b.name, address: b.address, contact: b.contact } });
      return { branch: branchStats(s, b) };
    });

    def('branches.setStatus', { w: true, roles: ['SUPER_ADMIN'] }, async (ctx, p) => {
      const s = ctx.state;
      const b = branchById(s, p.id);
      if (!b) throw new ApiError('NOT_FOUND', 'Branch not found');
      if (p.status !== 'ACTIVE' && p.status !== 'DISABLED') throw new ApiError('VALIDATION', 'Invalid status');
      if (p.status === 'DISABLED' && ctx.user.branchId === b.id && s.branches.filter((x) => x.status === 'ACTIVE').length <= 1) throw new ApiError('VALIDATION', 'The last active branch cannot be disabled');
      const old = b.status;
      b.status = p.status;
      if (p.status === 'DISABLED') for (const k of Object.keys(s.sessions)) { const u = userById(s, s.sessions[k].userId); if (u && u.branchId === b.id && !seesAll(u)) delete s.sessions[k]; }
      await audit(ctx, { entity: 'BRANCH', entityId: b.id, entityLabel: b.name, action: 'STATUS', branchId: b.id, old: { status: old }, new: { status: b.status }, reason: p.reason || '' });
      return { branch: branchStats(s, b) };
    });

    /* ================================================================== users */
    function nextRegisterId(s, branch, fullName) {
      const ini = RW.initials(fullName);
      let n = s.registers.filter((r) => r.id.startsWith(branch.regPrefix + '-' + ini + '-')).length + 1;
      let id;
      do { id = branch.regPrefix + '-' + ini + '-' + String(n++).padStart(3, '0'); } while (s.registers.some((r) => r.id === id));
      return id;
    }
    H.nextRegisterId = nextRegisterId;

    function checkUserFields(s, p, existing) {
      const out = {};
      if (!existing || p.fullName !== undefined) out.fullName = cleanText(p.fullName, 3, 80, 'Full name');
      if (!existing || p.email !== undefined) {
        const e = String(p.email || '').trim().toLowerCase();
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(e)) throw new ApiError('VALIDATION', 'Enter a valid email address');
        if (s.users.some((u) => !u.deleted && u.id !== (existing && existing.id) && (u.email || '').toLowerCase() === e)) throw new ApiError('CONFLICT', 'This email is already used by another user');
        out.email = e;
      }
      if (!existing || p.mobile !== undefined) {
        let m = String(p.mobile || '').replace(/[\s-]/g, '').replace(/^\+?91/, '');
        if (m && !/^[6-9]\d{9}$/.test(m)) throw new ApiError('VALIDATION', 'Enter a valid 10-digit mobile number');
        out.mobile = m;
      }
      if (!existing || p.designation !== undefined) out.designation = p.designation ? cleanText(p.designation, 0, 60, 'Designation') : '';
      if (!existing || p.joiningDate !== undefined) {
        const d = p.joiningDate || todayIst();
        if (!RW.isValidDate(d)) throw new ApiError('VALIDATION', 'Enter a valid joining date');
        out.joiningDate = d;
      }
      return out;
    }
    function lastSuperGuard(s, target, why) {
      if (target.role === 'SUPER_ADMIN' && target.status === 'ACTIVE' && !s.users.some((u) => u.id !== target.id && !u.deleted && u.role === 'SUPER_ADMIN' && u.status === 'ACTIVE')) {
        throw new ApiError('VALIDATION', 'There must always be at least one active Super Admin (' + why + ')');
      }
    }
    // Can actor manage target user? Only the main (Super) admin creates, edits, disables or resets users.
    function canManage(actor, target) {
      return isSuper(actor);
    }
    function mustManage(ctx, id) {
      const t = userById(ctx.state, id);
      if (!t || t.deleted || !canSeeUser(ctx.user, t)) throw new ApiError('NOT_FOUND', 'User not found');
      if (!canManage(ctx.user, t)) throw new ApiError('FORBIDDEN', 'You cannot manage this user');
      return t;
    }
    function dropSessions(s, userId) { for (const k of Object.keys(s.sessions)) if (s.sessions[k].userId === userId) delete s.sessions[k]; }

    def('users.list', { roles: ['SUPER_ADMIN', 'BRANCH_ADMIN', 'CEO', 'VIEWER'] }, async (ctx, p) => {
      const s = ctx.state;
      const f = (p && p.filters) || {};
      const q = String(f.q || '').trim().toLowerCase();
      const rows = s.users
        .filter((u) => !u.deleted && canSeeUser(ctx.user, u) && (!f.branchId || u.branchId === f.branchId) && (!f.role || u.role === f.role) && (!f.status || u.status === f.status)
          && (!q || (u.fullName + ' ' + u.username + ' ' + u.email + ' ' + (u.mobile || '')).toLowerCase().includes(q)))
        .map((u) => {
          const t = H.netFor(s, (v) => v.userId === u.id);
          const reg = H.registerOf(s, u.id);
          return Object.assign(pubUser(s, u), { voucherCount: t.count, balancePaise: reg ? reg.openingPaise + t.netPaise : null, canManage: canManage(ctx.user, u) });
        })
        .sort((a, b) => a.branchName.localeCompare(b.branchName) || a.fullName.localeCompare(b.fullName));
      return { rows };
    });

    def('users.create', { w: true, roles: ['SUPER_ADMIN'] }, async (ctx, p) => {
      const s = ctx.state, actor = ctx.user;
      const role = p.role || 'USER';
      if (!ROLES.includes(role)) throw new ApiError('VALIDATION', 'Invalid role');
      if (!isSuper(actor) && !(role === 'USER' || role === 'VIEWER')) throw new ApiError('FORBIDDEN', 'You can only create Users and Viewers');
      const branchId = isSuper(actor) ? p.branchId : actor.branchId;
      const branch = branchById(s, branchId);
      if (!branch) throw new ApiError('VALIDATION', 'Choose a branch');
      const username = String(p.username || '').trim().toLowerCase();
      if (!/^[a-z0-9._-]{3,32}$/.test(username)) throw new ApiError('VALIDATION', 'Username: 3-32 characters (letters, numbers, . _ -)');
      if (s.users.some((u) => !u.deleted && u.username === username)) throw new ApiError('CONFLICT', 'Username "' + username + '" is already taken');
      const f = checkUserFields(s, p, null);
      const temp = p.password ? null : RW.randomPassword();
      const password = p.password || temp;
      H.checkPassword(password);
      const u = Object.assign({
        id: RW.uid('u'), username, branchId: branch.id, role, status: 'ACTIVE', createdAt: nowIso(), createdBy: actor.id,
        mustChangePassword: true, deleted: false, lastLoginAt: null, lastActivityAt: null,
      }, f, await H.makeCredentials(password));
      s.users.push(u);
      if (!NO_REGISTER.includes(role)) s.registers.push({ id: nextRegisterId(s, branch, u.fullName), userId: u.id, branchId: branch.id, openingPaise: 0, createdAt: nowIso() });
      await audit(ctx, { entity: 'USER', entityId: u.id, entityLabel: u.fullName + ' (' + u.username + ')', action: 'CREATE', branchId: branch.id, new: { username, role, branch: branch.name } });
      notify(ctx, { kind: 'USER_CREATED', title: 'New user created', body: u.fullName + ' (' + role.replace('_', ' ').toLowerCase() + ') added to ' + branch.name, branchId: branch.id });
      return { user: pubUser(s, u), tempPassword: temp };
    });

    /* First-run setup for a real (non-demo) installation: creates the first branch and Super Admin.
     * Works exactly once - as soon as any user exists it is refused. Runs under the write lock, so two
     * people opening the setup screen at the same time cannot both succeed. */
    def('system.setup', { pub: true, w: true }, async (ctx, p) => {
      const s = ctx.state;
      if (s.users.length || s.branches.length) throw new ApiError('FORBIDDEN', 'This system is already set up. Sign in instead.');
      if (H.setupKey) {   // a server on the internet: only the owner (who knows SETUP_KEY) may create the first Super Admin
        const given = await RW.sha256Hex('setup-key:' + String(p.setupKey || '').trim()), want = await RW.sha256Hex('setup-key:' + H.setupKey);
        if (!RW.timingSafeEqualHex(given, want)) throw new ApiError('FORBIDDEN', 'Wrong or missing setup key. It is the SETUP_KEY value from your hosting settings.');
      }
      const company = cleanText(p.companyName || 'Ravi Water Flow Pump', 3, 100, 'Business name');
      const branchName = cleanText(p.branchName, 3, 100, 'Branch name');
      const code = p.branchCode ? String(p.branchCode).trim().toUpperCase() : makeBranchCode(s, branchName);
      if (!/^[A-Z0-9]{2,10}$/.test(code)) throw new ApiError('VALIDATION', 'Branch code must be 2-10 letters or digits');
      const username = String(p.username || '').trim().toLowerCase();
      if (!/^[a-z0-9._-]{3,32}$/.test(username)) throw new ApiError('VALIDATION', 'Username: 3-32 characters (letters, numbers, . _ -)');
      const f = checkUserFields(s, p, null);
      H.checkPassword(p.password);
      s.settings.company = Object.assign({}, s.settings.company, { name: company.toUpperCase() });
      const b = { id: RW.uid('br'), code, regPrefix: makeRegPrefix(s, code), name: branchName, address: '-', contact: '-', status: 'ACTIVE', createdAt: nowIso() };
      s.branches.push(b);
      const u = Object.assign({ id: RW.uid('u'), username, branchId: b.id, role: 'SUPER_ADMIN', status: 'ACTIVE', createdAt: nowIso(), createdBy: null,
        mustChangePassword: false, deleted: false, lastLoginAt: nowIso(), lastActivityAt: null }, f, await H.makeCredentials(p.password));
      s.users.push(u);
      s.registers.push({ id: nextRegisterId(s, b, u.fullName), userId: u.id, branchId: b.id, openingPaise: 0, createdAt: nowIso() });
      ctx.user = u;
      await audit(ctx, { entity: 'SETTINGS', entityId: 'setup', entityLabel: 'First-time setup', action: 'CREATE', branchId: b.id, new: { company, branch: b.name, superAdmin: u.username } });
      const token = RW.randomHex(24);
      const expiresAt = new Date(H.clock() + s.settings.sessionHours * 3600000).toISOString();
      s.sessions[await RW.sha256Hex(token)] = { userId: u.id, createdAt: nowIso(), expiresAt, device: (ctx.meta && ctx.meta.device) || '' };
      return { token, expiresAt, user: pubUser(s, u), branch: b };
    });

    def('users.update', { w: true, roles: ['SUPER_ADMIN'] }, async (ctx, p) => {
      const s = ctx.state, actor = ctx.user;
      const t = mustManage(ctx, p.id);
      const f = checkUserFields(s, p, t);
      const old = {}, nw = {};
      for (const k of Object.keys(f)) if (f[k] !== t[k]) { old[k] = t[k]; nw[k] = f[k]; t[k] = f[k]; }
      if (p.role !== undefined && p.role !== t.role) {
        if (!isSuper(actor)) throw new ApiError('FORBIDDEN', 'Only a Super Admin can change roles');
        if (!ROLES.includes(p.role)) throw new ApiError('VALIDATION', 'Invalid role');
        if (t.id === actor.id) throw new ApiError('VALIDATION', 'You cannot change your own role');
        if (t.role === 'SUPER_ADMIN') lastSuperGuard(s, t, 'role change');
        old.role = t.role; nw.role = p.role; t.role = p.role;
        if (!NO_REGISTER.includes(p.role) && !H.registerOf(s, t.id)) s.registers.push({ id: nextRegisterId(s, branchById(s, t.branchId), t.fullName), userId: t.id, branchId: t.branchId, openingPaise: 0, createdAt: nowIso() });
        dropSessions(s, t.id); // force re-login with the new permissions
      }
      if (p.branchId !== undefined && p.branchId !== t.branchId) {
        if (!isSuper(actor)) throw new ApiError('FORBIDDEN', 'Only a Super Admin can move a user to another branch');
        const nb = branchById(s, p.branchId);
        if (!nb) throw new ApiError('VALIDATION', 'Choose a valid branch');
        if (s.vouchers.some((v) => v.userId === t.id)) throw new ApiError('VALIDATION', 'This user already has vouchers, so the branch cannot be changed. Create a new user in the other branch instead.');
        old.branch = branchById(s, t.branchId).name; nw.branch = nb.name; t.branchId = nb.id;
        const reg = H.registerOf(s, t.id);
        if (reg) { reg.branchId = nb.id; reg.id = nextRegisterId(s, nb, t.fullName); }
        dropSessions(s, t.id);
      }
      if (!Object.keys(nw).length) throw new ApiError('VALIDATION', 'Nothing was changed');
      await audit(ctx, { entity: 'USER', entityId: t.id, entityLabel: t.fullName + ' (' + t.username + ')', action: 'EDIT', branchId: t.branchId, old, new: nw });
      return { user: pubUser(s, t) };
    });

    def('users.setStatus', { w: true, roles: ['SUPER_ADMIN'] }, async (ctx, p) => {
      const s = ctx.state;
      const t = mustManage(ctx, p.id);
      if (!STATUSES.includes(p.status)) throw new ApiError('VALIDATION', 'Invalid status');
      if (t.id === ctx.user.id) throw new ApiError('VALIDATION', 'You cannot change your own status');
      if (p.status !== 'ACTIVE') lastSuperGuard(s, t, 'deactivation');
      const old = t.status;
      t.status = p.status;
      if (p.status !== 'ACTIVE') dropSessions(s, t.id); // takes effect immediately
      await audit(ctx, { entity: 'USER', entityId: t.id, entityLabel: t.fullName + ' (' + t.username + ')', action: 'STATUS', branchId: t.branchId, old: { status: old }, new: { status: p.status }, reason: p.reason || '' });
      notify(ctx, { kind: 'USER_STATUS', title: 'User ' + p.status.toLowerCase(), body: t.fullName + ' is now ' + p.status.toLowerCase(), branchId: t.branchId });
      return { user: pubUser(s, t) };
    });

    def('users.resetPassword', { w: true, roles: ['SUPER_ADMIN'] }, async (ctx, p) => {
      const s = ctx.state;
      const t = mustManage(ctx, p.id);
      if (t.id === ctx.user.id) throw new ApiError('VALIDATION', 'Use "Change password" for your own account');
      const temp = p.newPassword ? null : RW.randomPassword();
      const pw = p.newPassword || temp;
      H.checkPassword(pw);
      Object.assign(t, await H.makeCredentials(pw));
      t.mustChangePassword = true;
      dropSessions(s, t.id);
      await audit(ctx, { entity: 'USER', entityId: t.id, entityLabel: t.fullName + ' (' + t.username + ')', action: 'PASSWORD_RESET', branchId: t.branchId });
      return { tempPassword: temp };
    });

    def('users.delete', { w: true, roles: ['SUPER_ADMIN'] }, async (ctx, p) => {
      const s = ctx.state;
      const t = userById(s, p.id);
      if (!t || t.deleted) throw new ApiError('NOT_FOUND', 'User not found');
      if (t.id === ctx.user.id) throw new ApiError('VALIDATION', 'You cannot delete your own account');
      lastSuperGuard(s, t, 'deletion');
      const reason = cleanText(p.reason, 5, 500, 'Reason');
      // Soft delete: vouchers and audit history created by this user remain intact.
      t.deleted = true; t.status = 'INACTIVE'; t.deletedAt = nowIso();
      dropSessions(s, t.id);
      await audit(ctx, { entity: 'USER', entityId: t.id, entityLabel: t.fullName + ' (' + t.username + ')', action: 'DELETE', branchId: t.branchId, reason });
      return { ok: true };
    });

    /* ============================================================== settings */
    def('settings.get', {}, async (ctx) => {
      const s = ctx.state;
      const st = s.settings;
      const base = { company: st.company, fiscalYearStartMonth: st.fiscalYearStartMonth, maxAttachments: st.maxAttachments, userBackdateDays: st.userBackdateDays };
      if (!isSuper(ctx.user)) return base;
      return Object.assign(base, {
        numbering: st.numbering, counters: Object.assign({}, s.counters), maxVoucherAmountPaise: st.maxVoucherAmountPaise,
        largePaymentAlertPaise: st.largePaymentAlertPaise, blockNegativeCash: st.blockNegativeCash, sessionHours: st.sessionHours, rememberDays: st.rememberDays,
        locationTracking: st.locationTracking !== false, locationKeepDays: Math.min(90, Math.max(7, parseInt(st.locationKeepDays, 10) || 30)),
      });
    });

    def('settings.update', { w: true, roles: ['SUPER_ADMIN'] }, async (ctx, p) => {
      const s = ctx.state, st = s.settings;
      const old = {}, nw = {};
      const set = (path, val) => { old[path] = path.split('.').reduce((o, k) => o[k], st); nw[path] = val; };
      if (p.company) {
        const c = p.company;
        const fields = { name: [3, 80], tagline: [0, 120], address: [0, 250], phone: [0, 40], email: [0, 80], gstin: [0, 20] };
        for (const k of Object.keys(fields)) if (c[k] !== undefined) { const v = cleanText(c[k], fields[k][0], fields[k][1], k); if (v !== st.company[k]) { set('company.' + k, v); st.company[k] = v; } }
      }
      if (p.numbering) {
        for (const t of ['PAYMENT', 'RECEIPT']) {
          const n = p.numbering[t];
          if (!n) continue;
          const prefix = String(n.prefix || '').trim().toUpperCase();
          const pad = parseInt(n.pad, 10);
          if (!/^[A-Z]{2,5}$/.test(prefix)) throw new ApiError('VALIDATION', 'Prefix must be 2-5 capital letters');
          if (!(pad >= 4 && pad <= 9)) throw new ApiError('VALIDATION', 'Number length must be between 4 and 9 digits');
          if (prefix !== st.numbering[t].prefix) { set('numbering.' + t + '.prefix', prefix); st.numbering[t].prefix = prefix; }
          if (pad !== st.numbering[t].pad) { set('numbering.' + t + '.pad', pad); st.numbering[t].pad = pad; }
        }
        if (st.numbering.PAYMENT.prefix === st.numbering.RECEIPT.prefix) throw new ApiError('VALIDATION', 'Payment and receipt prefixes must be different');
      }
      if (p.advanceCounter) {
        const t = p.advanceCounter.type;
        const to = parseInt(p.advanceCounter.to, 10);
        if (!(t === 'PAYMENT' || t === 'RECEIPT')) throw new ApiError('VALIDATION', 'Invalid voucher type');
        if (!(to > s.counters[t])) throw new ApiError('VALIDATION', 'The counter can only move forward (current: ' + s.counters[t] + ')');
        if (to > 999999999) throw new ApiError('VALIDATION', 'Counter is too large');
        old['counter.' + t] = s.counters[t]; nw['counter.' + t] = to; s.counters[t] = to;
      }
      if (p.fiscalYearStartMonth !== undefined) {
        const m = parseInt(p.fiscalYearStartMonth, 10);
        if (!(m >= 1 && m <= 12)) throw new ApiError('VALIDATION', 'Invalid month');
        if (m !== st.fiscalYearStartMonth) { set('fiscalYearStartMonth', m); st.fiscalYearStartMonth = m; }
      }
      if (p.maxVoucherAmount !== undefined) { const v = RW.toPaise(p.maxVoucherAmount); if (v < 100) throw new ApiError('VALIDATION', 'Limit is too low'); if (v !== st.maxVoucherAmountPaise) { set('maxVoucherAmountPaise', v); st.maxVoucherAmountPaise = v; } }
      if (p.largePaymentAlert !== undefined) { const v = RW.toPaise(p.largePaymentAlert); if (v !== st.largePaymentAlertPaise) { set('largePaymentAlertPaise', v); st.largePaymentAlertPaise = v; } }
      if (p.blockNegativeCash !== undefined && !!p.blockNegativeCash !== st.blockNegativeCash) { set('blockNegativeCash', st.blockNegativeCash); nw.blockNegativeCash = !!p.blockNegativeCash; st.blockNegativeCash = !!p.blockNegativeCash; }
      if (p.userBackdateDays !== undefined) { const v = parseInt(p.userBackdateDays, 10); if (!(v >= 0 && v <= 365)) throw new ApiError('VALIDATION', 'Back-date days must be 0-365'); if (v !== st.userBackdateDays) { set('userBackdateDays', v); st.userBackdateDays = v; } }
      if (p.locationTracking !== undefined && (p.locationTracking !== false) !== (st.locationTracking !== false)) { set('locationTracking', st.locationTracking !== false); nw.locationTracking = p.locationTracking !== false; st.locationTracking = p.locationTracking !== false; }
      if (p.locationKeepDays !== undefined) { const v = parseInt(p.locationKeepDays, 10); if (!(v >= 7 && v <= 90)) throw new ApiError('VALIDATION', 'Keep the location history for 7 to 90 days'); if (v !== (parseInt(st.locationKeepDays, 10) || 30)) { set('locationKeepDays', parseInt(st.locationKeepDays, 10) || 30); nw.locationKeepDays = v; st.locationKeepDays = v; } }
      if (!Object.keys(nw).length) throw new ApiError('VALIDATION', 'Nothing was changed');
      await audit(ctx, { entity: 'SETTINGS', entityId: 'settings', entityLabel: 'System settings', action: 'EDIT', branchId: null, old, new: nw, reason: p.reason || '' });
      return { ok: true };
    });

    /* =================================================================== audit */
    def('audit.list', { roles: ADMINS }, async (ctx, p) => {
      const s = ctx.state;
      const f = (p && p.filters) || {};
      const q = String(f.q || '').toLowerCase();
      let rows = s.audit.filter((a) => (seesAll(ctx.user) || a.branchId === ctx.user.branchId)
        && (!f.entity || a.entity === f.entity) && (!f.action || a.action === f.action) && (!f.userId || a.actorId === f.userId)
        && (!f.branchId || a.branchId === f.branchId)
        && (!f.from || RW.istDate(a.at) >= f.from) && (!f.to || RW.istDate(a.at) <= f.to)
        && (!q || (a.actorName + ' ' + a.entityLabel + ' ' + a.entityId + ' ' + a.reason + ' ' + a.action).toLowerCase().includes(q)));
      rows = rows.slice().reverse();
      const pageSize = Math.min(Math.max(parseInt(p.pageSize, 10) || 30, 1), 200);
      const pages = Math.max(1, Math.ceil(rows.length / pageSize));
      const page = Math.min(Math.max(parseInt(p.page, 10) || 1, 1), pages);
      return { total: rows.length, page, pages, pageSize, rows: rows.slice((page - 1) * pageSize, page * pageSize).map((a) => Object.assign({}, a, { branchName: (branchById(s, a.branchId) || {}).name || '', branchCode: (branchById(s, a.branchId) || {}).code || '' })) };
    });

    def('audit.verify', { roles: ['SUPER_ADMIN'] }, async (ctx) => {
      let prev = 'GENESIS';
      const s = ctx.state;
      for (let i = 0; i < s.audit.length; i++) {
        const a = s.audit[i];
        const copy = Object.assign({}, a);
        delete copy.hash;
        const h = await RW.sha256Hex(prev + RW.canonical(copy));
        if (a.prevHash !== prev || a.hash !== h) return { ok: false, count: s.audit.length, brokenAt: a.seq };
        prev = a.hash;
      }
      return { ok: true, count: s.audit.length, brokenAt: null };
    });

    /* ========================================================== notifications */
    function visibleNotif(u, n) {
      if (n.targetUserId) return n.targetUserId === u.id;
      if (!n.forAdmins || n.actorId === u.id) return false;
      if (u.role === 'SUPER_ADMIN' || u.role === 'CEO') return true;
      if (u.role === 'BRANCH_ADMIN') return n.branchId === u.branchId;
      return false;
    }
    def('notifications.list', {}, async (ctx, p) => {
      const s = ctx.state, u = ctx.user;
      const all = s.notifications.filter((n) => visibleNotif(u, n)).reverse();
      const limit = Math.min(parseInt(p && p.limit, 10) || 40, 200);
      const view = (n) => ({ id: n.id, at: n.at, kind: n.kind, title: n.title, body: n.body, voucherId: n.voucherId, important: n.important, read: !!n.readBy[u.id], branchName: (branchById(s, n.branchId) || {}).name || '' });
      return { unread: all.filter((n) => !n.readBy[u.id]).length, total: all.length, rows: all.slice(0, limit).map(view) };
    });
    def('notifications.markRead', { w: true }, async (ctx, p) => {
      const u = ctx.user;
      let changed = 0;
      for (const n of ctx.state.notifications) {
        if (!visibleNotif(u, n) || n.readBy[u.id]) continue;
        if (p.all || (p.ids || []).includes(n.id)) { n.readBy[u.id] = nowIso(); changed++; }
      }
      if (!changed) ctx.dirty = false;
      return { changed };
    });

    /* ============================================================== outstanding */
    function oView(s, o, today) {
      const bal = o.amountPaise - o.settledPaise;
      const open = o.status === 'OPEN' && bal > 0;
      const overdue = open && o.dueDate < today;
      return {
        id: o.id, branchId: o.branchId, branchName: (branchById(s, o.branchId) || {}).name || '', branchCode: (branchById(s, o.branchId) || {}).code || '', partyName: o.partyName, direction: o.direction,
        amountPaise: o.amountPaise, settledPaise: o.settledPaise, balancePaise: bal, dueDate: o.dueDate, reference: o.reference || '', notes: o.notes || '',
        status: o.status, overdue, daysOverdue: overdue ? RW.diffDays(today, o.dueDate) : 0, createdAt: o.createdAt, createdBy: (userById(s, o.createdBy) || {}).fullName || '',
        settlements: o.settlements.map((x) => ({ id: x.id, at: x.at, amountPaise: x.amountPaise, voucherNumber: x.voucherNumber || '', note: x.note || '', by: (userById(s, x.by) || {}).fullName || '' })),
      };
    }
    function oScope(ctx, s) { return s.outstanding.filter((o) => seesAll(ctx.user) || o.branchId === ctx.user.branchId); }

    function outstandingSummary(s, items, today) {
      const open = items.filter((o) => o.status === 'OPEN' && o.amountPaise - o.settledPaise > 0);
      const bal = (o) => o.amountPaise - o.settledPaise;
      const weekEnd = RW.endOfWeek(today), monthEnd = RW.endOfMonth(today);
      const sum = (arr) => arr.reduce((a, o) => a + bal(o), 0);
      const split = (arr) => ({ receivablePaise: sum(arr.filter((o) => o.direction === 'RECEIVABLE')), payablePaise: sum(arr.filter((o) => o.direction === 'PAYABLE')) });
      const card = (arr) => Object.assign({ totalPaise: sum(arr), count: arr.length }, split(arr));
      const group = (keyFn, nameFn) => {
        const m = new Map();
        for (const o of open) { const k = keyFn(o); const r = m.get(k) || { key: k, name: nameFn(o), receivablePaise: 0, payablePaise: 0, count: 0 }; if (o.direction === 'RECEIVABLE') r.receivablePaise += bal(o); else r.payablePaise += bal(o); r.count++; m.set(k, r); }
        return [...m.values()].map((r) => Object.assign(r, { totalPaise: r.receivablePaise + r.payablePaise })).sort((a, b) => b.totalPaise - a.totalPaise);
      };
      const byUser = new Map();
      for (const o of items) {
        const cu = userById(s, o.createdBy);
        for (const st of o.settlements) {
          const u = userById(s, st.by);
          if (!u) continue;
          const r = byUser.get(u.id) || { userId: u.id, name: u.fullName, branchName: (branchById(s, u.branchId) || {}).name || '', collectedPaise: 0, paidPaise: 0, entries: 0 };
          if (o.direction === 'RECEIVABLE') r.collectedPaise += st.amountPaise; else r.paidPaise += st.amountPaise;
          r.entries++; byUser.set(u.id, r);
        }
        void cu;
      }
      return {
        total: card(open),
        overdue: card(open.filter((o) => o.dueDate < today)),
        dueWeek: card(open.filter((o) => o.dueDate >= today && o.dueDate <= weekEnd)),
        dueMonth: card(open.filter((o) => o.dueDate >= today && o.dueDate <= monthEnd)),
        byBranch: group((o) => o.branchId, (o) => { const b = branchById(s, o.branchId); return b ? b.code.charAt(0) + b.code.slice(1).toLowerCase() : ''; }),
        byParty: group((o) => o.partyName.toLowerCase(), (o) => o.partyName),
        byUser: [...byUser.values()].sort((a, b) => b.collectedPaise + b.paidPaise - (a.collectedPaise + a.paidPaise)),
      };
    }
    H.outstandingTotalFor = (s, u) => {
      const items = s.outstanding.filter((o) => seesAll(u) || o.branchId === u.branchId);
      return outstandingSummary(s, items, todayIst()).total.totalPaise;
    };

    def('outstanding.list', { roles: ADMINS }, async (ctx, p) => {
      const s = ctx.state, today = todayIst();
      const f = (p && p.filters) || {};
      const q = String(f.party || f.q || '').toLowerCase();
      const items = oScope(ctx, s).filter((o) => (!f.branchId || o.branchId === f.branchId) && (!f.direction || o.direction === f.direction) && (!f.from || o.dueDate >= f.from) && (!f.to || o.dueDate <= f.to)
        && (!q || (o.partyName + ' ' + (o.reference || '')).toLowerCase().includes(q)));
      const status = f.status || 'OPEN';
      const shown = items.filter((o) => (status === 'ALL' ? true : status === 'OPEN' ? o.status === 'OPEN' : o.status === status));
      shown.sort((a, b) => (a.dueDate < b.dueDate ? -1 : a.dueDate > b.dueDate ? 1 : 0));
      const pageSize = Math.min(Math.max(parseInt(p.pageSize, 10) || 25, 1), 100);
      const pages = Math.max(1, Math.ceil(shown.length / pageSize));
      const page = Math.min(Math.max(parseInt(p.page, 10) || 1, 1), pages);
      return { summary: outstandingSummary(s, items, today), total: shown.length, page, pages, pageSize, rows: shown.slice((page - 1) * pageSize, page * pageSize).map((o) => oView(s, o, today)) };
    });

    def('outstanding.create', { w: true, roles: ['SUPER_ADMIN'] }, async (ctx, p) => {
      const s = ctx.state;
      const branchId = isSuper(ctx.user) ? p.branchId : ctx.user.branchId;
      if (!branchById(s, branchId)) throw new ApiError('VALIDATION', 'Choose a branch');
      if (p.direction !== 'RECEIVABLE' && p.direction !== 'PAYABLE') throw new ApiError('VALIDATION', 'Choose Receivable or Payable');
      if (!RW.isValidDate(p.dueDate)) throw new ApiError('VALIDATION', 'Enter a valid due date');
      const amountPaise = RW.toPaise(p.amount);
      if (amountPaise <= 0) throw new ApiError('VALIDATION', 'Amount must be greater than 0');
      const o = {
        id: RW.uid('os'), branchId, partyName: cleanText(p.partyName, 2, 120, 'Party'), direction: p.direction, amountPaise, settledPaise: 0, dueDate: p.dueDate,
        reference: p.reference ? cleanText(p.reference, 0, 80, 'Reference') : '', notes: p.notes ? cleanMultiline(p.notes, 0, 500, 'Notes') : '', status: 'OPEN',
        createdBy: ctx.user.id, createdAt: nowIso(), settlements: [],
      };
      s.outstanding.push(o);
      await audit(ctx, { entity: 'OUTSTANDING', entityId: o.id, entityLabel: o.partyName + ' ' + RW.fmtINR(amountPaise), action: 'CREATE', branchId, new: { party: o.partyName, direction: o.direction, amount: amountPaise / 100, due: o.dueDate } });
      return { item: oView(s, o, todayIst()) };
    });

    function mustOutstanding(ctx, id) {
      const o = ctx.state.outstanding.find((x) => x.id === id);
      if (!o || !(isSuper(ctx.user) || o.branchId === ctx.user.branchId)) throw new ApiError('NOT_FOUND', 'Outstanding entry not found');
      return o;
    }
    def('outstanding.update', { w: true, roles: ['SUPER_ADMIN'] }, async (ctx, p) => {
      const s = ctx.state;
      const o = mustOutstanding(ctx, p.id);
      if (o.status !== 'OPEN') throw new ApiError('LOCKED', 'This entry is ' + o.status.toLowerCase());
      const old = {}, nw = {};
      if (p.partyName !== undefined) { const v = cleanText(p.partyName, 2, 120, 'Party'); if (v !== o.partyName) { old.party = o.partyName; nw.party = v; o.partyName = v; } }
      if (p.dueDate !== undefined) { if (!RW.isValidDate(p.dueDate)) throw new ApiError('VALIDATION', 'Enter a valid due date'); if (p.dueDate !== o.dueDate) { old.due = o.dueDate; nw.due = p.dueDate; o.dueDate = p.dueDate; } }
      if (p.reference !== undefined) o.reference = cleanText(p.reference, 0, 80, 'Reference');
      if (p.notes !== undefined) o.notes = cleanMultiline(p.notes, 0, 500, 'Notes');
      if (p.amount !== undefined) { const v = RW.toPaise(p.amount); if (v < o.settledPaise || v <= 0) throw new ApiError('VALIDATION', 'Amount cannot be less than what is already settled'); if (v !== o.amountPaise) { old.amount = o.amountPaise / 100; nw.amount = v / 100; o.amountPaise = v; } }
      if (Object.keys(nw).length) await audit(ctx, { entity: 'OUTSTANDING', entityId: o.id, entityLabel: o.partyName, action: 'EDIT', branchId: o.branchId, old, new: nw, reason: p.reason || '' });
      return { item: oView(s, o, todayIst()) };
    });
    def('outstanding.settle', { w: true, roles: ['SUPER_ADMIN'] }, async (ctx, p) => {
      const s = ctx.state;
      const o = mustOutstanding(ctx, p.id);
      if (o.status !== 'OPEN') throw new ApiError('LOCKED', 'This entry is ' + o.status.toLowerCase());
      const amt = RW.toPaise(p.amount);
      const bal = o.amountPaise - o.settledPaise;
      if (amt <= 0) throw new ApiError('VALIDATION', 'Amount must be greater than 0');
      if (amt > bal) throw new ApiError('VALIDATION', 'Amount exceeds the balance of ' + RW.fmtINR(bal));
      let vn = '';
      if (p.voucherNumber) {
        const v = s.vouchers.find((x) => x.number.toLowerCase() === String(p.voucherNumber).trim().toLowerCase());
        if (!v || v.branchId !== o.branchId || v.status !== 'ACTIVE') throw new ApiError('VALIDATION', 'Voucher not found in this branch');
        if ((o.direction === 'RECEIVABLE') !== (v.type === 'RECEIPT')) throw new ApiError('VALIDATION', 'Link a ' + (o.direction === 'RECEIVABLE' ? 'cash receipt' : 'cash payment') + ' voucher to this entry');
        vn = v.number;
      }
      o.settlements.push({ id: RW.uid('sl'), at: nowIso(), amountPaise: amt, voucherNumber: vn, note: p.note ? cleanText(p.note, 0, 200, 'Note') : '', by: ctx.user.id });
      o.settledPaise += amt;
      if (o.settledPaise >= o.amountPaise) o.status = 'SETTLED';
      await audit(ctx, { entity: 'OUTSTANDING', entityId: o.id, entityLabel: o.partyName, action: 'SETTLE', branchId: o.branchId, new: { amount: amt / 100, voucher: vn, balance: (o.amountPaise - o.settledPaise) / 100 } });
      return { item: oView(s, o, todayIst()) };
    });
    def('outstanding.cancel', { w: true, roles: ['SUPER_ADMIN'] }, async (ctx, p) => {
      const o = mustOutstanding(ctx, p.id);
      if (o.status !== 'OPEN') throw new ApiError('LOCKED', 'This entry is ' + o.status.toLowerCase());
      const reason = cleanText(p.reason, 5, 500, 'Reason');
      o.status = 'CANCELLED';
      await audit(ctx, { entity: 'OUTSTANDING', entityId: o.id, entityLabel: o.partyName, action: 'CANCEL', branchId: o.branchId, reason });
      return { item: oView(ctx.state, o, todayIst()) };
    });

    /* ======================================================= series / reports */
    function dayMap(list) {
      const m = new Map();
      for (const v of list) {
        if (!H.counted(v)) continue;
        const r = m.get(v.date) || { inPaise: 0, outPaise: 0, count: 0 };
        if (v.type === 'RECEIPT') r.inPaise += v.amountPaise; else r.outPaise += v.amountPaise;
        r.count++; m.set(v.date, r);
      }
      return m;
    }
    function sumDays(m, from, to) {
      let i = 0, o = 0, c = 0;
      for (let d = from; d <= to; d = RW.addDays(d, 1)) { const r = m.get(d); if (r) { i += r.inPaise; o += r.outPaise; c += r.count; } }
      return { inPaise: i, outPaise: o, netPaise: i - o, count: c };
    }
    function rangeParams(s, p) {
      const today = todayIst();
      if (p.preset && p.preset !== 'custom') return RW.rangeFor(p.preset, today, s.settings.fiscalYearStartMonth);
      if (!RW.isValidDate(p.from) || !RW.isValidDate(p.to) || p.from > p.to) throw new ApiError('VALIDATION', 'Choose a valid date range');
      return { from: p.from, to: p.to, label: RW.fmtDate(p.from) + ' – ' + RW.fmtDate(p.to) };
    }
    function seriesDaily(m, to, n) {
      const out = [];
      for (let i = n - 1; i >= 0; i--) { const d = RW.addDays(to, -i); const r = m.get(d) || { inPaise: 0, outPaise: 0, count: 0 }; out.push({ date: d, label: RW.fmtDateShort(d), inPaise: r.inPaise, outPaise: r.outPaise, count: r.count }); }
      return out;
    }
    function seriesWeekly(m, today, n) {
      const out = [];
      const start = RW.startOfWeek(today);
      for (let i = n - 1; i >= 0; i--) { const f = RW.addDays(start, -7 * i); const t = RW.addDays(f, 6); const r = sumDays(m, f, t > today ? today : t); out.push({ date: f, label: RW.fmtDateShort(f), inPaise: r.inPaise, outPaise: r.outPaise, count: r.count }); }
      return out;
    }
    function seriesMonthly(m, today, n) {
      const out = [];
      const start = RW.startOfMonth(today);
      for (let i = n - 1; i >= 0; i--) { const f = RW.addMonths(start, -i); const t = RW.endOfMonth(f); const r = sumDays(m, f, t > today ? today : t); out.push({ date: f, label: RW.MONTHS[+f.slice(5, 7) - 1] + " '" + f.slice(2, 4), inPaise: r.inPaise, outPaise: r.outPaise, count: r.count }); }
      return out;
    }
    function balanceTrend(s, u, list, today, n) {
      let base = 0;
      for (const r of s.registers) {
        const ru = userById(s, r.userId);
        if (!ru) continue;
        if (level(u) === 'ALL' || (level(u) === 'BRANCH' && ru.branchId === u.branchId) || (level(u) === 'SELF' && ru.id === u.id)) base += r.openingPaise;
      }
      const m = dayMap(list);
      const first = RW.addDays(today, -(n - 1));
      let run = base;
      const before = [...m.entries()].filter(([d]) => d < first);
      for (const [, r] of before) run += r.inPaise - r.outPaise;
      const out = [];
      for (let i = 0; i < n; i++) { const d = RW.addDays(first, i); const r = m.get(d); if (r) run += r.inPaise - r.outPaise; out.push({ date: d, label: RW.fmtDateShort(d), balancePaise: run }); }
      return out;
    }
    function scopeOpening(s, u, branchId) {
      let a = 0;
      for (const r of s.registers) {
        const ru = userById(s, r.userId);
        if (!ru) continue;
        if (branchId && ru.branchId !== branchId) continue;
        if (level(u) === 'ALL' || (level(u) === 'BRANCH' && ru.branchId === u.branchId) || (level(u) === 'SELF' && ru.id === u.id)) a += r.openingPaise;
      }
      return a;
    }

    def('dashboard.get', {}, async (ctx, p) => {
      const s = ctx.state, u = ctx.user;
      const today = todayIst(), fy = s.settings.fiscalYearStartMonth;
      const list = filterVouchers(s, u, {});
      const m = dayMap(list);
      const R = (k) => RW.rangeFor(k, today, fy);
      const per = (k) => { const r = R(k); const t = sumDays(m, r.from, r.to); return Object.assign({ label: r.label, from: r.from, to: r.to }, t); };
      const charts = {
        daily14: seriesDaily(m, today, 14), weekly8: seriesWeekly(m, today, 8), monthly12: seriesMonthly(m, today, 12),
        voucherCount14: seriesDaily(m, today, 14).map((d) => ({ date: d.date, label: d.label, count: d.count })), balanceTrend30: balanceTrend(s, u, list, today, 30),
      };
      const recent = list.filter((v) => v.status !== 'DELETED').slice(0, level(u) === 'SELF' ? 8 : 10).map((v) => vView(s, v));
      const out = { role: u.role, level: level(u), today, periods: { today: per('today'), week: per('week'), month: per('month'), year: per('year') }, charts, recent };
      if (level(u) === 'SELF') {
        const reg = H.registerOf(s, u.id);
        const bal = H.currentBalance(s, u.id);
        out.self = { registerId: reg ? reg.id : null, openingPaise: reg ? reg.openingPaise : 0, balancePaise: bal };
        return out;
      }
      const kr = (p && p.range) || 'month';
      const range = R(kr === 'all' ? 'all' : ['today', 'week', 'month', 'year'].includes(kr) ? kr : 'month');
      const k = sumDays(m, range.from, range.to);
      const brs = H.scopeBranches(s, u);
      const activeUsers = s.users.filter((x) => !x.deleted && x.status === 'ACTIVE' && canSeeUser(u, x)).length;
      out.kpiRange = { key: kr, label: range.label, from: range.from, to: range.to };
      out.kpis = Object.assign({}, k, {
        balancePaise: scopeOpening(s, u) + sumDays(m, '2000-01-01', today).netPaise,
        outstandingPaise: isAdmin(u) ? H.outstandingTotalFor(s, u) : null,
        activeUsers, activeBranches: brs.filter((b) => b.status === 'ACTIVE').length,
      });
      out.branches = brs.map((b) => branchStats(s, b, range.from, range.to));
      return out;
    });

    /* ================================================================ CEO dashboard
     * One call that answers "is everything fine, everywhere?" for the CEO (and the main admin): company-wide cash, every branch side by side,
     * and a short list of things that need a look (review queue, overdue money, big payments, negative cash, silent branches, risky logins).
     * Read-only; works on the whole company. */
    def('ceo.dashboard', { roles: ['SUPER_ADMIN', 'CEO'] }, async (ctx, p) => {
      const s = ctx.state, u = ctx.user, today = todayIst(), fy = s.settings.fiscalYearStartMonth, nowMs = Date.now();
      const key = ['today', 'week', 'month', 'year', 'all'].includes(p && p.range) ? p.range : 'month';
      const rg = RW.rangeFor(key, today, fy);
      const from = rg.from, to = rg.to > today ? today : rg.to;
      const days = key === 'all' ? null : RW.diffDays(to, from) + 1;
      const prevTo = days ? RW.addDays(from, -1) : null, prevFrom = days ? RW.addDays(prevTo, -(days - 1)) : null;
      const money = (x) => RW.fmtINR2(x);

      // one pass over every voucher: period totals, previous period, per-branch, per-user, per-party
      const blank = () => ({ inPaise: 0, outPaise: 0, givenPaise: 0, count: 0, notValidPaise: 0, notValidCount: 0 });
      const cur = blank(), prev = blank();
      const perBranch = new Map(), perUser = new Map(), parties = new Map();
      const bOf = (id) => { let r = perBranch.get(id); if (!r) perBranch.set(id, r = Object.assign(blank(), { allNetPaise: 0, pendingCount: 0, pendingPaise: 0, oldestPendingDate: null, lastEntryAt: '', todayCount: 0 })); return r; };
      const uOf = (id) => { let r = perUser.get(id); if (!r) perUser.set(id, r = { netPaise: 0, outPaise: 0, count: 0, lastAt: '' }); return r; };
      const large = [], pendingList = [];
      const bigAt = s.settings.largePaymentAlertPaise || 0;
      for (const v of s.vouchers) {
        if (v.status === 'DELETED') continue;
        const b = bOf(v.branchId), us = uOf(v.userId);
        if ((v.createdAt || '') > b.lastEntryAt) b.lastEntryAt = v.createdAt || '';
        if ((v.createdAt || '') > us.lastAt) us.lastAt = v.createdAt || '';
        if (v.date === today && v.status === 'ACTIVE') b.todayCount++;
        const live = counted(v);
        if (live) { const n = v.type === 'RECEIPT' ? v.amountPaise : -v.amountPaise; b.allNetPaise += n; us.netPaise += n; }
        if (v.type === 'PAYMENT' && v.status === 'ACTIVE' && !v.review) {
          b.pendingCount++; b.pendingPaise += v.amountPaise; if (!b.oldestPendingDate || v.date < b.oldestPendingDate) b.oldestPendingDate = v.date;
          pendingList.push(v);
        }
        const inCur = v.date >= from && v.date <= to, inPrev = days && v.date >= prevFrom && v.date <= prevTo;
        for (const [on, tot, brk] of [[inCur, cur, b], [inPrev, prev, null]]) {
          if (!on) continue;
          if (v.status === 'ACTIVE' && v.review === 'INVALID') { tot.notValidPaise += v.amountPaise; tot.notValidCount++; if (brk) { brk.notValidPaise += v.amountPaise; brk.notValidCount++; } }
          if (!live) continue;
          const tt = [tot].concat(brk ? [brk] : []);
          for (const t of tt) { t.count++; if (v.type === 'RECEIPT') { t.inPaise += v.amountPaise; if (v.kind === 'RECEIVED') t.givenPaise += v.amountPaise; } else t.outPaise += v.amountPaise; }
          if (tot === cur && v.type === 'PAYMENT') {
            us.outPaise += v.amountPaise; us.count++;
            const pk = (v.partyName || '').trim().toLowerCase();
            const pr = parties.get(pk) || { name: v.partyName, outPaise: 0, count: 0 }; pr.outPaise += v.amountPaise; pr.count++; parties.set(pk, pr);
            if (bigAt > 0 && v.amountPaise >= bigAt) large.push(v);
          }
        }
      }
      const view = (v) => { const x = vView(s, v); return { id: x.id, number: x.number, date: x.date, partyName: x.partyName, amountPaise: x.amountPaise, branchName: x.branchName, branchCode: x.branchCode, userName: x.userName, review: x.review, status: x.status }; };

      // registers: who holds how much cash
      const regs = [];
      let cashInHand = 0;
      for (const r of s.registers) {
        const w = userById(s, r.userId);
        if (!w || w.deleted) continue;
        const bal = r.openingPaise + (perUser.get(w.id) ? perUser.get(w.id).netPaise : 0);
        cashInHand += bal;
        regs.push({ userId: w.id, name: w.fullName, role: w.role, status: w.status, branchId: w.branchId, branchName: (branchById(s, w.branchId) || {}).name || '', registerId: r.id, balancePaise: bal, lastAt: (perUser.get(w.id) || {}).lastAt || '' });
      }
      const negative = regs.filter((r) => r.balancePaise < 0).sort((a, b) => a.balancePaise - b.balancePaise);
      const topHolders = regs.slice().sort((a, b) => b.balancePaise - a.balancePaise).slice(0, 5);
      const staleCut = nowMs - 7 * 86400000;
      const inactive = regs.filter((r) => r.role === 'USER' && r.status === 'ACTIVE' && (!r.lastAt || Date.parse(r.lastAt) < staleCut))
        .map((r) => Object.assign({ days: r.lastAt ? Math.floor((nowMs - Date.parse(r.lastAt)) / 86400000) : null }, r)).sort((a, b) => (b.days === null ? 1e9 : b.days) - (a.days === null ? 1e9 : a.days));

      // outstanding money
      const os = outstandingSummary(s, s.outstanding, today);
      const overdueItems = s.outstanding.filter((o) => o.status === 'OPEN' && o.amountPaise - o.settledPaise > 0 && o.dueDate < today)
        .sort((a, b) => (b.amountPaise - b.settledPaise) - (a.amountPaise - a.settledPaise)).slice(0, 5)
        .map((o) => ({ id: o.id, party: o.partyName, direction: o.direction, balancePaise: o.amountPaise - o.settledPaise, dueDate: o.dueDate, days: RW.diffDays(today, o.dueDate), branchName: (branchById(s, o.branchId) || {}).name || '' }));
      const overdueBy = new Map();
      for (const o of s.outstanding) if (o.status === 'OPEN' && o.amountPaise - o.settledPaise > 0 && o.dueDate < today) overdueBy.set(o.branchId, (overdueBy.get(o.branchId) || 0) + o.amountPaise - o.settledPaise);

      // branches side by side
      const branches = s.branches.map((b) => {
        const t = bOf(b.id), activeStaff = s.users.filter((x) => x.branchId === b.id && !x.deleted && x.status === 'ACTIVE' && x.role === 'USER').length;
        const bst = branchStats(s, b, from, to);
        return {
          id: b.id, code: b.code, name: b.name, status: b.status, activeUsers: bst.userCount, staff: activeStaff,
          balancePaise: bst.balancePaise, inPaise: t.inPaise, outPaise: t.outPaise, netPaise: t.inPaise - t.outPaise, givenPaise: t.givenPaise, count: t.count,
          pendingCount: t.pendingCount, pendingPaise: t.pendingPaise, notValidCount: t.notValidCount, notValidPaise: t.notValidPaise,
          overduePaise: overdueBy.get(b.id) || 0, lastEntryAt: t.lastEntryAt || null, todayCount: t.todayCount,
        };
      }).sort((a, b) => b.outPaise - a.outPaise);

      // interventions & security (from the permanent audit log)
      const winFrom = from, winTo = to;
      const iv = { edit: 0, void: 0, delete: 0, renumber: 0, notValid: 0 }, ivList = [];
      const dayAgo = nowMs - 86400000;
      let failedLogins = 0;
      for (const a of s.audit) {
        if (a.action === 'LOGIN_FAILED' && Date.parse(a.at) >= dayAgo) failedLogins++;
        if (a.entity !== 'VOUCHER') continue;
        const d = RW.istDate(a.at);
        if (d < winFrom || d > winTo) continue;
        if (a.action === 'EDIT') { iv.edit++; if (a.new && a.new.number !== undefined) iv.renumber++; }
        else if (a.action === 'VOID') iv.void++;
        else if (a.action === 'DELETE' || a.action === 'PURGE') iv.delete++;
        else if (a.action === 'REVIEW' && a.new && a.new.review === 'Not valid') iv.notValid++;
        else continue;
        ivList.push(a);
      }
      const lockedNow = Object.values(s.loginFails || {}).filter((f) => f && f.lockedUntil && f.lockedUntil > nowMs).length;

      // things that need a look, most serious first
      const alerts = [];
      const oldestPending = pendingList.reduce((m, v) => (!m || v.date < m ? v.date : m), null);
      const pendingPaise = pendingList.reduce((a, v) => a + v.amountPaise, 0);
      if (negative.length) alerts.push({ level: 'bad', icon: 'wallet', title: negative.length + ' cash register' + (negative.length > 1 ? 's' : '') + ' below zero', detail: negative.slice(0, 3).map((r) => r.name + ' ' + money(r.balancePaise)).join(' · '), href: '#/register' });
      if (os.overdue.count) alerts.push({ level: 'bad', icon: 'scale', title: os.overdue.count + ' overdue outstanding entr' + (os.overdue.count > 1 ? 'ies' : 'y') + ' · ' + money(os.overdue.totalPaise), detail: 'To receive ' + money(os.overdue.receivablePaise) + ' · to pay ' + money(os.overdue.payablePaise), href: '#/outstanding' });
      if (pendingList.length) {
        const age = RW.diffDays(today, oldestPending);
        alerts.push({ level: age > 7 ? 'bad' : 'warn', icon: 'shield', title: pendingList.length + ' payment' + (pendingList.length > 1 ? 's' : '') + ' waiting for the main admin\'s review · ' + money(pendingPaise), detail: 'Oldest is from ' + RW.fmtDate(oldestPending) + (age > 0 ? ' (' + age + ' day' + (age > 1 ? 's' : '') + ' ago)' : ' (today)'), href: '#/audit' });
      }
      if (large.length) alerts.push({ level: 'warn', icon: 'outflow', title: large.length + ' large payment' + (large.length > 1 ? 's' : '') + ' in this period', detail: 'Each ' + money(bigAt) + ' or more · biggest ' + money(Math.max.apply(null, large.map((v) => v.amountPaise))), href: '#/all-vouchers' });
      if (cur.notValidCount) alerts.push({ level: 'warn', icon: 'ban', title: cur.notValidCount + ' payment' + (cur.notValidCount > 1 ? 's' : '') + ' marked Not valid · ' + money(cur.notValidPaise), detail: 'Not counted as expense; the money is back in the users\' cash', href: '#/audit' });
      const silent = branches.filter((b) => b.status === 'ACTIVE' && b.staff > 0 && !b.todayCount && RW.dow(today) !== 0);
      if (silent.length) alerts.push({ level: 'info', icon: 'building', title: silent.length + ' branch' + (silent.length > 1 ? 'es have' : ' has') + ' no entry today', detail: silent.map((b) => b.name.split(/\s[-–—]\s/).pop()).join(' · '), href: '#/branches' });
      if (inactive.length) alerts.push({ level: 'info', icon: 'users', title: inactive.length + ' staff with no entry for 7+ days', detail: inactive.slice(0, 3).map((r) => r.name).join(' · '), href: '#/users' });
      if (failedLogins || lockedNow) alerts.push({ level: failedLogins >= 10 || lockedNow ? 'bad' : 'warn', icon: 'lock', title: failedLogins + ' failed sign-in' + (failedLogins === 1 ? '' : 's') + ' in the last 24 hours' + (lockedNow ? ' · ' + lockedNow + ' locked' : ''), detail: 'Someone may be guessing a password', href: '#/audit' });
      const ivTotal = iv.edit + iv.void + iv.delete;
      if (ivTotal) alerts.push({ level: 'info', icon: 'history', title: ivTotal + ' correction' + (ivTotal > 1 ? 's' : '') + ' by the main admin in this period', detail: [iv.edit && iv.edit + ' edited', iv.renumber && iv.renumber + ' renumbered', iv.void && iv.void + ' voided', iv.delete && iv.delete + ' deleted'].filter(Boolean).join(' · '), href: '#/audit' });
      const tourSum = H.tourSummary(s, u, from, to);
      if (tourSum.pendingApproval) alerts.push({ level: 'warn', icon: 'map', title: tourSum.pendingApproval + ' tour plan' + (tourSum.pendingApproval > 1 ? 's' : '') + ' waiting for the main admin\'s approval', detail: tourSum.pending.slice(0, 3).map((x) => x.userName + ' · ' + x.title).join(' · '), href: '#/tours?approval=1' });
      const order = { bad: 0, warn: 1, info: 2 };
      alerts.sort((a, b) => order[a.level] - order[b.level]);

      // trends over the whole company
      const dm = dayMap(s.vouchers.filter((v) => v.status !== 'DELETED'));
      const feedSkip = ['LOGIN', 'LOGOUT', 'PDF', 'GENERATE', 'LOGIN_FAILED'];
      const feed = [];
      for (let i = s.audit.length - 1; i >= 0 && feed.length < 14; i--) {
        const a = s.audit[i];
        if (feedSkip.includes(a.action)) continue;
        feed.push({ at: a.at, actorName: a.actorName, actorRole: a.actorRole, action: a.action, entity: a.entity, entityId: a.entityId, label: a.entityLabel, reason: a.reason || '', branchName: (branchById(s, a.branchId) || {}).name || '' });
      }
      const pct = (a, b) => (b > 0 ? Math.round(((a - b) / b) * 1000) / 10 : null);
      return {
        generatedAt: nowIso(), today, range: { key, label: rg.label, from, to, days }, prevRange: days ? { from: prevFrom, to: prevTo } : null,
        kpis: {
          cashInHandPaise: cashInHand, inPaise: cur.inPaise, outPaise: cur.outPaise, netPaise: cur.inPaise - cur.outPaise, givenPaise: cur.givenPaise, count: cur.count,
          notValidPaise: cur.notValidPaise, notValidCount: cur.notValidCount, outstanding: os.total, overdue: os.overdue,
          activeBranches: s.branches.filter((b) => b.status === 'ACTIVE').length, activeUsers: s.users.filter((x) => !x.deleted && x.status === 'ACTIVE').length,
          prev: days ? { inPaise: prev.inPaise, outPaise: prev.outPaise, count: prev.count, inPct: pct(cur.inPaise, prev.inPaise), outPct: pct(cur.outPaise, prev.outPaise), countPct: pct(cur.count, prev.count) } : null,
        },
        review: { pendingCount: pendingList.length, pendingPaise, oldestDate: oldestPending, oldestDays: oldestPending ? RW.diffDays(today, oldestPending) : 0 },
        branches, alerts,
        topParties: [...parties.values()].sort((a, b) => b.outPaise - a.outPaise).slice(0, 5),
        topSpenders: regs.map((r) => ({ name: r.name, branchName: r.branchName, outPaise: (perUser.get(r.userId) || {}).outPaise || 0, count: (perUser.get(r.userId) || {}).count || 0 })).filter((x) => x.outPaise > 0).sort((a, b) => b.outPaise - a.outPaise).slice(0, 5),
        topHolders, negativeRegisters: negative.slice(0, 5), inactiveStaff: inactive.slice(0, 5).map((r) => ({ name: r.name, branchName: r.branchName, days: r.days })),
        largePayments: large.sort((a, b) => b.amountPaise - a.amountPaise).slice(0, 5).map(view), pending: pendingList.sort((a, b) => b.amountPaise - a.amountPaise).slice(0, 5).map(view),
        overdueItems, interventions: iv, interventionList: ivList.slice(-6).reverse().map((a) => ({ at: a.at, action: a.action, label: a.entityLabel, entityId: a.entityId, reason: a.reason || '', actorName: a.actorName })),
        security: { failedLogins24h: failedLogins, lockedAccounts: lockedNow },
        tours: tourSum,
        charts: { daily14: seriesDaily(dm, today, 14), monthly12: seriesMonthly(dm, today, 12), balanceTrend30: balanceTrend(s, u, s.vouchers.filter((v) => v.status !== 'DELETED'), today, 30) },
        feed,
      };
    });

    def('reports.cash', {}, async (ctx, p) => {
      const s = ctx.state;
      const r = rangeParams(s, p || {});
      const list = filterVouchers(s, ctx.user, { from: r.from, to: r.to, branchId: p.branchId, userId: p.userId, type: p.type });
      const t = totalsOf(list);
      const m = dayMap(list);
      const span = RW.diffDays(r.to, r.from) + 1;
      let series = [];
      if (span <= 62) {
        for (let d = r.from; d <= r.to; d = RW.addDays(d, 1)) { const x = m.get(d) || { inPaise: 0, outPaise: 0, count: 0 }; series.push({ date: d, label: RW.fmtDateShort(d), inPaise: x.inPaise, outPaise: x.outPaise, count: x.count }); }
      } else {
        for (let f = RW.startOfMonth(r.from); f <= r.to; f = RW.addMonths(f, 1)) {
          const x = sumDays(m, f < r.from ? r.from : f, RW.endOfMonth(f) > r.to ? r.to : RW.endOfMonth(f));
          series.push({ date: f, label: RW.MONTHS[+f.slice(5, 7) - 1] + " '" + f.slice(2, 4), inPaise: x.inPaise, outPaise: x.outPaise, count: x.count });
        }
      }
      return { range: r, inPaise: t.inPaise, outPaise: t.outPaise, netPaise: t.netPaise, count: t.count, series };
    });

    def('reports.branches', { roles: ['SUPER_ADMIN', 'BRANCH_ADMIN', 'CEO', 'VIEWER'] }, async (ctx, p) => {
      const s = ctx.state, u = ctx.user, today = todayIst();
      const r = rangeParams(s, p || {});
      const brs = H.scopeBranches(s, u);
      const rows = brs.map((b) => branchStats(s, b, r.from, r.to));
      const months = [];
      const start = RW.startOfMonth(today);
      for (let i = 11; i >= 0; i--) months.push(RW.addMonths(start, -i));
      const series = brs.map((b) => {
        const m = dayMap(s.vouchers.filter((v) => v.branchId === b.id));
        const mm = months.map((f) => sumDays(m, f, RW.endOfMonth(f) > today ? today : RW.endOfMonth(f)));
        return { branchId: b.id, name: b.name, code: b.code, inPaise: mm.map((x) => x.inPaise), outPaise: mm.map((x) => x.outPaise), netPaise: mm.map((x) => x.netPaise) };
      });
      return { range: r, rows, months: months.map((f) => RW.MONTHS[+f.slice(5, 7) - 1] + " '" + f.slice(2, 4)), series };
    });

    def('reports.user', { roles: ['SUPER_ADMIN', 'BRANCH_ADMIN', 'CEO', 'VIEWER'] }, async (ctx, p) => {
      const s = ctx.state;
      const t = userById(s, p.userId);
      if (!t || !canSeeUser(ctx.user, t)) throw new ApiError('NOT_FOUND', 'User not found');
      const r = rangeParams(s, p || {});
      const list = filterVouchers(s, ctx.user, { userId: t.id, from: r.from, to: r.to, sort: 'date_desc' });
      const tt = totalsOf(list);
      const reg = H.registerOf(s, t.id);
      return {
        range: r, user: pubUser(s, t), registerId: reg ? reg.id : null, count: tt.count, inPaise: tt.inPaise, outPaise: tt.outPaise, netPaise: tt.netPaise,
        currentBalancePaise: reg ? H.currentBalance(s, t.id) : null, lastActivityAt: t.lastActivityAt || null,
        totalVouchersAll: s.vouchers.filter((v) => v.userId === t.id && H.counted(v)).length,
        rows: list.slice(0, 200).map((v) => vView(s, v)), truncated: list.length > 200,
      };
    });

    /* ================================================================ search */
    def('search.global', {}, async (ctx, p) => {
      const s = ctx.state, u = ctx.user;
      const q = String((p && p.q) || '').trim();
      if (q.length < 2) return { exact: null, vouchers: [], users: [], branches: [] };
      let exact = null;
      const m = q.match(/^([A-Za-z]{2,5})-?(\d{1,9})$/);
      if (m) {
        const pre = m[1].toUpperCase(), n = Number(m[2]);
        const v = s.vouchers.find((x) => x.number.startsWith(pre + '-') && Number(x.number.split('-')[1]) === n && canSeeVoucher(u, x) && (x.status !== 'DELETED' || isAdmin(u)));
        if (v) exact = vView(s, v);
      }
      const vs = filterVouchers(s, u, { q, sort: 'date_desc' }).slice(0, 12).map((v) => vView(s, v));
      const ql = q.toLowerCase();
      const users = level(u) === 'SELF' ? [] : s.users.filter((x) => !x.deleted && canSeeUser(u, x) && (x.fullName + ' ' + x.username + ' ' + x.email).toLowerCase().includes(ql)).slice(0, 5).map((x) => pubUser(s, x));
      const brs = seesAll(u) ? s.branches.filter((b) => (b.name + ' ' + b.code).toLowerCase().includes(ql)).slice(0, 3).map((b) => ({ id: b.id, code: b.code, name: b.name })) : [];
      return { exact, vouchers: vs, users, branches: brs };
    });

    /* ================================================================ export */
    def('export.vouchers', { w: true, roles: ADMINS }, async (ctx, p) => {
      const s = ctx.state;
      const f = Object.assign({}, (p && p.filters) || {});
      const list = filterVouchers(s, ctx.user, f);
      if (list.length > 50000) throw new ApiError('VALIDATION', 'Too many rows to export. Narrow the filters.');
      const rows = list.map((v) => {
        const x = vView(s, v);
        return {
          number: x.number || '—', type: x.kind === 'RECEIVED' ? 'Cash Received' : x.type === 'PAYMENT' ? 'Cash Payment' : 'Cash Receipt', date: x.date, branch: x.branchName, user: x.userName, party: x.partyName,
          particulars: x.particulars, branchCode: x.branchCode, amount: x.amount, cashIn: x.counted && x.type === 'RECEIPT' ? x.amount : null, cashOut: x.counted && x.type === 'PAYMENT' ? x.amount : null, amountInWords: x.amountInWords,
          status: x.status, review: { VALID: 'Valid', INVALID: 'Not valid', PENDING: 'Not reviewed', NA: '' }[x.review] || '', reviewReason: x.reviewReason, createdAt: x.createdAt, createdBy: x.createdBy, attachments: x.attachmentCount,
        };
      });
      const t = totalsOf(list);
      await audit(ctx, { entity: 'EXPORT', entityId: 'vouchers', entityLabel: 'Voucher export (' + rows.length + ' rows)', action: 'EXPORT', new: { filters: f, rows: rows.length } });
      return { rows, totals: t, generatedAt: nowIso(), generatedBy: ctx.user.fullName, filters: f };
    });
  });
})(typeof window !== 'undefined' ? window : globalThis);
