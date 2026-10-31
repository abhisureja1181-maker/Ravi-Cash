/* Ravi Cash — LIVE LOCATION (GPS).
 *
 *  Staff (User and Branch Admin) share their phone's location with the company while they are signed in and the app is
 *  open. Only the main admin and the CEO can see it: a live map of where everybody is and what they are doing, the route
 *  of the day, and the exact place of every tour meeting (the location is saved with the meeting when it is recorded).
 *
 *  Privacy rules built in
 *    - the person is asked once (a clear notice) and the browser asks for its own permission; both can be declined, and
 *      the admin then sees "location off" instead of a position;
 *    - tracking can be switched off for the whole company in Settings, and a person's own phone shows that it is on;
 *    - the position is kept only for a limited time (30 days by default) and is erased with the user / branch / system;
 *    - nothing is shared with Branch Admins, Viewers or colleagues — the server never sends location to them.
 *
 *  Pings are NOT stored in the main database: that would rewrite the whole book every minute for every phone and wake
 *  every open screen. The latest position of each person lives in the storage key `loc`, the route of each day in
 *  `trail:YYYY-MM-DD`.
 */
(function (g) {
  'use strict';
  const RW = (g.RW = g.RW || {});
  RW.serverModules = RW.serverModules || [];

  RW.serverModules.push(function (H) {
    const { ApiError, def, userById, branchById, nowIso, todayIst, audit } = H;
    const TRACKED = ['USER', 'BRANCH_ADMIN'];      // whose location is shared
    const VIEWERS = ['SUPER_ADMIN', 'CEO'];        // who may see it
    const LIVE_MS = 3 * 60000, RECENT_MS = 30 * 60000;
    const MIN_PING_MS = 10000;                     // one position per person per 10 s at the most
    const STEP_M = 75, STEP_MS = 10 * 60000;       // a point goes on the day's route after 75 m of movement or 10 minutes
    const MAX_POINTS = 1500;                       // per person per day
    const ZONE_MS = 5.5 * 3600000;                 // IST
    H.LOCATION_TRACKED = TRACKED;

    /* ------------------------------------------------------------- helpers */
    let chain = Promise.resolve();                 // one storage read-modify-write at a time
    const serial = (fn) => { const run = chain.then(fn); chain = run.catch(() => {}); return run; };
    const num = (v) => (v === '' || v === null || v === undefined ? NaN : Number(v));
    const r6 = (x) => Math.round(x * 1e6) / 1e6;
    const istDay = (ms) => RW.istDate(ms);
    function metres(a, b) {                        // haversine
      const R = 6371000, rad = Math.PI / 180;
      const dLat = (b[0] - a[0]) * rad, dLng = (b[1] - a[1]) * rad;
      const x = Math.sin(dLat / 2) ** 2 + Math.cos(a[0] * rad) * Math.cos(b[0] * rad) * Math.sin(dLng / 2) ** 2;
      return 2 * R * Math.asin(Math.min(1, Math.sqrt(x)));
    }
    const settingsOf = (s) => ({
      enabled: s.settings.locationTracking !== false,
      keepDays: Math.min(90, Math.max(7, parseInt(s.settings.locationKeepDays, 10) || 30)),
    });
    const emptyLoc = () => ({ users: {} });
    const readLoc = async () => (await H.storage.get('loc')) || emptyLoc();
    const trailKey = (day) => 'trail:' + day;

    /* A position coming from a phone: numbers in range, otherwise reject. Never trust the device clock. */
    function cleanFix(p) {
      const lat = num(p.lat), lng = num(p.lng);
      if (!(lat >= -90 && lat <= 90) || !(lng >= -180 && lng <= 180)) throw new ApiError('VALIDATION', 'Invalid location');
      if (Math.abs(lat) < 0.0001 && Math.abs(lng) < 0.0001) throw new ApiError('VALIDATION', 'Invalid location');
      let acc = num(p.acc);
      acc = acc >= 0 && acc < 1e6 ? Math.round(acc) : 0;
      return { lat: r6(lat), lng: r6(lng), acc };
    }
    H.cleanFix = cleanFix;

    /* ------------------------------------------------------- phone → server */
    def('location.config', { roles: TRACKED }, async (ctx) => {
      const doc = await readLoc(), rec = doc.users[ctx.user.id] || {};
      const c = settingsOf(ctx.state);
      return { enabled: c.enabled, keepDays: c.keepDays, intervalSec: 60, consent: rec.consent || null, consentAt: rec.consentAt || null, perm: rec.perm || null };
    });

    /* The person answered the notice or the browser answered the permission question. Rare, so it goes in the audit trail. */
    const REPORTS = { CONSENT_GIVEN: 'Location sharing allowed', CONSENT_DECLINED: 'Location sharing declined', DENIED: 'Location blocked in the phone settings', UNAVAILABLE: 'Location not available on this phone', GRANTED: 'Location permission granted' };
    def('location.report', { w: true, roles: TRACKED }, async (ctx, p) => {
      const state = String(p.state || '');
      if (!REPORTS[state]) throw new ApiError('VALIDATION', 'Unknown location state');
      const u = ctx.user, at = nowIso();
      const changed = await serial(async () => {
        const doc = await readLoc();
        const rec = doc.users[u.id] || (doc.users[u.id] = {});
        let was;
        if (state === 'CONSENT_GIVEN' || state === 'CONSENT_DECLINED') { was = rec.consent; rec.consent = state === 'CONSENT_GIVEN' ? 'GIVEN' : 'DECLINED'; rec.consentAt = at; if (state === 'CONSENT_GIVEN') delete rec.demoAgeMin; }
        else { was = rec.perm; rec.perm = state === 'GRANTED' ? 'GRANTED' : state; rec.permAt = at; }
        await H.storage.set('loc', doc);
        return was !== (state === 'CONSENT_GIVEN' ? 'GIVEN' : state === 'CONSENT_DECLINED' ? 'DECLINED' : state);
      });
      if (!changed || state === 'GRANTED') { ctx.dirty = false; return { ok: true }; }
      await audit(ctx, { entity: 'LOCATION', entityId: u.id, entityLabel: u.fullName, action: 'STATUS', branchId: u.branchId, new: { location: REPORTS[state] } });
      return { ok: true };
    });

    def('location.ping', { roles: TRACKED }, async (ctx, p) => {
      const c = settingsOf(ctx.state);
      if (!c.enabled) return { ok: true, enabled: false };
      const u = ctx.user, fix = cleanFix(p), nowMs = H.clock();
      const devAt = num(p.at);
      return serial(async () => {
        const doc = await readLoc();
        const rec = doc.users[u.id] || (doc.users[u.id] = {});
        if (rec.consent === 'DECLINED') return { ok: true, off: true };          // the person said no: nothing is stored
        // the phone only pings after the person pressed "Allow"; if that answer got lost on the way (weak network), the first ping carries it
        if (!rec.consent && (p.consent === 1 || p.consent === true || p.consent === '1')) { rec.consent = 'GIVEN'; rec.consentAt = new Date(nowMs).toISOString(); }
        if (rec.at && nowMs - Date.parse(rec.at) < MIN_PING_MS) return { ok: true, throttled: true };
        Object.assign(rec, fix, { at: new Date(nowMs).toISOString(), devAt: devAt > 0 && Math.abs(devAt - nowMs) < 864e5 ? new Date(devAt).toISOString() : null, perm: 'GRANTED' });
        delete rec.demoAgeMin;
        await H.storage.set('loc', doc);
        // the day's route: only when the person moved or a while has passed (and the fix is good enough to draw)
        if (fix.acc <= 1000) {
          const day = istDay(nowMs), key = trailKey(day);
          const isNewDay = (await H.storage.keys(key)).indexOf(key) < 0;
          const tr = (await H.storage.get(key)) || {};
          const list = tr[u.id] || (tr[u.id] = []);
          const last = list[list.length - 1];
          if (!last || metres([last[1], last[2]], [fix.lat, fix.lng]) >= STEP_M || nowMs - last[0] >= STEP_MS) {
            if (list.length >= MAX_POINTS) list.shift();
            list.push([nowMs, fix.lat, fix.lng, fix.acc]);
            await H.storage.set(key, tr);
          }
          if (isNewDay) await purgeOld(c.keepDays, nowMs);
        }
        return { ok: true };
      });
    });

    async function purgeOld(keepDays, nowMs) {
      const oldest = istDay(nowMs - keepDays * 864e5);
      for (const k of await H.storage.keys('trail:')) if (String(k).slice(6) < oldest) { try { await H.storage.del(k); } catch (e) { /* gone */ } }
    }

    /* "Reset", user and branch erase take the location data along. ids = a Set of user ids, or null for everybody. */
    H.purgeLocations = (ids) => serial(async () => {
      if (!ids) {
        try { await H.storage.del('loc'); } catch (e) { /* none */ }
        for (const k of await H.storage.keys('trail:')) { try { await H.storage.del(k); } catch (e) { /* gone */ } }
        return;
      }
      const doc = await H.storage.get('loc');
      if (doc) { for (const id of ids) delete doc.users[id]; await H.storage.set('loc', doc); }
      for (const k of await H.storage.keys('trail:')) {
        const tr = await H.storage.get(k);
        if (!tr) continue;
        let ch = false;
        for (const id of ids) if (tr[id]) { delete tr[id]; ch = true; }
        if (ch) await H.storage.set(k, tr);
      }
    });

    /* A restored backup brings its own locations and day-wise routes back: `map` = { loc: {...}, 'trail:YYYY-MM-DD': {...} }. */
    H.replaceLocations = (map) => serial(async () => {
      try { await H.storage.del('loc'); } catch (e) { /* none */ }
      for (const k of await H.storage.keys('trail:')) { try { await H.storage.del(k); } catch (e) { /* gone */ } }
      for (const k of Object.keys(map)) await H.storage.set(k, map[k]);
    });

    /* ------------------------------------------------------ admin / CEO views */
    function activityOf(s, u, today, vToday) {
      const tour = s.tours.find((t) => t.userId === u.id && t.status === 'PLANNED' && t.startDate <= today && today <= t.endDate) || null;
      let tourInfo = null;
      if (tour) {
        const day = tour.days.find((d) => d.date === today);
        tourInfo = { id: tour.id, title: tour.title, place: day ? day.place : '', dayNo: RW.diffDays(today, tour.startDate) + 1, days: RW.diffDays(tour.endDate, tour.startDate) + 1 };
      }
      const ms = s.visits.filter((v) => v.userId === u.id && v.date === today).sort((a, b) => (a.createdAt < b.createdAt ? -1 : 1));
      const lm = ms[ms.length - 1] || null;
      const lv = vToday.get(u.id) || null;
      return {
        tour: tourInfo,
        meetings: ms.length, meetingsWithLocation: ms.filter((v) => v.geo).length,
        lastMeeting: lm ? { id: lm.id, tourId: lm.tourId || null, party: lm.partyName, time: lm.time || RW.fmtTime(lm.createdAt), at: lm.createdAt, hasLocation: !!lm.geo } : null,
        vouchers: lv ? lv.n : 0,
        lastVoucher: lv ? { id: lv.last.id, number: lv.last.number || 'Cash Received', label: H.vlabel(lv.last), amountPaise: lv.last.amountPaise, at: lv.last.createdAt } : null,
      };
    }

    def('location.live', { roles: VIEWERS }, async (ctx, p) => {
      const s = ctx.state, nowMs = H.clock(), today = istDay(nowMs);
      const c = settingsOf(s);
      const doc = await readLoc();
      const f = (p && p.filters) || {};
      // one pass over the vouchers for "what did each person enter today"
      const vToday = new Map();
      for (let i = s.vouchers.length - 1; i >= 0; i--) {
        const v = s.vouchers[i];
        if (v.status === 'DELETED' || !v.createdAt) continue;
        if (istDay(Date.parse(v.createdAt)) !== today) continue;
        const e = vToday.get(v.userId);
        if (!e) vToday.set(v.userId, { n: 1, last: v }); else { e.n++; if (v.createdAt > e.last.createdAt) e.last = v; }
      }
      const staff = [];
      for (const u of s.users) {
        if (u.deleted || u.status !== 'ACTIVE' || !TRACKED.includes(u.role)) continue;
        if (f.branchId && u.branchId !== f.branchId) continue;
        const rec = doc.users[u.id] || {};
        const b = branchById(s, u.branchId);
        // demo data carries "minutes ago" so the demo map always looks alive (a real ping replaces it)
        const at = rec.demoAgeMin !== undefined ? nowMs - rec.demoAgeMin * 60000 : rec.at ? Date.parse(rec.at) : null;
        const age = at === null ? null : Math.max(0, nowMs - at);
        const blocked = rec.perm === 'DENIED' || rec.perm === 'UNAVAILABLE' || rec.consent === 'DECLINED';
        // "turned off" / "blocked" counts at once, even when the last position is only a minute old
        const offSince = rec.consent === 'DECLINED' ? rec.consentAt : rec.perm === 'DENIED' || rec.perm === 'UNAVAILABLE' ? rec.permAt : null;
        const justOff = blocked && !!offSince && (at === null || Date.parse(offSince) >= at);
        const status = justOff ? 'OFF' : age !== null && age <= LIVE_MS ? 'LIVE' : age !== null && age <= RECENT_MS ? 'RECENT' : blocked ? 'OFF' : age !== null ? 'OFFLINE' : 'NEVER';
        staff.push({
          id: u.id, name: u.fullName, role: u.role, designation: u.designation || '', branchId: u.branchId, branchName: b ? b.name : '', branchCode: b ? b.code : '',
          status, blocked, consent: rec.consent || null, perm: rec.perm || null,
          pos: at !== null && rec.lat !== undefined ? { lat: rec.lat, lng: rec.lng, acc: rec.acc || 0, at: new Date(at).toISOString(), ageSec: Math.round(age / 1000) } : null,
          activity: activityOf(s, u, today, vToday), lastActiveAt: u.lastActivityAt || null,
        });
      }
      const rank = { LIVE: 0, RECENT: 1, OFF: 2, OFFLINE: 3, NEVER: 4 };
      staff.sort((a, b) => rank[a.status] - rank[b.status] || a.name.localeCompare(b.name));
      const counts = { total: staff.length, live: 0, recent: 0, offline: 0, off: 0, never: 0, onTour: staff.filter((x) => x.activity.tour).length };
      for (const x of staff) counts[x.status.toLowerCase()]++;
      return { enabled: c.enabled, keepDays: c.keepDays, today, now: new Date(nowMs).toISOString(), staff, counts };
    });

    function meetingRow(s, v) {
      const u = userById(s, v.userId), b = branchById(s, v.branchId), t = v.tourId ? s.tours.find((x) => x.id === v.tourId) : null;
      return {
        id: v.id, seq: v.seq, date: v.date, time: v.time || '', recordedAt: v.createdAt, partyName: v.partyName, address: v.address, phone: v.phone || '', contactPerson: v.contactPerson || '',
        userId: v.userId, userName: u ? u.fullName : 'Unknown', branchCode: b ? b.code : '', tourId: v.tourId || null, tourTitle: t ? t.title : '',
        planned: !!v.plannedPartyId, photoCount: v.photoIds.length,
        geo: v.geo ? { lat: v.geo.lat, lng: v.geo.lng, acc: v.geo.acc || 0, at: v.geo.at, stale: !!v.geo.at && Date.parse(v.createdAt) - Date.parse(v.geo.at) > 10 * 60000 } : null,
        geoStatus: v.geo ? 'OK' : v.geoStatus || 'NONE',
      };
    }

    /* The route a person took on one day, with the meetings recorded that day. */
    def('location.trail', { roles: VIEWERS }, async (ctx, p) => {
      const s = ctx.state;
      const u = userById(s, p.userId);
      if (!u || !TRACKED.includes(u.role)) throw new ApiError('NOT_FOUND', 'Person not found');
      const date = p.date || todayIst();
      if (!RW.isValidDate(date)) throw new ApiError('VALIDATION', 'Choose a valid date');
      const tr = (await H.storage.get(trailKey(date))) || {};
      const pts = (tr[u.id] || []).map((x) => ({ t: new Date(x[0]).toISOString(), lat: x[1], lng: x[2], acc: x[3] }));
      let m = 0;
      for (let i = 1; i < pts.length; i++) m += metres([pts[i - 1].lat, pts[i - 1].lng], [pts[i].lat, pts[i].lng]);
      const meetings = s.visits.filter((v) => v.userId === u.id && v.date === date).sort((a, b) => (a.createdAt < b.createdAt ? -1 : 1)).map((v) => meetingRow(s, v));
      return { userId: u.id, name: u.fullName, date, points: pts, km: Math.round(m / 100) / 10, meetings, keepDays: settingsOf(s).keepDays };
    });

    /* Every meeting in a date range with the place it was recorded from (for the map layer and the tour page). */
    def('location.meetings', { roles: VIEWERS }, async (ctx, p) => {
      const s = ctx.state, f = (p && p.filters) || {};
      const date = f.date || (f.from ? null : todayIst());
      let rows = s.visits.filter((v) => (!date || v.date === date) && (!f.from || v.date >= f.from) && (!f.to || v.date <= f.to)
        && (!f.userId || v.userId === f.userId) && (!f.branchId || v.branchId === f.branchId) && (!f.tourId || v.tourId === f.tourId));
      rows.sort((a, b) => (a.date === b.date ? (a.createdAt < b.createdAt ? -1 : 1) : a.date < b.date ? -1 : 1));
      const total = rows.length;
      rows = rows.slice(0, 500).map((v) => meetingRow(s, v));
      return { total, withLocation: rows.filter((x) => x.geo).length, rows };
    });
  });
})(typeof window !== 'undefined' ? window : globalThis);
