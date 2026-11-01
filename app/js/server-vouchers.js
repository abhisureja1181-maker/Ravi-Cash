/* Ravi Cash — DEMO BACKEND: vouchers, attachments, cash registers, statements.
 * Mirrors what the Supabase database functions do in production (see /supabase). */
(function (g) {
  'use strict';
  const RW = (g.RW = g.RW || {});
  RW.serverModules = RW.serverModules || [];

  RW.serverModules.push(function (H) {
    const { ApiError, def, userById, branchById, isAdmin, isSuper, seesAll, level, canSeeVoucher, canSeeUser, canAdminVoucher, vView, counted, reviewOf, vlabel, audit, notify, nowIso, todayIst } = H;
    const ALLOWED_MIME = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'];

    /* ---------------------------------------------------------- validation */
    function cleanText(v, min, max, label) {
      const t = String(v === undefined || v === null ? '' : v).replace(/\s+/g, ' ').trim();
      if (t.length < min) throw new ApiError('VALIDATION', label + (min <= 1 ? ' is required' : ' must be at least ' + min + ' characters'));
      if (t.length > max) throw new ApiError('VALIDATION', label + ' must be at most ' + max + ' characters');
      return t;
    }
    function cleanMultiline(v, min, max, label) {
      const t = String(v === undefined || v === null ? '' : v).replace(/\r/g, '').replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
      if (t.length < min) throw new ApiError('VALIDATION', label + (min <= 1 ? ' is required' : ' must be at least ' + min + ' characters'));
      if (t.length > max) throw new ApiError('VALIDATION', label + ' must be at most ' + max + ' characters');
      return t;
    }
    function checkAmount(s, amount) {
      const paise = RW.toPaise(amount);
      if (paise <= 0) throw new ApiError('VALIDATION', 'Amount must be greater than 0');
      if (paise > s.settings.maxVoucherAmountPaise) throw new ApiError('VALIDATION', 'Amount exceeds the limit of ' + RW.fmtINR(s.settings.maxVoucherAmountPaise));
      return paise;
    }
    function checkDate(s, u, date) {
      if (!RW.isValidDate(date)) throw new ApiError('VALIDATION', 'Enter a valid date');
      const today = todayIst();
      if (date > today) throw new ApiError('VALIDATION', 'Date cannot be in the future');
      if (!isAdmin(u) && RW.diffDays(today, date) > s.settings.userBackdateDays) {
        throw new ApiError('VALIDATION', 'Date cannot be more than ' + s.settings.userBackdateDays + ' days in the past');
      }
      if (date < '2000-01-01') throw new ApiError('VALIDATION', 'Enter a valid date');
    }
    function parseAttachment(s, a) {
      if (!a || typeof a.dataUrl !== 'string') throw new ApiError('VALIDATION', 'Invalid attachment');
      const i = a.dataUrl.indexOf(';base64,');
      if (!a.dataUrl.startsWith('data:') || i < 0) throw new ApiError('VALIDATION', 'Invalid attachment data');
      const mime = a.dataUrl.slice(5, i).toLowerCase();
      if (!ALLOWED_MIME.includes(mime)) throw new ApiError('VALIDATION', 'Only JPG, PNG, WebP images and PDF files can be attached');
      if (a.dataUrl.length > s.settings.maxAttachmentChars) throw new ApiError('VALIDATION', 'Attachment is too large (max ~6 MB)');
      const b64 = a.dataUrl.length - i - 8;
      let name = String(a.name || 'receipt').replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_').slice(0, 100) || 'receipt';
      return { mime, name, size: Math.floor((b64 * 3) / 4), dataUrl: a.dataUrl };
    }
    function storeAttachment(ctx, v, parsed) {
      const s = ctx.state;
      const id = RW.uid('at');
      s.attachments.push({ id, voucherId: v.id, branchId: v.branchId, userId: v.userId, name: parsed.name, mime: parsed.mime, size: parsed.size, addedAt: nowIso(), addedBy: ctx.user.id });
      ctx.blobs[id] = parsed.dataUrl;
      v.attachmentIds.push(id);
      return id;
    }
    const attMeta = (s, id) => {
      const a = s.attachments.find((x) => x.id === id);
      return a ? { id: a.id, name: a.name, mime: a.mime, size: a.size, addedAt: a.addedAt, addedBy: (userById(s, a.addedBy) || {}).fullName || '' } : null;
    };

    /* ------------------------------------------------------------- queries */
    function filterVouchers(s, u, f) {
      f = f || {};
      const q = String(f.q || '').trim().toLowerCase();
      const qDigits = q.replace(/[,₹\s]/g, '');
      const qNum = /^\d+(\.\d{1,2})?$/.test(qDigits) ? qDigits : null;
      const minP = f.minAmount !== undefined && f.minAmount !== '' && f.minAmount !== null ? RW.toPaise(f.minAmount) : null;
      const maxP = f.maxAmount !== undefined && f.maxAmount !== '' && f.maxAmount !== null ? RW.toPaise(f.maxAmount) : null;
      const num = f.number ? String(f.number).trim().toLowerCase() : '';
      const out = [];
      let got = null;
      for (const v of s.vouchers) {
        if (!canSeeVoucher(u, v)) continue;
        if (v.status === 'DELETED' && !(f.includeDeleted && isAdmin(u)) && f.status !== 'DELETED') continue;
        if (f.status && v.status !== f.status) continue;
        if (f.branchId && v.branchId !== f.branchId) continue;
        if (f.userId && v.userId !== f.userId) continue;
        if (f.type && v.type !== f.type) continue;
        if (f.kind && (v.kind === 'RECEIVED' ? 'RECEIVED' : 'VOUCHER') !== f.kind) continue;
        if (f.review) {
          // the review queue only holds payments that still count; PENDING = not reviewed yet
          if (f.review === 'PENDING' ? !(v.type === 'PAYMENT' && v.status === 'ACTIVE' && !v.review) : !(v.type === 'PAYMENT' && v.review === f.review)) continue;
        }
        if (f.transfer) {       // 'ANY' = only branch transfers · 'NONE' = without them · 'PENDING' = transfers still on the way
          if (f.transfer === 'NONE' ? !!v.transfer : f.transfer === 'PENDING' ? !(v.transfer && v.type === 'PAYMENT' && counted(v) && !v.transfer.settled && !(got || (got = H.receivedIds(s))).has(v.id)) : !v.transfer) continue;
        }
        if (f.from && v.date < f.from) continue;
        if (f.to && v.date > f.to) continue;
        if (minP !== null && v.amountPaise < minP) continue;
        if (maxP !== null && v.amountPaise > maxP) continue;
        if (num && !(v.number || '').toLowerCase().includes(num)) continue;
        if (q) {
          const usr = userById(s, v.userId);
          const br = branchById(s, v.branchId);
          const hay = [v.number, v.kind === 'RECEIVED' ? 'cash received' : '', v.transfer ? 'transfer' : '', v.partyName, v.particulars, v.notes || '', usr ? usr.fullName : '', br ? br.name + ' ' + br.code : '', v.date, RW.fmtDate(v.date), RW.fmtINR(v.amountPaise), String(v.amountPaise / 100)].join(' | ').toLowerCase();
          if (!hay.includes(q) && !(qNum && String(v.amountPaise / 100) === String(Number(qNum)))) continue;
        }
        out.push(v);
      }
      const sorts = {
        date_desc: (a, b) => (a.date === b.date ? b.seq - a.seq : a.date < b.date ? 1 : -1),
        date_asc: (a, b) => (a.date === b.date ? a.seq - b.seq : a.date < b.date ? -1 : 1),
        amount_desc: (a, b) => b.amountPaise - a.amountPaise,
        amount_asc: (a, b) => a.amountPaise - b.amountPaise,
        number_asc: (a, b) => a.seq - b.seq,
        created_desc: (a, b) => b.seq - a.seq,
      };
      out.sort(sorts[f.sort] || sorts.created_desc);
      return out;
    }
    H.filterVouchers = filterVouchers;
    H.cleanText = cleanText;
    H.cleanMultiline = cleanMultiline;
    H.attMeta = attMeta;
    H.parseAttachment = parseAttachment;

    function totalsOf(list) {
      const t = H.newFlow();
      let n = 0, xp = 0, xn = 0, tn = 0;
      for (const v of list) {
        if (v.status === 'ACTIVE' && v.review === 'INVALID') { xp += v.amountPaise; xn++; } // audited "Not valid": shown, never counted
        if (!counted(v)) continue;
        n++;
        if (v.transfer) tn++;
        H.addFlow(t, v);        // transfers between branches are kept apart from real cash in / out
      }
      return Object.assign(t, { netPaise: H.flowNet(t), movePaise: H.flowMove(t), count: n, transferCount: tn, notValidPaise: xp, notValidCount: xn });
    }
    H.totalsOf = totalsOf;

    function timelineFor(ctx, v) {
      const s = ctx.state;
      const admin = isAdmin(ctx.user);
      const label = { CREATE: 'Created', ATTACH: 'Attachment added', ATTACH_REMOVED: 'Attachment removed', PDF: 'PDF generated', EDIT: 'Edited by admin', VOID: 'Voided', DELETE: 'Deleted', REVIEW: 'Audit review' };
      return s.audit
        .filter((a) => a.entity === 'VOUCHER' && a.entityId === v.id)
        .map((a) => ({
          at: a.at, action: a.action, label: label[a.action] || a.action, by: a.actorName, role: a.actorRole,
          reason: a.reason || '', old: admin ? a.old : null, new: admin ? a.new : null, device: admin ? a.device : '',
        }));
    }

    /* ------------------------------------------------------ branch transfers
     * Money sent from one branch (or person) to another is a TRANSFER: the sender books it as a payment voucher marked "transfer", the
     * receiver books a Cash Received / Cash Receipt that picks that transfer from the list of what is on the way. Neither side is then
     * counted as expense or income; both registers still move, and what has been sent but not received yet shows as "on the way". */
    const ELIGIBLE = ['USER', 'BRANCH_ADMIN', 'SUPER_ADMIN'];       // roles that can hold and receive cash
    const holders = (s, branchId) => s.users.filter((w) => !w.deleted && w.status === 'ACTIVE' && w.branchId === branchId && ELIGIBLE.includes(w.role) && H.registerOf(s, w.id));
    const whoLabel = (s, branchId, userId) => { const w = H.xferWho(s, branchId, userId); return w.branchName + (w.userName ? ' · ' + w.userName : ''); };

    // who a transfer-out is addressed to; throws a plain message when it makes no sense
    function transferTarget(s, sender, t) {
      const b = branchById(s, t && t.toBranchId);
      if (!b || b.status !== 'ACTIVE') throw new ApiError('VALIDATION', 'Choose the branch the money is sent to');
      let w = null;
      if (t.toUserId) {
        w = userById(s, t.toUserId);
        if (!w || w.deleted || w.status !== 'ACTIVE' || w.branchId !== b.id || !ELIGIBLE.includes(w.role) || !H.registerOf(s, w.id)) throw new ApiError('VALIDATION', 'Choose a person of that branch who holds a cash register');
        if (w.id === sender.id) throw new ApiError('VALIDATION', 'You cannot send money to yourself');
      } else if (b.id === sender.branchId) throw new ApiError('VALIDATION', 'To send money inside your own branch, also choose the person who receives it');
      else if (!holders(s, b.id).length) throw new ApiError('VALIDATION', 'Nobody in ' + b.name + ' holds a cash register yet, so it cannot receive money');
      return { b, w };
    }
    const isPending = (s, out, got) => !!(out && out.transfer && out.type === 'PAYMENT' && counted(out) && !out.transfer.settled && !(got || H.receivedIds(s)).has(out.id));
    const addressedTo = (out, u) => out.transfer.toBranchId === u.branchId && (!out.transfer.toUserId || out.transfer.toUserId === u.id);
    const sentLine = (s, out) => RW.fmtINR(out.amountPaise) + ' from ' + whoLabel(s, out.branchId, out.userId) + (out.number ? ' (' + out.number + ')' : '');

    // a transfer-in picks one transfer that is on the way to this user; the amount must be exactly what was sent
    function transferSource(s, u, t, amountPaise) {
      const out = s.vouchers.find((x) => x.id === (t && t.link));
      if (!out || !isPending(s, out)) throw new ApiError('CONFLICT', 'This transfer is no longer waiting — it was received already, cancelled or marked not valid. Reload the page and choose again.');
      if (!addressedTo(out, u)) throw new ApiError('FORBIDDEN', 'This transfer was sent to someone else');
      if (amountPaise !== out.amountPaise) throw new ApiError('VALIDATION', 'This transfer is for ' + RW.fmtINR(out.amountPaise) + ' — enter exactly that amount. If you really received a different amount, tell the main admin.');
      return out;
    }
    function notifyTransferSent(ctx, v, b, w) {
      const s = ctx.state;
      const who = w ? [w] : holders(s, b.id).filter((x) => x.id !== v.userId);
      for (const x of who) notify(ctx, { kind: 'TRANSFER_SENT', title: 'Cash is on the way to you', body: sentLine(s, v) + '. When you get it, add a Cash Received entry and tick "Money sent by a branch".', branchId: b.id, forAdmins: false, targetUserId: x.id });
    }
    function describeTransfer(s, v, t) {
      if (!t) return 'Not a transfer';
      return v.type === 'PAYMENT' ? 'Transfer to ' + whoLabel(s, t.toBranchId, t.toUserId) + (t.settled ? ' (already received)' : '') : 'Transfer from ' + whoLabel(s, t.fromBranchId, t.fromUserId) + (t.link ? ' (linked)' : '');
    }
    H.transferTools = { transferTarget, isPending, holders, whoLabel, describeTransfer };

    /* The people one can send money to: every active branch with the staff who hold a cash register there. */
    def('transfers.targets', { roles: ELIGIBLE }, async (ctx, p) => {
      const s = ctx.state;
      // the main admin correcting an old entry asks as the person who made it ("your own branch" and "yourself" then mean that person's)
      const as = p && p.asUserId && ctx.user.role === 'SUPER_ADMIN' ? userById(s, p.asUserId) : null;
      const u = as && !as.deleted ? as : ctx.user;
      return {
        branches: s.branches.filter((b) => b.status === 'ACTIVE').map((b, i) => ({
          id: b.id, name: b.name, code: b.code, isMain: s.branches[0] && s.branches[0].id === b.id, mine: b.id === u.branchId,
          people: holders(s, b.id).filter((x) => x.id !== u.id).map((x) => ({ id: x.id, name: x.fullName, role: x.role, designation: x.designation || '' })).sort((a, c) => a.name.localeCompare(c.name)),
        })),
      };
    });

    /* What is on the way to ME right now (sent to my branch or to me by name, not received yet). */
    def('transfers.pending', { roles: ELIGIBLE }, async (ctx, p) => {
      const s = ctx.state, u = ctx.user;
      const every = !!(p && p.all) && u.role === 'SUPER_ADMIN';      // the main admin can look at all of them (to match an old entry with its transfer)
      const rows = H.transfersPending(s).filter((out) => every || addressedTo(out, u)).sort((a, b) => (a.date === b.date ? b.seq - a.seq : a.date < b.date ? 1 : -1))
        .map((out) => ({
          id: out.id, number: out.number, date: out.date, amountPaise: out.amountPaise, particulars: out.particulars,
          from: H.xferWho(s, out.branchId, out.userId), to: H.xferWho(s, out.transfer.toBranchId, out.transfer.toUserId), toUserName: out.transfer.toUserId ? (userById(s, out.transfer.toUserId) || {}).fullName || '' : '',
        }));
      return { rows, totalPaise: rows.reduce((a, r) => a + r.amountPaise, 0) };
    });

    /* ---------------------------------------------------------- voucher CRUD */
    def('vouchers.create', { w: true }, async (ctx, p) => {
      const s = ctx.state, u = ctx.user;
      if (u.role === 'VIEWER' || u.role === 'CEO') throw new ApiError('FORBIDDEN', u.role === 'CEO' ? 'The CEO view is read-only: vouchers are created by branch staff' : 'Viewers cannot create vouchers');
      // "Cash Received" = money handed to this user (e.g. by the owner). Same form, but NO voucher number and no counter.
      const received = p.kind === 'RECEIVED';
      const type = received ? 'RECEIPT' : p.type;
      if (type !== 'PAYMENT' && type !== 'RECEIPT') throw new ApiError('VALIDATION', 'Choose Cash Payment or Cash Receipt');
      const label = received ? 'Received From' : type === 'PAYMENT' ? 'Paid To' : 'Received From';
      const date = p.date || todayIst();
      checkDate(s, u, date);
      const amountPaise = checkAmount(s, p.amount);

      // Branch transfer: out (a payment sent to another branch / person) or in (a receipt that picks a transfer which is on the way)
      let transfer = null, tTarget = null, tSource = null;
      if (p.transfer) {
        if (type === 'PAYMENT') { tTarget = transferTarget(s, u, p.transfer); transfer = { toBranchId: tTarget.b.id, toUserId: tTarget.w ? tTarget.w.id : '', settled: false }; }
        else { tSource = transferSource(s, u, p.transfer, amountPaise); transfer = { fromBranchId: tSource.branchId, fromUserId: tSource.userId, link: tSource.id }; }
      }
      const partyName = transfer
        ? cleanText(tTarget ? whoLabel(s, tTarget.b.id, tTarget.w && tTarget.w.id) : whoLabel(s, tSource.branchId, tSource.userId), 2, 120, label)
        : cleanText(p.partyName, 2, 120, label);
      const particulars = transfer && !String(p.particulars || '').trim()
        ? (tTarget ? 'Cash transfer to ' + partyName : 'Cash transfer received from ' + partyName + (tSource.number ? ' (' + tSource.number + ')' : ''))
        : received && !String(p.particulars || '').trim()
          ? 'Cash received from ' + partyName
          : cleanMultiline(p.particulars, 3, 1000, type === 'PAYMENT' ? 'Payment For / Particulars' : 'Particulars');
      const notes = p.notes ? cleanMultiline(p.notes, 0, 1000, 'Notes') : '';

      // Idempotency: a retried (offline-queued) request returns the voucher it already created.
      const clientId = p.clientId ? String(p.clientId).slice(0, 64) : null;
      if (clientId) {
        const ex = s.vouchers.find((v) => v.userId === u.id && v.clientId === clientId);
        if (ex) { ctx.dirty = false; return { voucher: vView(s, ex), duplicate: true }; }
      }
      const atts = (p.attachments || []).map((a) => parseAttachment(s, a));
      if (atts.length > s.settings.maxAttachments) throw new ApiError('VALIDATION', 'You can attach at most ' + s.settings.maxAttachments + ' files');
      if (type === 'PAYMENT' && s.settings.blockNegativeCash && H.currentBalance(s, u.id) < amountPaise) {
        throw new ApiError('VALIDATION', 'Payment exceeds your cash balance of ' + RW.fmtINR(H.currentBalance(s, u.id)));
      }
      if (!H.registerOf(s, u.id)) throw new ApiError('FORBIDDEN', 'No cash register is assigned to this user');

      // ATOMIC NUMBERING: runs inside the database lock, so no two vouchers can share a number.
      let number = '';
      if (!received) {
        const nm = s.settings.numbering[type];
        // skips any number the main admin has already given to another voucher by hand (see vouchers.edit)
        do {
          const counter = ++s.counters[type];
          number = nm.prefix + '-' + String(counter).padStart(nm.pad, '0');
        } while (s.vouchers.some((v) => (v.number || '').toUpperCase() === number.toUpperCase()));
      }

      const v = {
        id: RW.uid('v'), seq: ++s.seq.voucher, number, type, branchId: u.branchId, userId: u.id, date,
        partyName, particulars, notes, amountPaise, amountInWords: RW.amountInWords(amountPaise),
        attachmentIds: [], status: 'ACTIVE', locked: true, createdAt: nowIso(), createdBy: u.id,
        updatedAt: nowIso(), updatedBy: u.id, version: 1, clientId, voidReason: '',
      };
      if (received) v.kind = 'RECEIVED';
      if (transfer) v.transfer = transfer;
      s.vouchers.push(v);
      const tAudit = transfer ? { transfer: describeTransfer(s, v, transfer) } : {};
      await audit(ctx, {
        entity: 'VOUCHER', entityId: v.id, entityLabel: vlabel(v), action: 'CREATE', branchId: v.branchId,
        new: Object.assign(received ? { kind: 'Cash Received', date, receivedFrom: partyName, particulars, amount: amountPaise / 100 } : { number, type, date, partyName, particulars, amount: amountPaise / 100 }, tAudit),
      });
      for (const a of atts) {
        storeAttachment(ctx, v, a);
        await audit(ctx, { entity: 'VOUCHER', entityId: v.id, entityLabel: vlabel(v), action: 'ATTACH', branchId: v.branchId, new: { name: a.name, mime: a.mime, size: a.size } });
      }
      const first = u.fullName.split(' ')[0];
      const big = type === 'PAYMENT' && amountPaise >= s.settings.largePaymentAlertPaise;
      notify(ctx, received ? {
        kind: 'RECEIPT_CREATED', title: 'Cash received entry added',
        body: RW.fmtINR(amountPaise) + ' received by ' + first + ' from ' + partyName, branchId: v.branchId, voucherId: v.id, important: false,
      } : {
        kind: type === 'PAYMENT' ? 'VOUCHER_CREATED' : 'RECEIPT_CREATED',
        title: type === 'PAYMENT' ? (big ? 'Large payment voucher created' : 'New voucher created') : 'New cash receipt created',
        body: 'Voucher amount ' + RW.fmtINR(amountPaise) + ' created by ' + first + ' · ' + number, branchId: v.branchId, voucherId: v.id, important: big,
      });
      if (tTarget) notifyTransferSent(ctx, v, tTarget.b, tTarget.w);
      if (tSource && tSource.userId !== u.id) notify(ctx, { kind: 'TRANSFER_RECEIVED', title: 'Your transfer was received', body: RW.fmtINR(amountPaise) + (tSource.number ? ' (' + tSource.number + ')' : '') + ' was received by ' + u.fullName + ' · ' + (branchById(s, u.branchId) || {}).name, branchId: tSource.branchId, forAdmins: false, targetUserId: tSource.userId });
      return { voucher: vView(s, v), duplicate: false };
    });

    def('vouchers.list', {}, async (ctx, p) => {
      const s = ctx.state;
      const f = Object.assign({}, p.filters || {});
      if (p.sort && !f.sort) f.sort = p.sort; // the lists send the sort order next to the filters
      const list = filterVouchers(s, ctx.user, f);
      const pageSize = Math.min(Math.max(parseInt(p.pageSize, 10) || 25, 1), 200);
      const pages = Math.max(1, Math.ceil(list.length / pageSize));
      const page = Math.min(Math.max(parseInt(p.page, 10) || 1, 1), pages);
      const got = H.receivedIds(s);
      return {
        rows: list.slice((page - 1) * pageSize, page * pageSize).map((v) => vView(s, v, got)),
        total: list.length, page, pageSize, pages, totals: totalsOf(list),
      };
    });

    def('vouchers.get', {}, async (ctx, p) => {
      const s = ctx.state;
      let v = null;
      if (p.id) v = s.vouchers.find((x) => x.id === p.id);
      else if (p.number && String(p.number).trim()) v = s.vouchers.find((x) => x.number && x.number.toLowerCase() === String(p.number).trim().toLowerCase());
      // same error for "does not exist" and "not yours" so ids cannot be probed
      if (!v || !canSeeVoucher(ctx.user, v) || (v.status === 'DELETED' && !isAdmin(ctx.user))) throw new ApiError('NOT_FOUND', 'Voucher not found');
      return {
        voucher: vView(s, v), attachments: v.attachmentIds.map((id) => attMeta(s, id)).filter(Boolean), timeline: timelineFor(ctx, v),
        company: s.settings.company, canAdmin: canAdminVoucher(ctx.user, v), canDelete: isSuper(ctx.user),
      };
    });

    def('attachments.get', {}, async (ctx, p) => {
      const s = ctx.state;
      const a = s.attachments.find((x) => x.id === p.id);
      if (a && a.visitId) {           // a photo taken during a tour meeting
        const m = s.visits.find((x) => x.id === a.visitId);
        if (!m || !H.canSeeOwned(ctx.user, m)) throw new ApiError('NOT_FOUND', 'Photo not found');
      } else {
        const v = a && s.vouchers.find((x) => x.id === a.voucherId);
        if (!a || !v || !canSeeVoucher(ctx.user, v) || (v.status === 'DELETED' && !isAdmin(ctx.user))) throw new ApiError('NOT_FOUND', 'Attachment not found');
      }
      const dataUrl = await ctx.storage.get('att:' + a.id);
      if (!dataUrl) throw new ApiError('NOT_FOUND', 'Attachment file is missing');
      return { id: a.id, name: a.name, mime: a.mime, size: a.size, dataUrl };
    });

    def('attachments.list', { roles: ['SUPER_ADMIN', 'BRANCH_ADMIN', 'CEO', 'VIEWER'] }, async (ctx, p) => {
      const s = ctx.state;
      const f = p.filters || {};
      const q = String(f.q || '').toLowerCase();
      const rows = s.attachments
        .map((a) => ({ a, v: s.vouchers.find((x) => x.id === a.voucherId) }))
        .filter(({ a, v }) => v && canSeeVoucher(ctx.user, v) && v.status !== 'DELETED' && (!f.branchId || v.branchId === f.branchId) && (!f.userId || v.userId === f.userId)
          && (!q || (a.name + ' ' + vlabel(v) + ' ' + v.partyName).toLowerCase().includes(q)))
        .sort((x, y) => (x.a.addedAt < y.a.addedAt ? 1 : -1));
      const pageSize = Math.min(Math.max(parseInt(p.pageSize, 10) || 24, 1), 100);
      const pages = Math.max(1, Math.ceil(rows.length / pageSize));
      const page = Math.min(Math.max(parseInt(p.page, 10) || 1, 1), pages);
      return {
        total: rows.length, page, pages, pageSize,
        rows: rows.slice((page - 1) * pageSize, page * pageSize).map(({ a, v }) => ({
          id: a.id, name: a.name, mime: a.mime, size: a.size, addedAt: a.addedAt, voucherId: v.id, voucherNumber: vlabel(v),
          partyName: v.partyName, branchName: (branchById(s, v.branchId) || {}).name || '', userName: (userById(s, v.userId) || {}).fullName || '',
        })),
      };
    });

    def('vouchers.addAttachment', { w: true }, async (ctx, p) => {
      const s = ctx.state, u = ctx.user;
      const v = s.vouchers.find((x) => x.id === p.voucherId);
      if (!v || !canSeeVoucher(u, v) || v.status === 'DELETED') throw new ApiError('NOT_FOUND', 'Voucher not found');
      if (u.role === 'VIEWER' || u.role === 'CEO') throw new ApiError('FORBIDDEN', 'This role cannot attach files');
      if (!(v.userId === u.id || canAdminVoucher(u, v))) throw new ApiError('FORBIDDEN', 'You can only attach files to your own vouchers');
      if (v.status !== 'ACTIVE') throw new ApiError('LOCKED', 'This voucher is ' + v.status.toLowerCase());
      const a = parseAttachment(s, p.attachment);
      if (v.attachmentIds.length >= s.settings.maxAttachments) throw new ApiError('VALIDATION', 'This voucher already has the maximum number of attachments');
      const id = storeAttachment(ctx, v, a);
      await audit(ctx, { entity: 'VOUCHER', entityId: v.id, entityLabel: vlabel(v), action: 'ATTACH', branchId: v.branchId, new: { name: a.name, mime: a.mime, size: a.size } });
      return { attachment: attMeta(s, id) };
    });

    def('vouchers.removeAttachment', { w: true, roles: ['SUPER_ADMIN'] }, async (ctx, p) => {
      const s = ctx.state;
      const a = s.attachments.find((x) => x.id === p.id);
      const v = a && s.vouchers.find((x) => x.id === a.voucherId);
      if (!v || !canAdminVoucher(ctx.user, v)) throw new ApiError('NOT_FOUND', 'Attachment not found');
      const reason = cleanText(p.reason, 5, 500, 'Reason');
      s.attachments.splice(s.attachments.indexOf(a), 1);
      v.attachmentIds = v.attachmentIds.filter((id) => id !== a.id);
      await ctx.storage.del('att:' + a.id);
      await audit(ctx, { entity: 'VOUCHER', entityId: v.id, entityLabel: vlabel(v), action: 'ATTACH_REMOVED', branchId: v.branchId, old: { name: a.name }, reason });
      return { ok: true };
    });

    def('vouchers.logPdf', { w: true }, async (ctx, p) => {
      const s = ctx.state;
      const v = s.vouchers.find((x) => x.id === p.id);
      if (!v || !canSeeVoucher(ctx.user, v) || (v.status === 'DELETED' && !isAdmin(ctx.user))) throw new ApiError('NOT_FOUND', 'Voucher not found');
      await audit(ctx, { entity: 'VOUCHER', entityId: v.id, entityLabel: vlabel(v), action: 'PDF', branchId: v.branchId });
      return { ok: true };
    });

    /* ---------------------------------------------------- admin corrections */
    function mustAdminVoucher(ctx, id) {
      const v = ctx.state.vouchers.find((x) => x.id === id);
      if (!v || !canAdminVoucher(ctx.user, v) || v.status === 'DELETED') throw new ApiError('NOT_FOUND', 'Voucher not found');
      return v;
    }

    def('vouchers.edit', { w: true, roles: ['SUPER_ADMIN'] }, async (ctx, p) => {
      const s = ctx.state, u = ctx.user;
      const v = mustAdminVoucher(ctx, p.id);
      if (v.status !== 'ACTIVE') throw new ApiError('LOCKED', 'A voided voucher cannot be edited');
      const reason = cleanText(p.reason, 5, 500, 'Reason for edit');
      const patch = p.patch || {};
      const next = {};
      // Voucher number: only the main (Super) admin may change it (this whole method is Super-only); must stay unique
      if (patch.number !== undefined) {
        if (!v.number) throw new ApiError('VALIDATION', 'A Cash Received entry has no voucher number');
        const num = String(patch.number).trim().toUpperCase();
        if (!/^[A-Z0-9][A-Z0-9\/_-]{2,29}$/.test(num)) throw new ApiError('VALIDATION', 'Voucher number: 3-30 characters, letters / digits / - / _ only (for example CPV-000123)');
        if (s.vouchers.some((x) => x.id !== v.id && (x.number || '').toUpperCase() === num)) throw new ApiError('CONFLICT', 'The voucher number ' + num + ' is already used by another voucher');
        next.number = num;
      }
      if (patch.date !== undefined) { checkDate(s, u, patch.date); next.date = patch.date; }
      if (patch.partyName !== undefined) next.partyName = cleanText(patch.partyName, 2, 120, v.type === 'PAYMENT' ? 'Paid To' : 'Received From');
      if (patch.particulars !== undefined) next.particulars = cleanMultiline(patch.particulars, 3, 1000, 'Particulars');
      if (patch.notes !== undefined) next.notes = cleanMultiline(patch.notes, 0, 1000, 'Notes');
      if (patch.amount !== undefined) next.amountPaise = checkAmount(s, patch.amount);
      const oldV = {}, newV = {};
      for (const k of Object.keys(next)) {
        if (next[k] !== v[k]) {
          oldV[k === 'amountPaise' ? 'amount' : k] = k === 'amountPaise' ? v[k] / 100 : v[k];
          newV[k === 'amountPaise' ? 'amount' : k] = k === 'amountPaise' ? next[k] / 100 : next[k];
        }
      }
      // Branch transfer: the main admin can mark an old entry as a transfer (so it stops counting as income / expense), change it, or take the mark off
      let tNext;
      if (patch.transfer !== undefined) {
        const t = patch.transfer;
        const got = H.receivedIds(s);
        if (v.type === 'PAYMENT' && v.transfer && got.has(v.id) && !(t && t.toBranchId === v.transfer.toBranchId && (t.toUserId || '') === (v.transfer.toUserId || ''))) throw new ApiError('VALIDATION', 'A branch has already received this transfer. First take the transfer mark off its Cash Received entry.');
        if (!t) tNext = null;
        else if (v.type === 'PAYMENT') {
          const sender = userById(s, v.userId) || { id: v.userId, branchId: v.branchId };
          const tg = transferTarget(s, sender, t);
          tNext = { toBranchId: tg.b.id, toUserId: tg.w ? tg.w.id : '', settled: t.settled !== false };
        } else if (t.link) {
          const out = s.vouchers.find((x) => x.id === t.link);
          if (!out || !out.transfer || out.type !== 'PAYMENT' || !counted(out)) throw new ApiError('VALIDATION', 'Choose a transfer that was sent');
          if (got.has(out.id) && !(v.transfer && v.transfer.link === out.id)) throw new ApiError('CONFLICT', 'That transfer has already been received by another entry');
          tNext = { fromBranchId: out.branchId, fromUserId: out.userId, link: out.id };
        } else {
          const b = branchById(s, t.fromBranchId);
          if (!b) throw new ApiError('VALIDATION', 'Choose the branch the money came from');
          const w = t.fromUserId ? userById(s, t.fromUserId) : null;
          if (t.fromUserId && (!w || w.branchId !== b.id)) throw new ApiError('VALIDATION', 'Choose a person of that branch');
          tNext = { fromBranchId: b.id, fromUserId: w ? w.id : '', link: '' };
        }
        const was = describeTransfer(s, v, v.transfer), now = describeTransfer(s, v, tNext);
        if (was !== now) { oldV.transfer = was; newV.transfer = now; } else tNext = undefined;
      }
      if (!Object.keys(newV).length) throw new ApiError('VALIDATION', 'Nothing was changed');
      if (tNext !== undefined) { if (tNext) v.transfer = tNext; else delete v.transfer; }
      Object.keys(next).forEach((k) => { v[k] = next[k]; });
      if (next.amountPaise !== undefined) v.amountInWords = RW.amountInWords(v.amountPaise);
      if (v.review === 'VALID') { delete v.review; v.reviewReason = ''; v.reviewedAt = null; v.reviewedBy = null; newV.review = 'Not reviewed (changed after review)'; }
      v.version++; v.updatedAt = nowIso(); v.updatedBy = u.id;
      await audit(ctx, { entity: 'VOUCHER', entityId: v.id, entityLabel: vlabel(v) + (oldV.number ? ' (was ' + oldV.number + ')' : ''), action: 'EDIT', branchId: v.branchId, old: oldV, new: newV, reason });
      if (tNext && v.type === 'PAYMENT' && !tNext.settled) notifyTransferSent(ctx, v, branchById(s, tNext.toBranchId), tNext.toUserId ? userById(s, tNext.toUserId) : null);
      notify(ctx, { kind: 'VOUCHER_EDITED', title: 'Admin edited voucher', body: vlabel(v) + ' edited by ' + u.fullName + ' — ' + reason, branchId: v.branchId, voucherId: v.id });
      if (v.userId !== u.id) notify(ctx, { kind: 'VOUCHER_EDITED', title: 'Your voucher was corrected', body: vlabel(v) + ' was edited by an administrator. Reason: ' + reason, branchId: v.branchId, forAdmins: false, targetUserId: v.userId, voucherId: v.id });
      return { voucher: vView(s, v) };
    });

    def('vouchers.void', { w: true, roles: ['SUPER_ADMIN'] }, async (ctx, p) => {
      const s = ctx.state, u = ctx.user;
      const v = mustAdminVoucher(ctx, p.id);
      if (v.status !== 'ACTIVE') throw new ApiError('LOCKED', 'This voucher is already ' + v.status.toLowerCase());
      const reason = cleanText(p.reason, 5, 500, 'Reason for voiding');
      v.status = 'VOID'; v.voidReason = reason; v.voidedAt = nowIso(); v.voidedBy = u.id;
      v.version++; v.updatedAt = nowIso(); v.updatedBy = u.id;
      await audit(ctx, { entity: 'VOUCHER', entityId: v.id, entityLabel: vlabel(v), action: 'VOID', branchId: v.branchId, old: { status: 'ACTIVE' }, new: { status: 'VOID' }, reason });
      notify(ctx, { kind: 'VOUCHER_VOID', title: 'Voucher voided', body: vlabel(v) + ' (' + RW.fmtINR(v.amountPaise) + ') voided by ' + u.fullName + ' — ' + reason, branchId: v.branchId, voucherId: v.id, important: true });
      if (v.userId !== u.id) notify(ctx, { kind: 'VOUCHER_VOID', title: 'Your voucher was voided', body: vlabel(v) + ' was voided. Reason: ' + reason, branchId: v.branchId, forAdmins: false, targetUserId: v.userId, voucherId: v.id });
      return { voucher: vView(s, v) };
    });

    /* Audit review: only the main (Super) admin decides whether a payment voucher is Valid. Branch admins and users
     * see the result but cannot change it. A voucher marked "Not valid" is kept (and fully visible) but its amount is
     * no longer counted as an expense, so it returns to the user's cash. */
    def('vouchers.review', { w: true, roles: ['SUPER_ADMIN'] }, async (ctx, p) => {
      const s = ctx.state, u = ctx.user;
      const v = mustAdminVoucher(ctx, p.id);
      if (v.type !== 'PAYMENT') throw new ApiError('VALIDATION', 'Only cash payment vouchers are reviewed');
      if (v.status !== 'ACTIVE') throw new ApiError('LOCKED', 'This voucher is ' + v.status.toLowerCase() + ' and cannot be reviewed');
      const to = String(p.status || '').toUpperCase();
      if (to !== 'VALID' && to !== 'INVALID' && to !== 'PENDING') throw new ApiError('VALIDATION', 'Choose Valid or Not valid');
      const reason = to === 'INVALID' ? cleanText(p.reason, 5, 500, 'Reason for marking not valid') : (p.reason ? cleanText(p.reason, 0, 500, 'Note') : '');
      const from = reviewOf(v);
      if (from === to) throw new ApiError('VALIDATION', 'This voucher is already marked ' + (to === 'INVALID' ? 'not valid' : to.toLowerCase()));
      if (to === 'PENDING') { delete v.review; v.reviewReason = ''; v.reviewedAt = null; v.reviewedBy = null; }
      else { v.review = to; v.reviewReason = reason; v.reviewedAt = nowIso(); v.reviewedBy = u.id; }
      v.version++; v.updatedAt = nowIso(); v.updatedBy = u.id;
      const word = { VALID: 'Valid', INVALID: 'Not valid', PENDING: 'Not reviewed' };
      await audit(ctx, {
        entity: 'VOUCHER', entityId: v.id, entityLabel: vlabel(v), action: 'REVIEW', branchId: v.branchId,
        old: { review: word[from], counted: from !== 'INVALID' }, new: { review: word[to], counted: to !== 'INVALID' }, reason,
      });
      if (to === 'INVALID') {
        notify(ctx, { kind: 'VOUCHER_REVIEW', title: 'Voucher marked not valid', body: vlabel(v) + ' (' + RW.fmtINR(v.amountPaise) + ') is not counted as expense — ' + reason, branchId: v.branchId, voucherId: v.id, important: true });
        if (v.userId !== u.id) notify(ctx, { kind: 'VOUCHER_REVIEW', title: 'Your voucher is not valid', body: vlabel(v) + ' (' + RW.fmtINR(v.amountPaise) + ') was marked not valid, so the amount is back in your cash. Reason: ' + reason, branchId: v.branchId, forAdmins: false, targetUserId: v.userId, voucherId: v.id });
      } else if (from === 'INVALID' && v.userId !== u.id) {
        notify(ctx, { kind: 'VOUCHER_REVIEW', title: 'Your voucher is counted again', body: vlabel(v) + ' (' + RW.fmtINR(v.amountPaise) + ') was reviewed again and counts as an expense.', branchId: v.branchId, forAdmins: false, targetUserId: v.userId, voucherId: v.id });
      }
      return { voucher: vView(s, v) };
    });

    def('vouchers.reviewSummary', { roles: ['SUPER_ADMIN', 'BRANCH_ADMIN', 'CEO', 'VIEWER'] }, async (ctx, p) => {
      const s = ctx.state;
      const base = Object.assign({}, (p && p.filters) || {});
      delete base.review;
      const out = {};
      for (const k of ['PENDING', 'VALID', 'INVALID']) {
        const list = filterVouchers(s, ctx.user, Object.assign({}, base, { review: k }));
        out[k] = { count: list.length, paise: list.reduce((a, v) => a + v.amountPaise, 0) };
      }
      return out;
    });

    // "Delete" is a soft delete: the record, its number and its audit trail are kept forever.
    def('vouchers.delete', { w: true, roles: ['SUPER_ADMIN'] }, async (ctx, p) => {
      const s = ctx.state, u = ctx.user;
      const v = mustAdminVoucher(ctx, p.id);
      const reason = cleanText(p.reason, 5, 500, 'Reason for deleting');
      const prev = v.status;
      v.status = 'DELETED'; v.deletedAt = nowIso(); v.deletedBy = u.id; v.voidReason = v.voidReason || reason;
      v.version++; v.updatedAt = nowIso(); v.updatedBy = u.id;
      await audit(ctx, { entity: 'VOUCHER', entityId: v.id, entityLabel: vlabel(v), action: 'DELETE', branchId: v.branchId, old: { status: prev, amount: v.amountPaise / 100 }, new: { status: 'DELETED' }, reason });
      notify(ctx, { kind: 'VOUCHER_DELETED', title: 'Voucher deleted', body: vlabel(v) + ' deleted by ' + u.fullName + ' — ' + reason, branchId: v.branchId, important: true });
      return { ok: true };
    });

    /* ------------------------------------------------------ cash registers */
    function buildRegister(s, target, from, to) {
      const reg = H.registerOf(s, target.id);
      if (!reg) throw new ApiError('NOT_FOUND', 'This user has no cash register');
      // Entries marked "Not valid" in the audit review stay visible but never move the balance.
      const all = s.vouchers.filter((v) => v.userId === target.id && v.status === 'ACTIVE').sort((a, b) => (a.date === b.date ? a.seq - b.seq : a.date < b.date ? -1 : 1));
      let opening = reg.openingPaise;
      for (const v of all) { if (v.date < from && counted(v)) opening += v.type === 'RECEIPT' ? v.amountPaise : -v.amountPaise; }
      let running = opening, i = 0, o = 0, rcv = 0, nValid = 0, nInvalid = 0, xPaise = 0, xi = 0, xo = 0;
      const rows = [];
      const got = H.receivedIds(s);
      for (const v of all) {
        if (v.date < from || v.date > to) continue;
        const ok = counted(v);
        const inP = ok && v.type === 'RECEIPT' ? v.amountPaise : 0;
        const outP = ok && v.type === 'PAYMENT' ? v.amountPaise : 0;
        running += inP - outP; i += inP; o += outP;
        if (v.transfer) { xi += inP; xo += outP; }
        if (ok) { nValid++; if (v.kind === 'RECEIVED' && !v.transfer) rcv += v.amountPaise; } else { nInvalid++; xPaise += v.amountPaise; }
        rows.push({
          id: v.id, date: v.date, number: v.number, kind: v.kind === 'RECEIVED' ? 'RECEIVED' : 'VOUCHER', label: vlabel(v), type: v.type, partyName: v.partyName, particulars: v.particulars,
          inPaise: inP, outPaise: outP, balancePaise: running, createdAt: v.createdAt, notValid: !ok, amountPaise: v.amountPaise, review: reviewOf(v),
          transfer: v.transfer ? H.transferView(s, v, got) : null,
        });
      }
      const voided = s.vouchers.filter((v) => v.userId === target.id && v.status === 'VOID' && v.date >= from && v.date <= to).length;
      const b = branchById(s, target.branchId);
      return {
        register: { id: reg.id, openingPaise: reg.openingPaise },
        user: { id: target.id, fullName: target.fullName, username: target.username, designation: target.designation || '' },
        branch: b ? { id: b.id, code: b.code, name: b.name } : null,
        from, to, openingPaise: opening, inPaise: i, outPaise: o, xInPaise: xi, xOutPaise: xo, closingPaise: running, count: nValid, voidedCount: voided, receivedPaise: rcv, notValidCount: nInvalid, notValidPaise: xPaise, rows,
        currentBalancePaise: H.currentBalance(s, target.id),
      };
    }
    H.buildRegister = buildRegister;

    function resolveTarget(ctx, userId) {
      const t = userById(ctx.state, userId || ctx.user.id);
      if (!t || !canSeeUser(ctx.user, t)) throw new ApiError('NOT_FOUND', 'User not found');
      return t;
    }

    def('register.get', {}, async (ctx, p) => {
      const s = ctx.state;
      const t = resolveTarget(ctx, p.userId);
      const today = todayIst();
      const from = p.from || RW.startOfMonth(today);
      const to = p.to || today;
      if (!RW.isValidDate(from) || !RW.isValidDate(to) || from > to) throw new ApiError('VALIDATION', 'Choose a valid date range');
      return buildRegister(s, t, from, to);
    });

    def('registers.list', {}, async (ctx) => {
      const s = ctx.state;
      const rows = s.registers
        .map((r) => ({ r, u: userById(s, r.userId) }))
        .filter(({ u }) => u && !u.deleted && canSeeUser(ctx.user, u))
        .map(({ r, u }) => {
          const t = H.netFor(s, (v) => v.userId === u.id);
          const mine = s.vouchers.filter((v) => v.userId === u.id && v.status === 'ACTIVE');
          const rcv = mine.reduce((n, v) => n + (counted(v) && v.kind === 'RECEIVED' && !v.transfer ? v.amountPaise : 0), 0);
          const nv = mine.reduce((n, v) => n + (v.review === 'INVALID' ? v.amountPaise : 0), 0);
          return {
            receivedPaise: rcv, notValidPaise: nv,
            id: r.id, userId: u.id, userName: u.fullName, role: u.role, status: u.status, branchId: u.branchId, branchName: (branchById(s, u.branchId) || {}).name || '', branchCode: (branchById(s, u.branchId) || {}).code || '',
            openingPaise: r.openingPaise, inPaise: t.inPaise + t.xInPaise, outPaise: t.outPaise + t.xOutPaise, xInPaise: t.xInPaise, xOutPaise: t.xOutPaise, balancePaise: r.openingPaise + t.movePaise, voucherCount: t.count, lastActivityAt: u.lastActivityAt || null,
          };
        })
        .sort((a, b) => a.branchName.localeCompare(b.branchName) || a.userName.localeCompare(b.userName));
      return { rows };
    });

    def('registers.setOpening', { w: true, roles: ['SUPER_ADMIN'] }, async (ctx, p) => {
      const s = ctx.state;
      const t = userById(s, p.userId);
      if (!t || !canSeeUser(ctx.user, t)) throw new ApiError('NOT_FOUND', 'User not found');
      const reg = H.registerOf(s, t.id);
      if (!reg) throw new ApiError('NOT_FOUND', 'This user has no cash register');
      const paise = RW.toPaise(p.amount);
      if (paise > s.settings.maxVoucherAmountPaise * 10) throw new ApiError('VALIDATION', 'Amount is too large');
      const reason = cleanText(p.reason, 5, 500, 'Reason');
      const old = reg.openingPaise;
      reg.openingPaise = paise;
      await audit(ctx, { entity: 'REGISTER', entityId: reg.id, entityLabel: reg.id + ' (' + t.fullName + ')', action: 'EDIT', branchId: t.branchId, old: { opening: old / 100 }, new: { opening: paise / 100 }, reason });
      return { ok: true };
    });

    /* ----------------------------------------------------------- statements */
    function periodRange(s, p) {
      const today = todayIst();
      const anchor = p.anchor || today;
      if (!RW.isValidDate(anchor)) throw new ApiError('VALIDATION', 'Choose a valid date');
      const fy = s.settings.fiscalYearStartMonth;
      switch (p.period) {
        case 'DAY': return { from: anchor, to: anchor, label: RW.fmtDate(anchor), name: 'Daily' };
        case 'WEEK': { const f = RW.startOfWeek(anchor); const t = RW.addDays(f, 6); return { from: f, to: t, label: RW.fmtDate(f) + ' – ' + RW.fmtDate(t), name: 'Weekly' }; }
        case 'MONTH': return { from: RW.startOfMonth(anchor), to: RW.endOfMonth(anchor), label: RW.MONTHS_LONG[+anchor.slice(5, 7) - 1] + ' ' + anchor.slice(0, 4), name: 'Monthly' };
        case 'YEAR': {
          const f = RW.fiscalStart(anchor, fy);
          return { from: f, to: RW.fiscalEnd(anchor, fy), label: (fy === 1 ? 'Calendar Year ' : 'Financial Year ') + RW.fiscalLabel(anchor, fy), name: 'Yearly' };
        }
        case 'CUSTOM': {
          if (!RW.isValidDate(p.from) || !RW.isValidDate(p.to) || p.from > p.to) throw new ApiError('VALIDATION', 'Choose a valid date range');
          if (RW.diffDays(p.to, p.from) > 3660) throw new ApiError('VALIDATION', 'Date range is too long (max 10 years)');
          return { from: p.from, to: p.to, label: RW.fmtDate(p.from) + ' – ' + RW.fmtDate(p.to), name: 'Custom' };
        }
        default: throw new ApiError('VALIDATION', 'Choose a statement period');
      }
    }

    def('statements.generate', { w: true }, async (ctx, p) => {
      const s = ctx.state, u = ctx.user;
      const t = resolveTarget(ctx, p.userId);
      const pr = periodRange(s, p);
      const reg = buildRegister(s, t, pr.from, pr.to);
      const no = 'STM-' + pr.from.slice(0, 4) + '-' + String(++s.seq.statement).padStart(5, '0');
      s.statements.push({
        id: RW.uid('st'), no, userId: t.id, branchId: t.branchId, registerId: reg.register.id, period: p.period, periodLabel: pr.label,
        from: pr.from, to: pr.to, openingPaise: reg.openingPaise, inPaise: reg.inPaise, outPaise: reg.outPaise, closingPaise: reg.closingPaise,
        count: reg.count, generatedBy: u.id, generatedAt: nowIso(),
      });
      if (s.statements.length > 1000) s.statements.splice(0, s.statements.length - 1000);
      await audit(ctx, { entity: 'STATEMENT', entityId: no, entityLabel: no + ' · ' + t.fullName + ' · ' + pr.label, action: 'GENERATE', branchId: t.branchId });
      if (p.period === 'WEEK' || p.period === 'MONTH' || p.period === 'YEAR') {
        notify(ctx, { kind: 'STATEMENT_GENERATED', title: pr.name + ' statement generated', body: t.fullName + ' · ' + pr.label + ' · generated by ' + u.fullName, branchId: t.branchId });
      }
      const gb = branchById(s, u.branchId);
      return Object.assign(reg, {
        number: no, period: { type: p.period, name: pr.name, label: pr.label, from: pr.from, to: pr.to },
        generatedAt: nowIso(), generatedBy: { id: u.id, fullName: u.fullName }, generatedByBranch: gb ? gb.name : '', company: s.settings.company,
      });
    });

    def('statements.history', {}, async (ctx) => {
      const s = ctx.state;
      const rows = s.statements
        .filter((x) => { const t = userById(s, x.userId); return t && canSeeUser(ctx.user, t); })
        .slice(-60).reverse()
        .map((x) => ({ id: x.id, number: x.no, userId: x.userId, userName: (userById(s, x.userId) || {}).fullName || '', branchName: (branchById(s, x.branchId) || {}).name || '', period: x.period, periodLabel: x.periodLabel, from: x.from, to: x.to, closingPaise: x.closingPaise, generatedAt: x.generatedAt, generatedBy: (userById(s, x.generatedBy) || {}).fullName || '' }));
      return { rows };
    });
  });
})(typeof window !== 'undefined' ? window : globalThis);
