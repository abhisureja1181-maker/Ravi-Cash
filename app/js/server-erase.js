/* Ravi Cash — permanent deletion and "clear all data".
 *
 * Everywhere else in the system records are kept forever (void / soft-delete). This module is the one place where
 * data really disappears, so every method here is:
 *   - Super Admin only (except deleting an outstanding entry, which a branch admin may do for their own branch),
 *   - asks for a reason, and
 *   - leaves an audit entry that says WHAT was erased (a snapshot of the old values), by whom and why.
 * The audit trail itself is never touched, except by an explicit "also erase the audit history" choice or a full reset
 * — and even then the first entry of the new history records the clearing.
 *
 * Voucher numbers are not reused after a single erase (the counters keep going); they only restart when the
 * Super Admin explicitly clears all data and chooses to restart numbering.
 */
(function (g) {
  'use strict';
  const RW = (g.RW = g.RW || {});
  RW.serverModules = RW.serverModules || [];

  RW.serverModules.push(function (H) {
    const { ApiError, def, userById, branchById, isSuper, audit, notify, nowIso, cleanText } = H;
    const ADMINS = ['SUPER_ADMIN', 'BRANCH_ADMIN'];
    const MAX_BATCH = 500;          // vouchers erased by ticking them: each one gets its own audit entry
    const MAX_ALL = 50000;          // "all vouchers matching the filters": one summary audit entry
    const MAX_USERS = 200;
    const CONFIRM_PHRASE = 'DELETE ALL';

    const snap = (s, v) => ({ number: v.number || 'Cash Received', review: v.review || '', type: v.type, date: v.date, party: v.partyName, particulars: v.particulars, amount: v.amountPaise / 100, status: v.status, user: (userById(s, v.userId) || {}).fullName || '' });

    /* Take vouchers out of the state together with everything that hangs off them. Returns the receipt-file ids that
     * must be deleted from storage once the new state has been saved. */
    function dropVouchers(s, pred) {
      const gone = s.vouchers.filter(pred);
      if (!gone.length) return { vouchers: [], blobs: [] };
      const ids = new Set(gone.map((v) => v.id));
      const blobs = s.attachments.filter((a) => ids.has(a.voucherId)).map((a) => a.id);
      s.vouchers = s.vouchers.filter((v) => !ids.has(v.id));
      s.attachments = s.attachments.filter((a) => !ids.has(a.voucherId));
      s.notifications = s.notifications.filter((n) => !n.voucherId || !ids.has(n.voucherId));
      return { vouchers: gone, blobs };
    }

    /* Take tour plans and tour meetings out of the state, with the photos taken at the meetings. */
    function dropTours(s, pred) {
      const tours = s.tours.filter(pred);
      const tid = new Set(tours.map((t) => t.id));
      const visits = s.visits.filter((v) => tid.has(v.tourId) || pred(v));
      const vid = new Set(visits.map((v) => v.id));
      const blobs = s.attachments.filter((a) => vid.has(a.visitId)).map((a) => a.id);
      s.tours = s.tours.filter((t) => !tid.has(t.id));
      s.visits = s.visits.filter((v) => !vid.has(v.id));
      s.attachments = s.attachments.filter((a) => !vid.has(a.visitId));
      return { tours, visits, blobs };
    }

    /* Remove users with their cash registers, vouchers, statements, notifications and sign-ins. */
    function dropUsers(s, ids) {
      const dt = dropTours(s, (x) => ids.has(x.userId));
      const dv = dropVouchers(s, (v) => ids.has(v.userId));
      const stBefore = s.statements.length;
      s.statements = s.statements.filter((x) => !ids.has(x.userId));
      s.notifications = s.notifications.filter((n) => !ids.has(n.targetUserId));
      s.registers = s.registers.filter((r) => !ids.has(r.userId));
      s.users = s.users.filter((u) => !ids.has(u.id));
      for (const k of Object.keys(s.sessions)) if (ids.has(s.sessions[k].userId)) delete s.sessions[k];
      return { vouchers: dv.vouchers, blobs: dv.blobs.concat(dt.blobs), statements: stBefore - s.statements.length, tours: dt.tours.length, visits: dt.visits.length };
    }

    const dropBlobs = async (ctx, ids) => { for (const id of ids) { try { await ctx.storage.del('att:' + id); } catch (e) { /* an orphan file is harmless */ } } };

    function counts(s) {
      return {
        branches: s.branches.length, users: s.users.filter((u) => !u.deleted).length, vouchers: s.vouchers.length, attachments: s.attachments.filter((a) => !a.visitId).length,
        tours: s.tours.length, visits: s.visits.length, outstanding: s.outstanding.length, statements: s.statements.length, notifications: s.notifications.length, audit: s.audit.length,
      };
    }
    const branchUserIds = (s, b) => new Set(s.users.filter((u) => u.branchId === b.id).map((u) => u.id));
    function branchCounts(s, b) {
      const uids = branchUserIds(s, b);
      const vs = s.vouchers.filter((v) => v.branchId === b.id || uids.has(v.userId));
      const vid = new Set(vs.map((v) => v.id));
      return {
        users: s.users.filter((u) => u.branchId === b.id && !u.deleted).length, vouchers: vs.length, attachments: s.attachments.filter((a) => vid.has(a.voucherId)).length,
        tours: s.tours.filter((t) => t.branchId === b.id || uids.has(t.userId)).length, visits: s.visits.filter((v) => v.branchId === b.id || uids.has(v.userId)).length,
        outstanding: s.outstanding.filter((o) => o.branchId === b.id).length, statements: s.statements.filter((x) => x.branchId === b.id || uids.has(x.userId)).length,
      };
    }
    function userCounts(s, u) {
      const vs = s.vouchers.filter((v) => v.userId === u.id);
      const vid = new Set(vs.map((v) => v.id));
      return { vouchers: vs.length, attachments: s.attachments.filter((a) => vid.has(a.voucherId)).length, statements: s.statements.filter((x) => x.userId === u.id).length,
        tours: s.tours.filter((t) => t.userId === u.id).length, visits: s.visits.filter((v) => v.userId === u.id).length };
    }

    /* What would be erased? (shown in the confirmation dialogs) */
    def('erase.preview', { roles: ['SUPER_ADMIN'] }, async (ctx, p) => {
      const s = ctx.state;
      if (p.branchId) { const b = branchById(s, p.branchId); if (!b) throw new ApiError('NOT_FOUND', 'Branch not found'); return branchCounts(s, b); }
      if (Array.isArray(p.userIds)) {
        const t = { vouchers: 0, attachments: 0, statements: 0, tours: 0, visits: 0 };
        for (const id of p.userIds) { const u = userById(s, id); if (!u) continue; const c = userCounts(s, u); t.vouchers += c.vouchers; t.attachments += c.attachments; t.statements += c.statements; t.tours += c.tours; t.visits += c.visits; }
        return t;
      }
      if (p.userId) { const u = userById(s, p.userId); if (!u) throw new ApiError('NOT_FOUND', 'User not found'); return userCounts(s, u); }
      return counts(s);
    });

    /* ------------------------------------------------------------------ vouchers */
    def('vouchers.purge', { w: true, roles: ['SUPER_ADMIN'] }, async (ctx, p) => {
      const s = ctx.state;
      let ids = Array.isArray(p.ids) ? p.ids : p.id ? [p.id] : [];
      // Bulk mode: "every voucher the list shows for these filters" (across all pages). The caller says how many it saw;
      // if the number differs now, nothing is deleted.
      const byFilter = !ids.length && p.filters && typeof p.filters === 'object';
      let filtersUsed = null;
      if (byFilter) {
        if (String(p.confirm || '').trim() !== CONFIRM_PHRASE) throw new ApiError('VALIDATION', 'Type ' + CONFIRM_PHRASE + ' to confirm');
        filtersUsed = {};
        for (const k of ['q', 'type', 'kind', 'review', 'status', 'branchId', 'userId', 'from', 'to', 'minAmount', 'maxAmount', 'number']) if (p.filters[k] !== undefined && p.filters[k] !== null && p.filters[k] !== '') filtersUsed[k] = String(p.filters[k]).slice(0, 120);
        const list = H.filterVouchers(s, ctx.user, filtersUsed);
        if (!list.length) throw new ApiError('VALIDATION', 'No vouchers match these filters');
        if (list.length > MAX_ALL) throw new ApiError('VALIDATION', 'Too many vouchers (' + list.length + '). Narrow the filters to at most ' + MAX_ALL + '.');
        if (Number(p.expectCount) !== list.length) throw new ApiError('CONFLICT', 'The number of matching vouchers changed (now ' + list.length + '). Refresh the page and try again.');
        ids = list.map((v) => v.id);
      }
      if (!ids.length) throw new ApiError('VALIDATION', 'Choose at least one voucher');
      if (!byFilter && ids.length > MAX_BATCH) throw new ApiError('VALIDATION', 'Choose at most ' + MAX_BATCH + ' vouchers at a time (or use "select all matching")');
      const reason = cleanText(p.reason, 5, 500, 'Reason for deleting');
      const want = new Set(ids.map(String));
      if (s.vouchers.filter((v) => want.has(v.id)).length !== want.size) throw new ApiError('NOT_FOUND', 'Some of these vouchers no longer exist. Refresh the page and try again.');
      const { vouchers, blobs } = dropVouchers(s, (v) => want.has(v.id));
      if (byFilter && vouchers.length > MAX_BATCH) {
        // too many for one audit entry each: keep one entry that says exactly what was erased
        const nums = vouchers.map((v) => v.number).filter(Boolean).sort();
        const dates = vouchers.map((v) => v.date).sort();
        await audit(ctx, { entity: 'VOUCHER', entityId: 'bulk', entityLabel: vouchers.length + ' vouchers (bulk)', action: 'PURGE', branchId: null,
          old: { count: vouchers.length, countedValue: vouchers.reduce((a, v) => a + (H.counted(v) ? (v.type === 'RECEIPT' ? v.amountPaise : -v.amountPaise) : 0), 0) / 100, firstNumber: nums[0] || '', lastNumber: nums[nums.length - 1] || '', fromDate: dates[0], toDate: dates[dates.length - 1], filters: filtersUsed }, new: null, reason });
      } else {
        for (const v of vouchers) await audit(ctx, { entity: 'VOUCHER', entityId: v.id, entityLabel: H.vlabel(v), action: 'PURGE', branchId: v.branchId, old: snap(s, v), new: null, reason });
      }
      const total = vouchers.reduce((a, v) => a + (H.counted(v) ? v.amountPaise : 0), 0);
      notify(ctx, { kind: 'VOUCHER_DELETED', title: vouchers.length === 1 ? 'Voucher permanently deleted' : vouchers.length + ' vouchers permanently deleted',
        body: (vouchers.length === 1 ? H.vlabel(vouchers[0]) : H.vlabel(vouchers[0]) + ' and ' + (vouchers.length - 1) + ' more') + ' erased by ' + ctx.user.fullName + ' — ' + reason + (total ? ' (active value ' + RW.fmtINR(total) + ')' : ''), branchId: vouchers.length === 1 ? vouchers[0].branchId : null, important: true });
      await ctx.save();
      await dropBlobs(ctx, blobs);
      return { removed: vouchers.length };
    });

    /* ------------------------------------------------------------- outstanding */
    def('outstanding.delete', { w: true, roles: ['SUPER_ADMIN'] }, async (ctx, p) => {
      const s = ctx.state;
      const o = s.outstanding.find((x) => x.id === p.id);
      if (!o || !(isSuper(ctx.user) || o.branchId === ctx.user.branchId)) throw new ApiError('NOT_FOUND', 'Outstanding entry not found');
      const reason = cleanText(p.reason, 5, 500, 'Reason for deleting');
      s.outstanding = s.outstanding.filter((x) => x !== o);
      await audit(ctx, { entity: 'OUTSTANDING', entityId: o.id, entityLabel: o.partyName, action: 'DELETE', branchId: o.branchId,
        old: { party: o.partyName, direction: o.direction, amount: o.amountPaise / 100, settled: o.settledPaise / 100, due: o.dueDate, status: o.status, reference: o.reference || '' }, new: null, reason });
      return { ok: true };
    });

    /* -------------------------------------------------------------------- users */
    def('users.erase', { w: true, roles: ['SUPER_ADMIN'] }, async (ctx, p) => {
      const s = ctx.state;
      const t = userById(s, p.id);
      if (!t) throw new ApiError('NOT_FOUND', 'User not found');
      if (t.id === ctx.user.id) throw new ApiError('VALIDATION', 'You cannot erase your own account');
      if (t.role === 'SUPER_ADMIN' && t.status === 'ACTIVE' && !t.deleted && !s.users.some((u) => u.id !== t.id && !u.deleted && u.role === 'SUPER_ADMIN' && u.status === 'ACTIVE')) {
        throw new ApiError('VALIDATION', 'There must always be at least one active Super Admin');
      }
      const reason = cleanText(p.reason, 5, 500, 'Reason for deleting');
      const label = t.fullName + ' (' + t.username + ')', branchId = t.branchId, b = branchById(s, branchId);
      const r = dropUsers(s, new Set([t.id]));
      await audit(ctx, { entity: 'USER', entityId: t.id, entityLabel: label, action: 'PURGE', branchId,
        old: { name: t.fullName, username: t.username, role: t.role, branch: b ? b.name : '', vouchersErased: r.vouchers.length, statementsErased: r.statements }, new: null, reason });
      await ctx.save();
      await dropBlobs(ctx, r.blobs);
      await H.purgeLocations(new Set([t.id]));
      return { ok: true, removed: { vouchers: r.vouchers.length, statements: r.statements } };
    });

    /* Several users at once. All-or-nothing; the same rules as deleting one user (never yourself, never the last
     * active Super Admin). erase=false: they can no longer sign in, their vouchers stay on record.
     * erase=true: the users AND everything they created are erased for good. */
    def('users.deleteMany', { w: true, roles: ['SUPER_ADMIN'] }, async (ctx, p) => {
      const s = ctx.state;
      const ids = Array.from(new Set((Array.isArray(p.ids) ? p.ids : []).map(String)));
      if (!ids.length) throw new ApiError('VALIDATION', 'Choose at least one user');
      if (ids.length > MAX_USERS) throw new ApiError('VALIDATION', 'Choose at most ' + MAX_USERS + ' users at a time');
      const targets = ids.map((id) => userById(s, id));
      if (targets.some((t) => !t || t.deleted)) throw new ApiError('NOT_FOUND', 'Some of these users no longer exist. Refresh the page and try again.');
      if (ids.includes(ctx.user.id)) throw new ApiError('VALIDATION', 'You cannot delete your own account. Untick yourself and try again.');
      const set = new Set(ids);
      if (targets.some((t) => t.role === 'SUPER_ADMIN' && t.status === 'ACTIVE') && !s.users.some((u) => !set.has(u.id) && !u.deleted && u.role === 'SUPER_ADMIN' && u.status === 'ACTIVE')) {
        throw new ApiError('VALIDATION', 'There must always be at least one active Super Admin. Untick one Super Admin and try again.');
      }
      const reason = cleanText(p.reason, 5, 500, 'Reason for deleting');
      if (!p.erase) {
        for (const t of targets) {
          t.deleted = true; t.status = 'INACTIVE'; t.deletedAt = nowIso();
          for (const k of Object.keys(s.sessions)) if (s.sessions[k].userId === t.id) delete s.sessions[k];
          await audit(ctx, { entity: 'USER', entityId: t.id, entityLabel: t.fullName + ' (' + t.username + ')', action: 'DELETE', branchId: t.branchId, reason });
        }
        return { ok: true, removed: { users: targets.length, vouchers: 0, statements: 0 } };
      }
      const info = targets.map((t) => ({ t, label: t.fullName + ' (' + t.username + ')', b: branchById(s, t.branchId), n: s.vouchers.filter((v) => v.userId === t.id).length, st: s.statements.filter((x) => x.userId === t.id).length }));
      const r = dropUsers(s, set);
      for (const i of info) {
        await audit(ctx, { entity: 'USER', entityId: i.t.id, entityLabel: i.label, action: 'PURGE', branchId: i.t.branchId,
          old: { name: i.t.fullName, username: i.t.username, role: i.t.role, branch: i.b ? i.b.name : '', vouchersErased: i.n, statementsErased: i.st }, new: null, reason });
      }
      await ctx.save();
      await dropBlobs(ctx, r.blobs);
      await H.purgeLocations(set);
      return { ok: true, removed: { users: targets.length, vouchers: r.vouchers.length, statements: r.statements } };
    });

    /* ----------------------------------------------------------------- branches */
    def('branches.delete', { w: true, roles: ['SUPER_ADMIN'] }, async (ctx, p) => {
      const s = ctx.state;
      const b = branchById(s, p.id);
      if (!b) throw new ApiError('NOT_FOUND', 'Branch not found');
      if (s.branches.length <= 1) throw new ApiError('VALIDATION', 'The last branch cannot be deleted. Use "Reset entire system" in Settings instead.');
      const sa = s.users.find((u) => u.branchId === b.id && u.role === 'SUPER_ADMIN' && !u.deleted);
      if (sa) throw new ApiError('VALIDATION', 'This branch holds the Super Admin account of ' + sa.fullName + '. Move that account to another branch first (Users → Edit).');
      if (String(p.confirmCode || '').trim().toUpperCase() !== b.code) throw new ApiError('VALIDATION', 'Type the branch code ' + b.code + ' to confirm');
      const reason = cleanText(p.reason, 5, 500, 'Reason for deleting');
      const c = branchCounts(s, b);
      const uids = branchUserIds(s, b);
      const r = dropUsers(s, uids);
      const dv = dropVouchers(s, (v) => v.branchId === b.id);          // vouchers of this branch written by users who since moved away
      const dt = dropTours(s, (x) => x.branchId === b.id);             // tours and meetings of this branch
      s.outstanding = s.outstanding.filter((o) => o.branchId !== b.id);
      s.statements = s.statements.filter((x) => x.branchId !== b.id);
      s.notifications = s.notifications.filter((n) => n.branchId !== b.id);
      s.registers = s.registers.filter((x) => x.branchId !== b.id);
      s.branches = s.branches.filter((x) => x !== b);
      await audit(ctx, { entity: 'BRANCH', entityId: b.id, entityLabel: b.name, action: 'DELETE', branchId: b.id, old: Object.assign({ code: b.code, name: b.name }, c), new: null, reason });
      await ctx.save();
      await dropBlobs(ctx, r.blobs.concat(dv.blobs, dt.blobs));
      await H.purgeLocations(uids);
      return { ok: true, removed: c };
    });

    /* --------------------------------------------------------------- clear all data */
    def('system.clear', { w: true, roles: ['SUPER_ADMIN'] }, async (ctx, p) => {
      const s = ctx.state, u = ctx.user;
      const scope = p.scope === 'EVERYTHING' || p.scope === 'TRANSACTIONS' ? p.scope : null;
      if (!scope) throw new ApiError('VALIDATION', 'Choose what to clear');
      if (String(p.confirm || '').trim() !== CONFIRM_PHRASE) throw new ApiError('VALIDATION', 'Type ' + CONFIRM_PHRASE + ' to confirm');
      const reason = p.reason ? cleanText(p.reason, 0, 500, 'Reason') : '';
      // The password is asked again, and wrong guesses lock this action for a while (a stolen session cannot wipe the books).
      const key = 'clear:' + u.id, now = H.clock();
      const f = s.loginFails[key];
      if (f && f.lockedUntil && f.lockedUntil > now) { ctx.dirty = false; throw new ApiError('RATE_LIMIT', 'Too many wrong passwords. Try again in a few minutes.'); }
      const hash = await RW.hashPassword(String(p.password || ''), u.pwSalt, u.pwIter);
      if (!RW.timingSafeEqualHex(hash, u.pwHash)) {
        const rec = f && f.first > now - 600000 ? f : { count: 0, first: now };
        rec.count++;
        if (rec.count >= 5) { rec.lockedUntil = now + 300000; rec.count = 0; rec.first = now; }
        s.loginFails[key] = rec;
        await audit(ctx, { entity: 'SYSTEM', action: 'CLEAR_FAILED', entityLabel: 'Wrong password while clearing data', branchId: null });
        await ctx.save();
        throw new ApiError('VALIDATION', 'Your password is incorrect');
      }
      delete s.loginFails[key];

      // A server with real storage makes a full backup copy first; if that fails nothing is deleted.
      let backup = null;
      if (H.beforeWipe) {
        try { backup = (await H.beforeWipe()) || null; } catch (e) { throw new ApiError('VALIDATION', 'A safety backup could not be saved, so nothing was deleted (' + (e && e.message ? e.message : e) + ').'); }
      }

      const before = counts(s);
      const blobIds = new Set(s.attachments.map((a) => a.id));
      for (const k of await ctx.storage.keys()) if (String(k).startsWith('att:')) blobIds.add(String(k).slice(4));
      const tourPhotos = new Set(s.attachments.filter((a) => a.visitId).map((a) => a.id));   // tour meetings are not "transactions": their photos stay
      const actor = { name: u.fullName, id: u.id };

      if (scope === 'EVERYTHING') {
        const rev = s.rev;
        const fresh = H.emptyState();
        for (const k of Object.keys(s)) delete s[k];
        Object.assign(s, fresh);
        s.rev = rev;
        await audit(ctx, { entity: 'SYSTEM', action: 'RESET', entityLabel: 'Entire system reset to a blank installation', branchId: null, old: before, new: { by: actor.name }, reason });
      } else {
        for (const id of tourPhotos) blobIds.delete(id);
        s.vouchers = []; s.attachments = s.attachments.filter((a) => a.visitId); s.statements = []; s.outstanding = []; s.notifications = [];
        if (p.resetNumbers !== false) { s.counters = { PAYMENT: 0, RECEIPT: 0 }; s.seq.voucher = 0; s.seq.statement = 0; s.seq.outstanding = 0; s.seq.notif = 0; }
        if (p.resetOpening !== false) for (const r of s.registers) r.openingPaise = 0;
        if (p.clearAudit) { s.audit = []; s.seq.audit = 0; }
        await audit(ctx, { entity: 'SYSTEM', action: 'CLEAR', entityLabel: 'All transactions cleared', branchId: null, old: before,
          new: { numberingRestarted: p.resetNumbers !== false, openingBalancesZeroed: p.resetOpening !== false, auditHistoryErased: !!p.clearAudit }, reason });
        notify(ctx, { kind: 'SYSTEM', title: 'All transactions were cleared', body: u.fullName + ' cleared every voucher, receipt and outstanding entry.' + (reason ? ' Reason: ' + reason : ''), branchId: null, important: true });
      }
      await ctx.save();
      await dropBlobs(ctx, blobIds);
      if (scope === 'EVERYTHING') await H.purgeLocations(null);          // a blank installation has no staff, so no locations either
      return { ok: true, scope, cleared: before, backup };
    });
  });
})(typeof window !== 'undefined' ? window : globalThis);
