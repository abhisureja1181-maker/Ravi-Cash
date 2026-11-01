/* Ravi Cash — LIVE MAP (main admin and CEO only).
 *
 * Where every User / Branch Admin is right now, what they are doing (on tour, meetings, vouchers), the route they took on
 * a day, and the exact place of every tour meeting. Refreshes by itself every 30 seconds.
 * The same screen is also reached from a tour (#/live-map?user=…&date=…). */
(function (g) {
  'use strict';
  const RW = (g.RW = g.RW || {});
  const UI = RW.ui, V = RW.v, M = RW.map;
  const { h } = UI;

  const ST = { LIVE: ['Live now', 'green'], RECENT: ['Recent', 'blue'], OFFLINE: ['Offline', 'gray'], OFF: ['Location off', 'red'], NEVER: ['Not shared yet', 'gray'] };
  const plural = (n, w) => n + ' ' + w + (n === 1 ? '' : 's');
  const initials = (n) => String(n || '?').split(/\s+/).filter(Boolean).slice(0, 2).map((x) => x[0].toUpperCase()).join('');
  function ago(sec) {
    if (sec < 45) return 'just now';
    const m = Math.round(sec / 60);
    if (m < 60) return plural(m, 'minute') + ' ago';
    const hr = Math.floor(m / 60);
    if (hr < 24) return hr + ' h ' + (m % 60 ? (m % 60) + ' min ' : '') + 'ago';
    return plural(Math.floor(hr / 24), 'day') + ' ago';
  }
  const money = (p) => RW.fmtINR(p);
  const WHY = { OFF: 'Location was off', DENIED: 'Location was blocked on the phone', UNAVAILABLE: 'The phone could not find its location', NONE: 'No location was recorded' };

  RW.route('/live-map', async function (root, p, app) {
    app.title('Live Map');
    const today = app.today;
    let dead = false, data = null, sel = p.q.user || '', day = RW.isValidDate(p.q.date) ? p.q.date : today, chipKey = '', branch = '', search = '';
    let showMeet = true, trail = null, meetings = [], timer = null;
    let map = null, staffLayer = null, meetLayer = null, routeLayer = null;
    const staffMarkers = new Map(), meetMarkers = new Map();

    const dayIn = V.dateInput(day, { max: today });
    const branchSel = UI.select([{ value: '', label: 'All branches' }], '');
    const qIn = h('input', { type: 'search', placeholder: 'Name, branch, tour, party…' });
    V.branchOptions(app).then((o) => { const cur = branchSel.value; branchSel.innerHTML = ''; o.forEach((x) => branchSel.appendChild(h('option', { value: x.value }, x.label))); branchSel.value = cur; });
    const meetChip = h('button', { class: 'chip active', type: 'button', onclick: () => { showMeet = !showMeet; meetChip.classList.toggle('active', showMeet); drawMeetings(false); } }, UI.icon('pin', 13), ' Meeting pins');
    const chipsHost = h('div', { class: 'chips' });
    const listHost = h('div', { class: 'lm-list' }), detailHost = h('div', { class: 'lm-detail' });
    const mapHost = h('div', { class: 'lm-map' });
    const banner = h('div');

    root.appendChild(V.pageHead('Live Map', 'Where your staff are right now and what they are doing. Updates every 30 seconds.', null));
    root.appendChild(banner);
    root.appendChild(h('div', { class: 'bar-filters' }, UI.field('Day', dayIn), UI.field('Branch', branchSel), UI.field('Search', qIn, { class: 'wide' }), h('div', { class: 'field', style: { width: 'auto' } }, h('label', null, ' '), meetChip)));
    root.appendChild(h('div', { style: { marginBottom: '12px' } }, chipsHost));
    root.appendChild(h('div', { class: 'lm-grid' }, h('div', { class: 'lm-mapwrap card' }, mapHost), h('div', { class: 'lm-side' }, detailHost, listHost)));

    map = M.create(mapHost, {});
    if (map) {
      staffLayer = g.L.layerGroup().addTo(map); meetLayer = g.L.layerGroup().addTo(map); routeLayer = g.L.layerGroup().addTo(map);
      map.on('click', () => { if (sel) select(''); });
    }

    /* ------------------------------------------------------------- filtering */
    const staffList = () => (data ? data.staff : []);
    function visible(s) {
      if (chipKey === 'TOUR' && !s.activity.tour) return false;
      if (chipKey && chipKey !== 'TOUR' && s.status !== chipKey) return false;
      const q = search.trim().toLowerCase();
      if (q) {
        const hay = [s.name, s.designation, s.branchName, s.activity.tour ? s.activity.tour.title + ' ' + s.activity.tour.place : '', s.activity.lastMeeting ? s.activity.lastMeeting.party : ''].join(' ').toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    }
    function drawChips() {
      const c = data ? data.counts : { total: 0, live: 0, recent: 0, offline: 0, off: 0, never: 0, onTour: 0 };
      const chip = (key, label, n) => h('button', { class: 'chip' + (chipKey === key ? ' active' : ''), type: 'button', onclick: () => { chipKey = key; drawChips(); drawList(); drawStaff(false); } }, label + ' (' + n + ')');
      UI.mount(chipsHost, chip('', 'All', c.total), chip('LIVE', 'Live now', c.live), chip('TOUR', 'On tour', c.onTour), chip('RECENT', 'Recent', c.recent), chip('OFFLINE', 'Offline', c.offline), chip('OFF', 'Location off', c.off), c.never ? chip('NEVER', 'Not shared yet', c.never) : null);
    }

    /* ----------------------------------------------------------- activity text */
    function doing(s) {
      const a = s.activity, bits = [];
      if (a.tour) bits.push('On tour: ' + a.tour.title + (a.tour.place ? ' · ' + a.tour.place : '') + ' (day ' + a.tour.dayNo + ' of ' + a.tour.days + ')');
      if (a.meetings) bits.push(plural(a.meetings, 'meeting') + ' today' + (a.lastMeeting ? ' · last: ' + a.lastMeeting.party + ' at ' + a.lastMeeting.time : ''));
      if (a.vouchers) bits.push(plural(a.vouchers, 'voucher') + ' entered today' + (a.lastVoucher ? ' · last: ' + a.lastVoucher.number + ' ' + money(a.lastVoucher.amountPaise) : ''));
      if (!bits.length) bits.push(s.lastActiveAt ? 'No work entered today · last active ' + RW.fmtDateTime(s.lastActiveAt) : 'No activity yet');
      return bits;
    }
    function statusText(s) {
      if (s.status === 'LIVE' || s.status === 'RECENT') return (s.status === 'LIVE' ? 'Live' : 'Recent') + ' · updated ' + ago(s.pos.ageSec) + (s.blocked ? ' · now blocked' : '');
      if (s.status === 'OFFLINE') return 'Offline · last seen ' + ago(s.pos.ageSec);
      if (s.status === 'OFF') return s.consent === 'DECLINED' ? 'Location off — chose not to share' : 'Location off — blocked on the phone' + (s.pos ? ' · last seen ' + ago(s.pos.ageSec) : '');
      return 'Has not shared a location yet';
    }

    /* ----------------------------------------------------------------- list */
    function row(s) {
      const [lab, tone] = ST[s.status];
      return h('button', { class: 'lm-row' + (sel === s.id ? ' sel' : ''), type: 'button', onclick: () => select(s.id) },
        h('span', { class: 'lm-av st-' + s.status }, initials(s.name)),
        h('span', { class: 'lm-t' }, h('b', null, s.name), h('small', null, [s.designation, V.branchShort(s)].filter(Boolean).join(' · ')),
          h('small', { class: 'lm-st st-' + s.status }, statusText(s)), h('small', { class: 'lm-do' }, doing(s)[0])),
        UI.badge(lab, tone));
    }
    function drawList() {
      const rows = staffList().filter(visible);
      UI.mount(listHost, rows.length ? rows.map(row) : h('div', { class: 'card' }, UI.empty('Nobody to show', data && !data.enabled ? 'Location sharing is switched off in Settings.' : 'No staff match these filters.', 'users')));
    }

    /* --------------------------------------------------------------- markers */
    function staffPopup(s) {
      const [lab, tone] = ST[s.status];
      return h('div', { class: 'lm-pop' }, h('b', null, s.name), h('div', { class: 'muted' }, [s.designation, s.branchName].filter(Boolean).join(' · ')), h('div', null, UI.badge(lab, tone)),
        h('div', { class: 'lm-pop-s' }, statusText(s)), h('div', { class: 'lm-pop-l' }, doing(s)[0]),
        h('div', { class: 'lm-pop-a', style: { display: 'flex', gap: '8px', flexWrap: 'wrap' } },
          sel === s.id ? null : h('button', { class: 'btn btn-primary btn-sm', type: 'button', onclick: () => select(s.id) }, UI.icon('route', 14), 'Route & meetings'),
          s.pos ? h('a', { class: 'btn btn-ghost btn-sm', href: M.gmaps(s.pos.lat, s.pos.lng), target: '_blank', rel: 'noopener' }, UI.icon('pin', 14), 'Google Maps') : null));
    }
    function drawStaff(fit) {
      if (!map) return;
      staffLayer.clearLayers(); staffMarkers.clear();
      const pts = [];
      for (const s of staffList()) {
        if (!s.pos || !visible(s)) continue;
        const mk = g.L.marker([s.pos.lat, s.pos.lng], { icon: M.staffIcon(s.name, s.status, sel === s.id), zIndexOffset: sel === s.id ? 1000 : s.status === 'LIVE' ? 500 : 0, title: s.name }).addTo(staffLayer);
        mk.bindPopup(() => staffPopup(s), { minWidth: 220, maxWidth: 280 });
        mk.on('click', () => { sel = s.id; drawList(); drawDetail(); loadDay(false); });
        if (s.pos.acc > 80 && s.pos.acc < 5000) g.L.circle([s.pos.lat, s.pos.lng], { radius: s.pos.acc, color: '#1F5FB5', weight: 1, opacity: 0.4, fillOpacity: 0.06, interactive: false }).addTo(staffLayer);
        staffMarkers.set(s.id, mk); pts.push([s.pos.lat, s.pos.lng]);
      }
      if (fit && !sel) M.fit(map, pts, { maxZoom: 13 });
    }

    function meetPopup(m) {
      return h('div', { class: 'lm-pop' }, h('b', null, m.partyName), h('div', { class: 'muted' }, [m.time || RW.fmtTime(m.recordedAt), RW.fmtDate(m.date), m.userName, m.branchCode ? V.branchShort(m) : ''].filter(Boolean).join(' · ')),
        h('div', null, m.planned ? UI.badge('In the tour plan', 'green') : UI.badge('Extra meeting', 'amber'), m.geo && m.geo.stale ? UI.badge('Location taken earlier', 'amber') : null),
        m.address ? h('div', { class: 'lm-pop-l' }, m.address) : null, m.tourTitle ? h('div', { class: 'lm-pop-l' }, 'Tour: ', h('a', { class: 'link', href: '#/tours/' + m.tourId }, m.tourTitle)) : h('div', { class: 'lm-pop-l muted' }, 'Not part of a tour'),
        m.photoCount ? h('div', { class: 'lm-pop-l muted' }, plural(m.photoCount, 'photo')) : null,
        h('div', { class: 'lm-pop-l muted' }, 'Recorded from ±' + (m.geo ? m.geo.acc : 0) + ' m accuracy'),
        m.geo ? h('div', { class: 'lm-pop-a' }, h('a', { class: 'btn btn-ghost btn-sm', href: M.gdir(m.geo.lat, m.geo.lng), target: '_blank', rel: 'noopener' }, 'Directions')) : null);
    }
    function drawMeetings(fit) {
      if (!map) return;
      meetLayer.clearLayers(); meetMarkers.clear();
      if (!showMeet) return;
      const n = new Map(), pts = [];
      for (const m of meetings) {
        const k = (n.get(m.userId) || 0) + 1; n.set(m.userId, k);
        if (!m.geo) continue;
        const mk = g.L.marker([m.geo.lat, m.geo.lng], { icon: M.meetIcon(k, m.geo.stale ? 'late' : m.planned ? 'plan' : 'ok'), zIndexOffset: 200, title: m.partyName }).addTo(meetLayer);
        mk.bindPopup(() => meetPopup(m), { minWidth: 230, maxWidth: 290 });
        meetMarkers.set(m.id, mk); pts.push([m.geo.lat, m.geo.lng]);
      }
      if (fit && pts.length) M.fit(map, pts, { maxZoom: 15 });
    }
    function drawRoute(fit) {
      if (!map) return;
      routeLayer.clearLayers();
      if (!trail || !trail.points.length) return;
      const pts = trail.points.map((x) => [x.lat, x.lng]);
      g.L.polyline(pts, { color: '#D9530A', weight: 4, opacity: 0.85, lineJoin: 'round' }).addTo(routeLayer);
      g.L.marker(pts[0], { icon: M.dot('start'), interactive: true, title: 'Start ' + RW.fmtTime(trail.points[0].t) }).bindTooltip('Start · ' + RW.fmtTime(trail.points[0].t)).addTo(routeLayer);
      if (pts.length > 1) g.L.marker(pts[pts.length - 1], { icon: M.dot('end'), title: 'Last point' }).bindTooltip('Last point · ' + RW.fmtTime(trail.points[trail.points.length - 1].t)).addTo(routeLayer);
      if (fit) { const all = pts.concat(meetings.filter((m) => m.geo).map((m) => [m.geo.lat, m.geo.lng])); M.fit(map, all, { maxZoom: 15 }); }
    }

    /* ---------------------------------------------------------------- detail */
    function drawDetail() {
      const s = staffList().find((x) => x.id === sel);
      if (!s) return UI.mount(detailHost, h('div', { class: 'lm-hint' }, UI.icon('pin', 16), h('span', null, 'Tap a person to see their route and meetings for the day.')));
      const [lab, tone] = ST[s.status];
      const isToday = day === today;
      const ms = meetings.filter((m) => m.userId === s.id);
      let i = 0;
      UI.mount(detailHost, h('div', { class: 'card lm-card' },
        h('div', { class: 'lm-card-h' }, h('span', { class: 'lm-av st-' + s.status }, initials(s.name)), h('div', { class: 'lm-t' }, h('b', null, s.name), h('small', null, [s.designation, s.branchName].filter(Boolean).join(' · '))),
          h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Close', onclick: () => select('') }, UI.icon('x', 16))),
        h('div', { class: 'lm-card-b' },
          h('div', null, UI.badge(lab, tone), ' ', h('span', { class: 'muted' }, statusText(s))),
          s.pos ? h('div', { class: 'lm-kv' }, UI.icon('pin', 14), h('span', null, 'Accuracy about ±' + s.pos.acc + ' m · ', h('a', { class: 'link', href: M.gmaps(s.pos.lat, s.pos.lng), target: '_blank', rel: 'noopener' }, 'Open in Google Maps'))) : null,
          h('div', { class: 'sec-lbl' }, 'Today'),
          doing(s).map((x) => h('div', { class: 'lm-kv' }, UI.icon('info', 14), h('span', null, x))),
          s.activity.tour ? h('a', { class: 'btn btn-ghost btn-sm', href: '#/tours/' + s.activity.tour.id, style: { alignSelf: 'flex-start' } }, UI.icon('map', 14), 'Open tour') : null,
          h('div', { class: 'sec-lbl' }, isToday ? 'Route and meetings today' : 'Route and meetings on ' + RW.fmtDate(day)),
          trail ? (trail.points.length ? h('div', { class: 'lm-kv' }, UI.icon('route', 14), h('span', null, 'About ' + trail.km + ' km travelled · ' + plural(trail.points.length, 'point') + ' · ' + RW.fmtTime(trail.points[0].t) + ' to ' + RW.fmtTime(trail.points[trail.points.length - 1].t)))
            : h('div', { class: 'lm-kv muted' }, UI.icon('info', 14), h('span', null, 'No route was recorded for this day (routes are kept for ' + trail.keepDays + ' days).'))) : h('div', { class: 'muted' }, 'Loading…'),
          ms.length ? h('div', { class: 'lm-meets' }, ms.map((m) => {
            const k = ++i;
            return h('button', { class: 'lm-meet', type: 'button', onclick: () => focusMeeting(m) },
              h('span', { class: 'lm-n ' + (m.geo ? '' : 'none') }, String(k)),
              h('span', { class: 'lm-t' }, h('b', null, m.partyName), h('small', null, [m.time || RW.fmtTime(m.recordedAt), m.tourTitle || 'No tour', m.planned ? 'in plan' : 'extra'].join(' · ')),
                m.geo ? h('small', { class: 'ok' }, 'Place saved (±' + m.geo.acc + ' m)' + (m.geo.stale ? ' · taken earlier' : '')) : h('small', { class: 'bad' }, WHY[m.geoStatus] || WHY.NONE)));
          })) : (trail ? h('div', { class: 'lm-kv muted' }, UI.icon('pin', 14), h('span', null, 'No meetings recorded.')) : null))));
    }
    function focusMeeting(m) {
      if (!m.geo || !map) return;
      map.flyTo([m.geo.lat, m.geo.lng], Math.max(map.getZoom(), 16), { duration: 0.6 });
      const mk = meetMarkers.get(m.id); if (mk) setTimeout(() => mk.openPopup(), 650);
    }

    /* ------------------------------------------------------------------ data */
    async function loadDay(fit) {
      try {
        const f = { date: day }; if (branch) f.branchId = branch; if (sel) f.userId = sel;
        const [mr, tr] = await Promise.all([RW.api.call('location.meetings', { filters: f }), sel ? RW.api.call('location.trail', { userId: sel, date: day }) : Promise.resolve(null)]);
        if (dead) return;
        meetings = mr.rows; trail = tr;
        drawMeetings(fit && !sel); drawRoute(fit); drawDetail(); drawList();
      } catch (e) { if (!dead) UI.toast(UI.errMsg(e), 'error'); }
    }
    async function loadLive(fit) {
      try {
        data = await RW.api.call('location.live', { filters: branch ? { branchId: branch } : {} });
        if (dead) return;
        if (sel && !data.staff.some((x) => x.id === sel)) sel = '';
        UI.mount(banner, data.enabled ? null : h('div', { class: 'callout warn', style: { marginBottom: '12px' } }, UI.icon('alert', 16), h('span', null, h('b', null, 'Location sharing is switched off. '), 'Staff are not sending their location. Switch it on in Settings → Live location.')));
        drawChips(); drawList(); drawStaff(fit); drawDetail();
      } catch (e) { if (!dead) UI.mount(listHost, V.errorCard(e, () => loadLive(true))); }
    }
    function select(id) {
      sel = id; trail = null;
      drawList(); drawDetail(); drawStaff(false);
      if (!id) { routeLayer && routeLayer.clearLayers(); loadDay(false); return; }
      const s = staffList().find((x) => x.id === id), mk = staffMarkers.get(id);
      if (map && mk) { map.flyTo([s.pos.lat, s.pos.lng], Math.max(map.getZoom(), 14), { duration: 0.6 }); setTimeout(() => mk.openPopup(), 650); }
      loadDay(true);
    }

    dayIn.addEventListener('change', () => { if (RW.isValidDate(dayIn.value) && dayIn.value <= today) { day = dayIn.value; loadDay(true); } else dayIn.value = day; });
    branchSel.addEventListener('change', () => { branch = branchSel.value; loadLive(true); loadDay(false); });
    qIn.addEventListener('input', UI.debounce(() => { search = qIn.value; drawList(); drawStaff(false); }, 200));

    drawChips(); drawDetail();
    await loadLive(true);
    if (sel) select(sel); else loadDay(true);
    timer = setInterval(() => { if (dead) return; loadLive(false); if (day === today) loadDay(false); }, 30000);
    app.live(() => { loadLive(false); loadDay(false); });
    return { dispose() { dead = true; if (timer) clearInterval(timer); if (map) { try { map.remove(); } catch (e) { /* gone */ } } } };
  }, { roles: ['SUPER_ADMIN', 'CEO'] });
})(typeof window !== 'undefined' ? window : globalThis);
