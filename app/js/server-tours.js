/* Ravi Cash — TOURS.
 *
 *  Tour plan    : an advance plan for one or more days. Every day has the place(s) to go to and the parties to meet
 *                 (name, address, phone, purpose).
 *  Tour detail  : a meeting that really happened during the tour ("visit"): party name, address, phone, contact
 *                 person, notes and up to four photos taken on the spot.
 *
 * Who can do what
 *   - SUPER_ADMIN, BRANCH_ADMIN and USER make their own plans and record their own meetings.
 *   - VIEWER and CEO only read (the CEO sees every branch, a Branch Admin / Viewer sees the branch, a User sees own).
 *   - A new plan goes to the main (Super) admin for APPROVAL. Until it is approved only the main admin can change it
 *     (the person who made it cannot). Once approved it is FINAL: nobody can change the plan any more.
 *     The person who made it can only CANCEL the tour (and mark it completed when it is over).
 *   - A person can change or delete their own meeting for 48 hours after recording it; after that it is locked, so
 *     the field record cannot be rewritten later. Every change is written to the audit trail.
 */
(function (g) {
  'use strict';
  const RW = (g.RW = g.RW || {});
  RW.serverModules = RW.serverModules || [];

  RW.serverModules.push(function (H) {
    const { ApiError, def, userById, branchById, isSuper, canSeeOwned, audit, notify, nowIso, todayIst, cleanText, cleanMultiline } = H;
    const WRITERS = ['SUPER_ADMIN', 'BRANCH_ADMIN', 'USER'];
    const MAX_DAYS = 60, MAX_PARTIES_PER_DAY = 15, MAX_PHOTOS = 4, EDIT_HOURS = 48;
    const PHASES = ['UPCOMING', 'ONGOING', 'ENDED', 'COMPLETED', 'CANCELLED'];
    const ADMIN = ['SUPER_ADMIN'];   // the main admin: approves and changes tour plans
    H.TOUR_EDIT_HOURS = EDIT_HOURS;

    /* ------------------------------------------------------------ validation */
    function cleanPhone(v, label) {
      const t = String(v === undefined || v === null ? '' : v).replace(/\s+/g, ' ').trim();
      if (!t) return '';
      if (!/^\+?[0-9 ()-]{6,24}$/.test(t)) throw new ApiError('VALIDATION', label + ' can have only digits, spaces and + - ( )');
      const n = t.replace(/\D/g, '').length;
      if (n < 7 || n > 15) throw new ApiError('VALIDATION', label + ' must have 7 to 15 digits');
      return t;
    }
    function cleanTime(v) {
      const t = String(v === undefined || v === null ? '' : v).trim();
      if (!t) return '';
      if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(t)) throw new ApiError('VALIDATION', 'Enter a valid time');
      return t;
    }
    const range = (a, b) => RW.fmtDateShort(a) + ' – ' + RW.fmtDateShort(b);

    function cleanParty(p, label, used) {
      p = p || {};
      let id = typeof p.id === 'string' && /^pp_[0-9a-f]{8,32}$/.test(p.id) && !used.has(p.id) ? p.id : RW.uid('pp');
      used.add(id);
      return {
        id,
        name: cleanText(p.name, 2, 100, label + ' party name'),
        address: cleanText(p.address, 0, 250, label + ' party address'),
        phone: cleanPhone(p.phone, label + ' party phone'),
        purpose: cleanText(p.purpose, 0, 200, label + ' purpose'),
      };
    }
    function cleanDays(days, startDate, endDate) {
      if (!Array.isArray(days) || !days.length) throw new ApiError('VALIDATION', 'Add at least one day to the plan');
      if (days.length > MAX_DAYS) throw new ApiError('VALIDATION', 'A plan can have at most ' + MAX_DAYS + ' days');
      const seen = new Set(), used = new Set();
      const out = days.map((d, i) => {
        d = d || {};
        const label = 'Day ' + (i + 1) + (RW.isValidDate(d.date) ? ' (' + RW.fmtDateShort(d.date) + ')' : '');
        if (!RW.isValidDate(d.date) || d.date < startDate || d.date > endDate) throw new ApiError('VALIDATION', label + ': date must be within the tour (' + range(startDate, endDate) + ')');
        if (seen.has(d.date)) throw new ApiError('VALIDATION', RW.fmtDate(d.date) + ' is listed twice');
        seen.add(d.date);
        const parties = Array.isArray(d.parties) ? d.parties : [];
        if (parties.length > MAX_PARTIES_PER_DAY) throw new ApiError('VALIDATION', label + ': at most ' + MAX_PARTIES_PER_DAY + ' parties a day');
        return {
          date: d.date,
          place: cleanText(d.place, 2, 200, label + ' place'),
          notes: cleanMultiline(d.notes, 0, 500, label + ' notes'),
          parties: parties.map((p, j) => cleanParty(p, label + ', party ' + (j + 1) + ':', used)),
        };
      });
      out.sort((a, b) => (a.date < b.date ? -1 : 1));
      return out;
    }
    function checkRange(startDate, endDate, today, changed) {
      if (!RW.isValidDate(startDate) || !RW.isValidDate(endDate)) throw new ApiError('VALIDATION', 'Enter the start and end date of the tour');
      if (endDate < startDate) throw new ApiError('VALIDATION', 'The end date cannot be before the start date');
      if (RW.diffDays(endDate, startDate) + 1 > MAX_DAYS) throw new ApiError('VALIDATION', 'A tour can last at most ' + MAX_DAYS + ' days');
      if (changed && (startDate < RW.addDays(today, -30) || startDate > RW.addDays(today, 366))) throw new ApiError('VALIDATION', 'The start date must be within the last 30 days or the next year');
    }

    /* --------------------------------------------------------------- helpers */
    const tourById = (s, id) => s.tours.find((t) => t.id === id) || null;
    const visitById = (s, id) => s.visits.find((v) => v.id === id) || null;
    const canWrite = (u) => WRITERS.includes(u.role);
    const isOwner = (u, t) => canWrite(u) && t.userId === u.id;
    /* approval: a plan starts PENDING; plans saved before approvals existed count as approved (final) */
    const approvalOf = (t) => (t.approval === 'PENDING' ? 'PENDING' : 'APPROVED');
    const awaiting = (t) => t.status === 'PLANNED' && approvalOf(t) === 'PENDING';
    const canEditPlan = (u, t) => isSuper(u) && awaiting(t);                         // only the main admin, and only until it is approved
    const canCloseTour = (u, t) => t.status === 'PLANNED' && (isSuper(u) || isOwner(u, t));   // cancel / complete
    const canEditVisit = (u, v) => isSuper(u) || (canWrite(u) && v.userId === u.id && H.clock() <= Date.parse(v.createdAt) + EDIT_HOURS * 3600000);
    const lockedAt = (v) => new Date(Date.parse(v.createdAt) + EDIT_HOURS * 3600000).toISOString();

    function phaseOf(t, today) {
      if (t.status === 'CANCELLED') return 'CANCELLED';
      if (t.status === 'COMPLETED') return 'COMPLETED';
      if (today < t.startDate) return 'UPCOMING';
      if (today > t.endDate) return 'ENDED';       // the dates are over but nobody marked the tour completed
      return 'ONGOING';
    }
    const photoMeta = (s, id) => {
      const a = s.attachments.find((x) => x.id === id);
      return a ? { id: a.id, name: a.name, mime: a.mime, size: a.size, addedAt: a.addedAt } : null;
    };
    function visitView(s, ctx, v) {
      const u = userById(s, v.userId), b = branchById(s, v.branchId), t = v.tourId ? tourById(s, v.tourId) : null;
      const out = {
        id: v.id, seq: v.seq, tourId: v.tourId || null, tourTitle: t ? t.title : '', plannedPartyId: v.plannedPartyId || null,
        date: v.date, time: v.time || '', partyName: v.partyName, address: v.address, phone: v.phone, contactPerson: v.contactPerson || '', notes: v.notes || '',
        userId: v.userId, userName: u ? u.fullName : 'Unknown', branchId: v.branchId, branchName: b ? b.name : '', branchCode: b ? b.code : '',
        photos: v.photoIds.map((id) => photoMeta(s, id)).filter(Boolean), photoCount: v.photoIds.length,
        createdAt: v.createdAt, updatedAt: v.updatedAt, version: v.version,
        canEdit: canEditVisit(ctx.user, v), lockedAt: lockedAt(v),
        hasLocation: !!v.geo,
      };
      // where the meeting was recorded is for the main admin and the CEO only
      if (H.level(ctx.user) === 'ALL') {
        out.geo = v.geo ? { lat: v.geo.lat, lng: v.geo.lng, acc: v.geo.acc || 0, at: v.geo.at, stale: !!v.geo.at && Date.parse(v.createdAt) - Date.parse(v.geo.at) > 10 * 60000 } : null;
        out.geoStatus = v.geo ? 'OK' : v.geoStatus || 'NONE';
      }
      return out;
    }
    function tourView(s, t, today, vis) {
      const u = userById(s, t.userId), b = branchById(s, t.branchId);
      const met = new Set(vis.filter((v) => v.plannedPartyId).map((v) => v.plannedPartyId));
      let planned = 0, metPlanned = 0;
      for (const d of t.days) for (const p of d.parties) { planned++; if (met.has(p.id)) metPlanned++; }
      const places = [];
      for (const d of t.days) for (const x of String(d.place).split(/\s*[,;/]\s*/)) if (x && !places.some((y) => y.toLowerCase() === x.toLowerCase())) places.push(x);
      return {
        id: t.id, seq: t.seq, title: t.title, purpose: t.purpose || '', startDate: t.startDate, endDate: t.endDate, status: t.status, phase: phaseOf(t, today),
        userId: t.userId, userName: u ? u.fullName : 'Unknown', designation: u ? u.designation || '' : '', branchId: t.branchId, branchName: b ? b.name : '', branchCode: b ? b.code : '',
        approval: approvalOf(t), awaiting: awaiting(t), approvedAt: t.approvedAt || null, approvedBy: (userById(s, t.approvedBy) || {}).fullName || '',
        dayCount: t.days.length, places, plannedParties: planned, metPlanned, visitCount: vis.length,
        photoCount: vis.reduce((n, v) => n + v.photoIds.length, 0),
        createdAt: t.createdAt, updatedAt: t.updatedAt, completedAt: t.completedAt || null, cancelReason: t.cancelReason || '', version: t.version,
      };
    }
    function visitsByTour(s) {
      const m = new Map();
      for (const v of s.visits) if (v.tourId) { if (!m.has(v.tourId)) m.set(v.tourId, []); m.get(v.tourId).push(v); }
      return m;
    }
    const visitSort = (a, b) => (a.date === b.date ? ((a.time || '99') === (b.time || '99') ? a.seq - b.seq : (a.time || '99') < (b.time || '99') ? -1 : 1) : a.date < b.date ? -1 : 1);
    const paging = (p, rows) => {
      const pageSize = Math.min(Math.max(parseInt(p.pageSize, 10) || 20, 1), 100);
      const pages = Math.max(1, Math.ceil(rows.length / pageSize));
      const page = Math.min(Math.max(parseInt(p.page, 10) || 1, 1), pages);
      return { total: rows.length, page, pages, pageSize, slice: rows.slice((page - 1) * pageSize, page * pageSize) };
    };
    const snapTour = (t) => ({ approval: approvalOf(t), title: t.title, purpose: t.purpose, from: t.startDate, to: t.endDate, days: t.days.length, parties: t.days.reduce((n, d) => n + d.parties.length, 0), places: t.days.map((d) => RW.fmtDateShort(d.date) + ': ' + d.place).join(' | ') });
    const snapVisit = (v) => ({ location: v.geo ? 'saved (±' + (v.geo.acc || 0) + ' m)' : 'not available', party: v.partyName, address: v.address, phone: v.phone, contact: v.contactPerson || '', date: v.date, time: v.time || '', notes: v.notes || '', photos: v.photoIds.length });

    function photoFrom(s, a) {
      const parsed = H.parseAttachment(s, a && a.name ? a : Object.assign({}, a, { name: 'visit-photo.jpg' }));
      if (!/^image\//.test(parsed.mime)) throw new ApiError('VALIDATION', 'Only photos can be added to a meeting');
      return parsed;
    }
    function storePhoto(ctx, v, parsed) {
      const id = RW.uid('ph');
      ctx.state.attachments.push({ id, visitId: v.id, tourId: v.tourId || null, branchId: v.branchId, userId: v.userId, name: parsed.name, mime: parsed.mime, size: parsed.size, addedAt: nowIso(), addedBy: ctx.user.id });
      ctx.blobs[id] = parsed.dataUrl;
      v.photoIds.push(id);
      return id;
    }
    const dropPhotos = async (ctx, ids) => { for (const id of ids) { try { await ctx.storage.del('att:' + id); } catch (e) { /* an orphan file is harmless */ } } };
    function removePhotoRecords(s, ids) {
      const set = new Set(ids);
      s.attachments = s.attachments.filter((a) => !set.has(a.id));
    }

    function checkVisitDate(s, u, date, tour) {
      if (!RW.isValidDate(date) || date < '2000-01-01') throw new ApiError('VALIDATION', 'Enter a valid date');
      const today = todayIst();
      if (date > today) throw new ApiError('VALIDATION', 'Date cannot be in the future');
      if (tour) {
        if (date < tour.startDate || date > tour.endDate) throw new ApiError('VALIDATION', 'The date must be within the tour (' + range(tour.startDate, tour.endDate) + '). Change the tour dates first if the tour was extended.');
      } else if (!isSuper(u) && RW.diffDays(today, date) > s.settings.userBackdateDays) {
        throw new ApiError('VALIDATION', 'Date cannot be more than ' + s.settings.userBackdateDays + ' days in the past');
      }
    }
    /* Where the meeting was recorded from: the phone's position at that moment. Missing is allowed (GPS off or blocked),
     * but it is remembered WHY, so the main admin can see which meetings have no place. Cannot be edited afterwards. */
    function cleanGeo(p) {
      const g = p.geo;
      if (g && typeof g === 'object') {
        const fix = H.cleanFix(g), at = Number(g.at);
        return { geo: Object.assign(fix, { at: at > 0 && Math.abs(at - H.clock()) < 864e5 ? new Date(at).toISOString() : nowIso() }) };
      }
      return { geoStatus: ['OFF', 'DENIED', 'UNAVAILABLE'].includes(p.geoStatus) ? p.geoStatus : 'UNAVAILABLE' };
    }
    function visitFields(p, label) {
      return {
        partyName: cleanText(p.partyName, 2, 100, 'Party name'),
        address: cleanText(p.address, 2, 250, 'Address'),
        phone: cleanPhone(p.phone, 'Phone number'),
        contactPerson: cleanText(p.contactPerson, 0, 100, 'Contact person'),
        notes: cleanMultiline(p.notes, 0, 1000, 'Notes'),
        time: cleanTime(p.time),
      };
    }
    function findPlannedParty(t, id) {
      for (const d of t.days) { const p = d.parties.find((x) => x.id === id); if (p) return Object.assign({ date: d.date }, p); }
      return null;
    }

    /* ----------------------------------------------------------------- tours */
    def('tours.create', { w: true, roles: WRITERS }, async (ctx, p) => {
      const s = ctx.state, u = ctx.user;
      const title = cleanText(p.title, 3, 80, 'Tour name');
      const purpose = cleanMultiline(p.purpose, 0, 300, 'Purpose');
      checkRange(p.startDate, p.endDate, todayIst(), true);
      const days = cleanDays(p.days, p.startDate, p.endDate);
      // every new plan goes to the main admin for approval
      const t = {
        id: RW.uid('tr'), seq: ++s.seq.tour, userId: u.id, branchId: u.branchId, title, purpose, startDate: p.startDate, endDate: p.endDate, status: 'PLANNED', approval: 'PENDING', days,
        createdAt: nowIso(), updatedAt: nowIso(), version: 1,
      };
      s.tours.push(t);
      const sn = snapTour(t);
      await audit(ctx, { entity: 'TOUR', entityId: t.id, entityLabel: t.title, action: 'CREATE', branchId: t.branchId, new: sn });
      notify(ctx, { kind: 'TOUR_PENDING', title: 'Tour plan waiting for approval', important: true, branchId: t.branchId,
        body: u.fullName + ' sent "' + t.title + '" (' + range(t.startDate, t.endDate) + ') — ' + sn.days + ' day' + (sn.days > 1 ? 's' : '') + ', ' + sn.parties + ' part' + (sn.parties === 1 ? 'y' : 'ies') + ' to meet. Only the main admin can change or approve it.' });
      return { tour: tourView(s, t, todayIst(), []) };
    });

    /* Changing the plan: only the main admin, and only until it is approved. */
    def('tours.update', { w: true, roles: ADMIN }, async (ctx, p) => {
      const s = ctx.state, u = ctx.user;
      const t = tourById(s, p.id);
      if (!t) throw new ApiError('NOT_FOUND', 'Tour not found');
      if (t.status !== 'PLANNED') throw new ApiError('LOCKED', 'This tour is ' + t.status.toLowerCase() + '. Reopen it to change the plan.');
      if (approvalOf(t) === 'APPROVED') throw new ApiError('LOCKED', 'This tour plan is approved and final. It can no longer be changed.');
      const patch = p.patch || {};
      const old = snapTour(t);
      const title = patch.title !== undefined ? cleanText(patch.title, 3, 80, 'Tour name') : t.title;
      const purpose = patch.purpose !== undefined ? cleanMultiline(patch.purpose, 0, 300, 'Purpose') : t.purpose;
      const startDate = patch.startDate !== undefined ? patch.startDate : t.startDate;
      const endDate = patch.endDate !== undefined ? patch.endDate : t.endDate;
      checkRange(startDate, endDate, todayIst(), startDate !== t.startDate);
      const days = cleanDays(patch.days !== undefined ? patch.days : t.days, startDate, endDate);
      const mine = s.visits.filter((v) => v.tourId === t.id);
      const keep = new Set();
      for (const d of days) for (const x of d.parties) keep.add(x.id);
      for (const d of t.days) for (const x of d.parties) {
        if (!keep.has(x.id) && mine.some((v) => v.plannedPartyId === x.id)) throw new ApiError('VALIDATION', x.name + ' has a recorded meeting, so this party cannot be removed from the plan.');
      }
      const out = mine.find((v) => v.date < startDate || v.date > endDate);
      if (out) throw new ApiError('VALIDATION', 'A meeting is recorded on ' + RW.fmtDate(out.date) + ', outside these dates. Keep the dates covering every recorded meeting.');
      Object.assign(t, { title, purpose, startDate, endDate, days, updatedAt: nowIso(), version: t.version + 1 });
      await audit(ctx, { entity: 'TOUR', entityId: t.id, entityLabel: t.title, action: 'EDIT', branchId: t.branchId, old, new: snapTour(t), reason: cleanText(p.reason, 0, 300, 'Reason') });
      if (t.userId !== u.id) notify(ctx, { kind: 'TOUR_EDITED', title: 'Your tour plan was changed', body: u.fullName + ' changed your tour plan "' + t.title + '". It is still waiting for approval.', branchId: t.branchId, forAdmins: false, targetUserId: t.userId });
      return { tour: tourView(s, t, todayIst(), mine) };
    });

    /* Approving makes the plan final: from now on nobody can change it. */
    def('tours.approve', { w: true, roles: ADMIN }, async (ctx, p) => {
      const s = ctx.state, u = ctx.user;
      const t = tourById(s, p.id);
      if (!t) throw new ApiError('NOT_FOUND', 'Tour not found');
      if (t.status !== 'PLANNED') throw new ApiError('LOCKED', 'This tour is ' + t.status.toLowerCase() + ', so it cannot be approved.');
      if (approvalOf(t) === 'APPROVED') throw new ApiError('VALIDATION', 'This tour plan is already approved');
      t.approval = 'APPROVED'; t.approvedAt = nowIso(); t.approvedBy = u.id; t.updatedAt = nowIso(); t.version++;
      await audit(ctx, { entity: 'TOUR', entityId: t.id, entityLabel: t.title, action: 'APPROVE', branchId: t.branchId, old: { approval: 'PENDING' }, new: { approval: 'APPROVED' } });
      if (t.userId !== u.id) notify(ctx, { kind: 'TOUR_APPROVED', title: 'Tour plan approved', body: u.fullName + ' approved your tour plan "' + t.title + '" (' + range(t.startDate, t.endDate) + '). The plan is final now; you can record your meetings.', branchId: t.branchId, forAdmins: false, targetUserId: t.userId });
      return { tour: tourView(s, t, todayIst(), s.visits.filter((v) => v.tourId === t.id)) };
    });

    /* The person who made the tour can only cancel it (or mark it completed when it is over); reopening is the main admin's. */
    def('tours.setStatus', { w: true, roles: WRITERS }, async (ctx, p) => {
      const s = ctx.state, u = ctx.user;
      const t = tourById(s, p.id);
      if (!t || !canSeeOwned(u, t)) throw new ApiError('NOT_FOUND', 'Tour not found');
      const status = p.status;
      if (!['PLANNED', 'COMPLETED', 'CANCELLED'].includes(status)) throw new ApiError('VALIDATION', 'Choose a valid status');
      if (status === t.status) throw new ApiError('VALIDATION', 'The tour is already ' + status.toLowerCase());
      if (status === 'PLANNED') {
        if (!isSuper(u)) throw new ApiError('FORBIDDEN', 'Only the main admin can reopen a tour');
      } else {
        if (t.status !== 'PLANNED') throw new ApiError('LOCKED', 'This tour is already ' + t.status.toLowerCase() + '. Only the main admin can reopen it.');
        if (!canCloseTour(u, t)) throw new ApiError('FORBIDDEN', 'You can cancel only your own tours');
      }
      if (status === 'COMPLETED' && t.startDate > todayIst()) throw new ApiError('VALIDATION', 'This tour has not started yet');
      const reason = status === 'CANCELLED' ? cleanText(p.reason, 5, 300, 'Reason for cancelling') : cleanText(p.reason, 0, 300, 'Reason');
      const old = t.status;
      t.status = status; t.updatedAt = nowIso(); t.version++;
      t.completedAt = status === 'COMPLETED' ? nowIso() : null;
      t.cancelReason = status === 'CANCELLED' ? reason : '';
      await audit(ctx, { entity: 'TOUR', entityId: t.id, entityLabel: t.title, action: 'STATUS', branchId: t.branchId, old: { status: old }, new: { status }, reason });
      if (status === 'CANCELLED' && t.userId === u.id && !isSuper(u)) notify(ctx, { kind: 'TOUR_CANCELLED', title: 'Tour cancelled', body: u.fullName + ' cancelled "' + t.title + '" (' + range(t.startDate, t.endDate) + ') — ' + reason, branchId: t.branchId });
      return { tour: tourView(s, t, todayIst(), s.visits.filter((v) => v.tourId === t.id)) };
    });

    def('tours.delete', { w: true, roles: ADMIN }, async (ctx, p) => {
      const s = ctx.state;
      const t = tourById(s, p.id);
      if (!t) throw new ApiError('NOT_FOUND', 'Tour not found');
      const mine = s.visits.filter((v) => v.tourId === t.id);
      const reason = mine.length ? cleanText(p.reason, 5, 300, 'Reason for deleting') : cleanText(p.reason, 0, 300, 'Reason');
      const photoIds = [].concat(...mine.map((v) => v.photoIds));
      s.visits = s.visits.filter((v) => v.tourId !== t.id);
      removePhotoRecords(s, photoIds);
      s.tours = s.tours.filter((x) => x !== t);
      await audit(ctx, { entity: 'TOUR', entityId: t.id, entityLabel: t.title, action: 'DELETE', branchId: t.branchId, old: Object.assign(snapTour(t), { meetings: mine.length, photos: photoIds.length }), new: null, reason });
      await ctx.save();
      await dropPhotos(ctx, photoIds);
      return { ok: true };
    });

    def('tours.list', {}, async (ctx, p) => {
      const s = ctx.state, u = ctx.user, today = todayIst();
      const f = p.filters || {};
      const q = String(f.q || '').trim().toLowerCase();
      const by = visitsByTour(s);
      let rows = s.tours.filter((t) => canSeeOwned(u, t) && (!f.userId || t.userId === f.userId) && (!f.branchId || t.branchId === f.branchId)
        && (!f.from || t.endDate >= f.from) && (!f.to || t.startDate <= f.to));
      if (q) {
        rows = rows.filter((t) => {
          const hay = [t.title, t.purpose, (userById(s, t.userId) || {}).fullName || ''];
          for (const d of t.days) { hay.push(d.place); for (const x of d.parties) hay.push(x.name, x.address); }
          for (const v of by.get(t.id) || []) hay.push(v.partyName, v.address);
          return hay.join(' ').toLowerCase().includes(q);
        });
      }
      const views = rows.map((t) => tourView(s, t, today, by.get(t.id) || []));
      const counts = { ALL: views.length, PENDING_APPROVAL: views.filter((x) => x.awaiting).length };
      for (const ph of PHASES) counts[ph] = views.filter((x) => x.phase === ph).length;
      const shown = f.approval === 'PENDING' ? views.filter((x) => x.awaiting) : f.phase ? views.filter((x) => x.phase === f.phase) : views;
      shown.sort((a, b) => (a.startDate === b.startDate ? b.seq - a.seq : a.startDate < b.startDate ? 1 : -1));
      const pg = paging(p, shown);
      return { total: pg.total, page: pg.page, pages: pg.pages, pageSize: pg.pageSize, counts, rows: pg.slice, today, canCreate: canWrite(u), canApprove: isSuper(u) };
    });

    def('tours.get', {}, async (ctx, p) => {
      const s = ctx.state, u = ctx.user, today = todayIst();
      const t = tourById(s, p.id);
      if (!t || !canSeeOwned(u, t)) throw new ApiError('NOT_FOUND', 'Tour not found');
      const vs = s.visits.filter((v) => v.tourId === t.id).sort(visitSort);
      const metBy = new Map();
      for (const v of vs) if (v.plannedPartyId) { if (!metBy.has(v.plannedPartyId)) metBy.set(v.plannedPartyId, []); metBy.get(v.plannedPartyId).push(v.id); }
      const tour = Object.assign(tourView(s, t, today, vs), {
        days: t.days.map((d) => ({
          date: d.date, place: d.place, notes: d.notes,
          parties: d.parties.map((x) => {
            const ids = metBy.get(x.id) || [];
            return { id: x.id, name: x.name, address: x.address, phone: x.phone, purpose: x.purpose, visitIds: ids, state: ids.length ? 'MET' : d.date < today || t.status !== 'PLANNED' ? 'NOT_MET' : 'PENDING' };
          }),
        })),
      });
      return {
        tour, visits: vs.map((v) => visitView(s, ctx, v)), today,
        canEdit: canEditPlan(u, t),                                   // change the plan: main admin, until approved
        canApprove: isSuper(u) && awaiting(t),
        canClose: canCloseTour(u, t),                                 // cancel / mark completed
        canReopen: isSuper(u) && t.status !== 'PLANNED',
        canDelete: isSuper(u),
        canRecord: isOwner(u, t) && t.status !== 'CANCELLED',
        editHours: EDIT_HOURS, maxPhotos: MAX_PHOTOS,
      };
    });

    /* ---------------------------------------------------------------- visits */
    def('visits.create', { w: true, roles: WRITERS }, async (ctx, p) => {
      const s = ctx.state, u = ctx.user;
      let t = null, planned = null;
      if (p.tourId) {
        t = tourById(s, p.tourId);
        if (!t || !canSeeOwned(u, t)) throw new ApiError('NOT_FOUND', 'Tour not found');
        if (t.userId !== u.id) throw new ApiError('FORBIDDEN', 'You can record meetings only on your own tours');
        if (t.status === 'CANCELLED') throw new ApiError('LOCKED', 'This tour was cancelled. Reopen it first.');
        if (p.plannedPartyId) {
          planned = findPlannedParty(t, p.plannedPartyId);
          if (!planned) throw new ApiError('VALIDATION', 'That party is not in the tour plan');
        }
      } else if (p.plannedPartyId) throw new ApiError('VALIDATION', 'Choose a tour first');
      checkVisitDate(s, u, p.date, t);
      const f = visitFields(p);
      const photos = Array.isArray(p.photos) ? p.photos : [];
      if (photos.length > MAX_PHOTOS) throw new ApiError('VALIDATION', 'You can add up to ' + MAX_PHOTOS + ' photos to a meeting');
      const parsed = photos.map((a) => photoFrom(s, a));
      const v = Object.assign({
        id: RW.uid('vs'), seq: ++s.seq.visit, tourId: t ? t.id : null, plannedPartyId: planned ? planned.id : null, userId: u.id, branchId: u.branchId, date: p.date,
        photoIds: [], createdAt: nowIso(), updatedAt: nowIso(), version: 1,
      }, f, cleanGeo(p));
      s.visits.push(v);
      for (const a of parsed) storePhoto(ctx, v, a);
      await audit(ctx, { entity: 'VISIT', entityId: v.id, entityLabel: v.partyName + (t ? ' · ' + t.title : ''), action: 'CREATE', branchId: v.branchId, new: snapVisit(v) });
      return { visit: visitView(s, ctx, v) };
    });

    function editableVisit(ctx, id) {
      const s = ctx.state, u = ctx.user;
      const v = visitById(s, id);
      if (!v || !canSeeOwned(u, v)) throw new ApiError('NOT_FOUND', 'Meeting not found');
      if (!isSuper(u) && v.userId !== u.id) throw new ApiError('FORBIDDEN', 'You can change only your own meetings');
      if (!canEditVisit(u, v)) throw new ApiError('LOCKED', 'This meeting was recorded more than ' + EDIT_HOURS + ' hours ago and is now locked. Ask the main admin to correct it.');
      return v;
    }

    def('visits.update', { w: true, roles: WRITERS }, async (ctx, p) => {
      const s = ctx.state, u = ctx.user;
      const v = editableVisit(ctx, p.id);
      const patch = p.patch || {};
      const t = v.tourId ? tourById(s, v.tourId) : null;
      const merged = Object.assign({}, v, patch);
      const date = patch.date !== undefined ? patch.date : v.date;
      if (patch.date !== undefined) checkVisitDate(s, u, date, t);
      let plannedPartyId = v.plannedPartyId || null;
      if (patch.plannedPartyId !== undefined) {
        plannedPartyId = patch.plannedPartyId || null;
        if (plannedPartyId && !(t && findPlannedParty(t, plannedPartyId))) throw new ApiError('VALIDATION', 'That party is not in the tour plan');
      }
      const f = visitFields(merged);
      const old = snapVisit(v);
      Object.assign(v, f, { date, plannedPartyId, updatedAt: nowIso(), version: v.version + 1 });
      await audit(ctx, { entity: 'VISIT', entityId: v.id, entityLabel: v.partyName + (t ? ' · ' + t.title : ''), action: 'EDIT', branchId: v.branchId, old, new: snapVisit(v) });
      return { visit: visitView(s, ctx, v) };
    });

    def('visits.addPhoto', { w: true, roles: WRITERS }, async (ctx, p) => {
      const s = ctx.state;
      const v = editableVisit(ctx, p.id);
      if (v.photoIds.length >= MAX_PHOTOS) throw new ApiError('VALIDATION', 'A meeting can have at most ' + MAX_PHOTOS + ' photos');
      const parsed = photoFrom(s, p.photo);
      const id = storePhoto(ctx, v, parsed);
      v.updatedAt = nowIso(); v.version++;
      await audit(ctx, { entity: 'VISIT', entityId: v.id, entityLabel: v.partyName, action: 'PHOTO_ADDED', branchId: v.branchId, new: { name: parsed.name, size: parsed.size } });
      return { photo: photoMeta(s, id) };
    });

    def('visits.removePhoto', { w: true, roles: WRITERS }, async (ctx, p) => {
      const s = ctx.state;
      const v = editableVisit(ctx, p.id);
      if (!v.photoIds.includes(p.photoId)) throw new ApiError('NOT_FOUND', 'Photo not found');
      const meta = photoMeta(s, p.photoId);
      v.photoIds = v.photoIds.filter((x) => x !== p.photoId);
      removePhotoRecords(s, [p.photoId]);
      v.updatedAt = nowIso(); v.version++;
      await audit(ctx, { entity: 'VISIT', entityId: v.id, entityLabel: v.partyName, action: 'PHOTO_REMOVED', branchId: v.branchId, old: { name: meta ? meta.name : '' } });
      await ctx.save();
      await dropPhotos(ctx, [p.photoId]);
      return { ok: true };
    });

    def('visits.delete', { w: true, roles: WRITERS }, async (ctx, p) => {
      const s = ctx.state, u = ctx.user;
      const v = editableVisit(ctx, p.id);
      const others = v.userId !== u.id;
      const reason = others ? cleanText(p.reason, 5, 300, 'Reason for deleting') : cleanText(p.reason, 0, 300, 'Reason');
      const t = v.tourId ? tourById(s, v.tourId) : null;
      const photoIds = v.photoIds.slice();
      removePhotoRecords(s, photoIds);
      s.visits = s.visits.filter((x) => x !== v);
      await audit(ctx, { entity: 'VISIT', entityId: v.id, entityLabel: v.partyName + (t ? ' · ' + t.title : ''), action: 'DELETE', branchId: v.branchId, old: snapVisit(v), new: null, reason });
      await ctx.save();
      await dropPhotos(ctx, photoIds);
      return { ok: true };
    });

    def('visits.list', {}, async (ctx, p) => {
      const s = ctx.state, u = ctx.user;
      const f = p.filters || {};
      const q = String(f.q || '').trim().toLowerCase();
      let rows = s.visits.filter((v) => canSeeOwned(u, v) && (!f.userId || v.userId === f.userId) && (!f.branchId || v.branchId === f.branchId) && (!f.tourId || v.tourId === f.tourId)
        && (!f.from || v.date >= f.from) && (!f.to || v.date <= f.to));
      if (q) rows = rows.filter((v) => [v.partyName, v.address, v.phone, v.contactPerson, v.notes, (userById(s, v.userId) || {}).fullName || '', (tourById(s, v.tourId) || {}).title || ''].join(' ').toLowerCase().includes(q));
      rows.sort((a, b) => (a.date === b.date ? b.seq - a.seq : a.date < b.date ? 1 : -1));
      const pg = paging(p, rows);
      return { total: pg.total, page: pg.page, pages: pg.pages, pageSize: pg.pageSize, rows: pg.slice.map((v) => visitView(s, ctx, v)), canCreate: canWrite(u), photos: rows.reduce((n, v) => n + v.photoIds.length, 0) };
    });

    /* A small summary used by the dashboards: who is on tour today, how many meetings in a period. */
    H.tourSummary = function (s, u, from, to) {
      const today = todayIst();
      const by = visitsByTour(s);
      const onTour = [], upcoming = [];
      for (const t of s.tours) {
        if (!canSeeOwned(u, t) || t.status !== 'PLANNED') continue;
        const ph = phaseOf(t, today);
        const day = t.days.find((d) => d.date === today) || null;
        const tv = tourView(s, t, today, by.get(t.id) || []);
        if (ph === 'ONGOING') onTour.push({ id: t.id, title: t.title, userName: tv.userName, branchCode: tv.branchCode, branchName: tv.branchName, startDate: t.startDate, endDate: t.endDate, todayPlace: day ? day.place : '', todayParties: day ? day.parties.length : 0, visitCount: tv.visitCount, plannedParties: tv.plannedParties, metPlanned: tv.metPlanned });
        else if (ph === 'UPCOMING' && RW.diffDays(t.startDate, today) <= 14) upcoming.push({ id: t.id, title: t.title, userName: tv.userName, branchCode: tv.branchCode, startDate: t.startDate, endDate: t.endDate, places: tv.places.slice(0, 3).join(', ') });
      }
      upcoming.sort((a, b) => (a.startDate < b.startDate ? -1 : 1));
      const pending = s.tours.filter((t) => canSeeOwned(u, t) && awaiting(t)).sort((a, b) => (a.startDate < b.startDate ? -1 : 1)).map((t) => tourView(s, t, today, by.get(t.id) || []));
      const vs = s.visits.filter((v) => canSeeOwned(u, v) && (!from || v.date >= from) && (!to || v.date <= to));
      return { onTour, upcoming: upcoming.slice(0, 8), pendingApproval: pending.length, pending: pending.slice(0, 5).map((x) => ({ id: x.id, title: x.title, userName: x.userName, branchCode: x.branchCode, startDate: x.startDate, endDate: x.endDate })), meetings: vs.length, photos: vs.reduce((n, v) => n + v.photoIds.length, 0), parties: new Set(vs.map((v) => v.partyName.toLowerCase())).size };
    };
  });
})(typeof window !== 'undefined' ? window : globalThis);
