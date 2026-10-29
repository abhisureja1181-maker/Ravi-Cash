/* Ravi Cash — TOURS: advance tour plan (day by day: places and parties to meet) and tour details
 * (the meetings that really happened: party, address, phone, notes and photos). */
(function (g) {
  'use strict';
  const RW = (g.RW = g.RW || {});
  const UI = RW.ui, V = RW.v;
  const { h } = UI;

  /* ------------------------------------------------------------------ helpers */
  const WD = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const fmtDay = (d) => WD[RW.dow(d)] + ', ' + RW.fmtDate(d);
  const range = (a, b) => (a === b ? RW.fmtDate(a) : RW.fmtDateShort(a) + ' – ' + RW.fmtDate(b));
  const plural = (n, w, w2) => n + ' ' + (n === 1 ? w : w2 || w + 's');
  const PHASE = { UPCOMING: ['Upcoming', 'blue'], ONGOING: ['On tour', 'orange'], ENDED: ['Dates over', 'amber'], COMPLETED: ['Completed', 'green'], CANCELLED: ['Cancelled', 'gray'] };
  const phaseBadge = (ph) => UI.badge(PHASE[ph][0], PHASE[ph][1]);
  const waitBadge = () => UI.badge('Awaiting approval', 'amber');
  const approvedOn = (t) => (t.approvedAt ? RW.fmtDate(RW.istDate ? RW.istDate(t.approvedAt) : t.approvedAt.slice(0, 10)) : '');
  const STATE = { MET: ['Met', 'green', 'check'], PENDING: ['To meet', 'blue', 'clock'], NOT_MET: ['Not met', 'amber', 'alert'] };
  const telHref = (p) => 'tel:' + String(p).replace(/[^\d+]/g, '');
  const phoneLink = (p) => (p ? h('a', { class: 'tl-phone', href: telHref(p), onclick: (e) => e.stopPropagation() }, UI.icon('phone', 13), p) : null);
  const nowHm = () => { const d = new Date(); return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0'); };
  const tourBrief = (t) => ({ id: t.id, title: t.title, startDate: t.startDate, endDate: t.endDate });
  const reasonBox = (label, ph) => { const t = h('textarea', { rows: 2, maxlength: 300, placeholder: ph || 'Reason (saved in the audit log)' }); return { t, f: UI.field(label || 'Reason', t) }; };

  /* ------------------------------------------------------------------ photos */
  const photoCache = new Map();
  function photoData(id) {
    if (!photoCache.has(id)) {
      if (photoCache.size > 40) photoCache.delete(photoCache.keys().next().value);
      const p = RW.api.call('attachments.get', { id });
      p.catch(() => photoCache.delete(id));
      photoCache.set(id, p);
    }
    return photoCache.get(id);
  }
  const io = 'IntersectionObserver' in g ? new IntersectionObserver((es) => es.forEach((e) => { if (e.isIntersecting) { io.unobserve(e.target); e.target._load && e.target._load(); } }), { rootMargin: '160px' }) : null;
  async function openPhoto(p, title) {
    try {
      const f = await photoData(p.id);
      UI.modal({ title: title || p.name, size: 'lg', body: h('img', { src: f.dataUrl, alt: p.name, style: { width: '100%', borderRadius: '8px', background: '#fff' } }),
        actions: [{ label: 'Close' }, { label: 'Download', kind: 'primary', icon: 'download', keepOpen: true, onClick: () => { UI.download(RW.dataUrlBytes(f.dataUrl), p.name, f.mime); return false; } }] });
    } catch (e) { UI.toast(UI.errMsg(e), 'error'); }
  }
  function photoThumb(p, title, onRemove) {
    const t = h('div', { class: 'att', tabindex: 0, role: 'button', 'aria-label': 'Open photo', onclick: () => openPhoto(p, title), onkeydown: (e) => { if (e.key === 'Enter') openPhoto(p, title); } },
      UI.icon('image', 24),
      onRemove ? h('button', { class: 'att-x', type: 'button', 'aria-label': 'Remove photo', onclick: (e) => { e.stopPropagation(); onRemove(); } }, UI.icon('x', 14)) : null);
    t._load = async () => { try { const f = await photoData(p.id); t.insertBefore(h('img', { src: f.dataUrl, alt: p.name, loading: 'lazy' }), t.firstChild); const ic = t.querySelector('.ico'); if (ic) ic.remove(); } catch (e) { /* keep the placeholder */ } };
    if (io) io.observe(t); else t._load();
    return t;
  }

  /* ------------------------------------------------------------- meeting card */
  function meetingCard(v, o) {
    o = o || {};
    const app = RW.app;
    const acts = v.canEdit && app.canCreate ? h('span', { class: 'meet-acts' },
      h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Edit meeting', title: 'Edit', onclick: (e) => { e.stopPropagation(); V.meetingDialog({ visit: v, tour: o.tour || null, onDone: o.onChange }); } }, UI.icon('edit', 16)),
      h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Delete meeting', title: 'Delete', style: { color: 'var(--bad)' }, onclick: (e) => { e.stopPropagation(); deleteMeeting(v, o.onChange); } }, UI.icon('trash', 16))) : null;
    const who = [o.showUser ? v.userName : '', o.showUser ? V.branchShort(v) : '', o.showTour && v.tourTitle ? v.tourTitle : '', 'recorded ' + RW.fmtDateTime(v.createdAt)].filter(Boolean).join(' · ');
    return h('div', { class: 'meet' + (o.click ? ' click' : ''), onclick: o.click ? () => o.click(v) : null },
      h('div', { class: 'meet-h' }, h('div', { class: 'meet-t' }, h('b', null, v.partyName), v.time ? h('span', { class: 'meet-time' }, v.time) : null, o.showDate ? h('span', { class: 'meet-time' }, RW.fmtDate(v.date)) : null), acts),
      h('div', { class: 'meet-l' }, UI.icon('pin', 14), h('span', null, v.address)),
      v.phone || v.contactPerson ? h('div', { class: 'meet-l' }, v.phone ? phoneLink(v.phone) : null, v.contactPerson ? h('span', { class: 'muted' }, 'Met ' + v.contactPerson) : null) : null,
      v.notes ? h('p', { class: 'meet-n' }, v.notes) : null,
      v.photos.length ? h('div', { class: 'thumbs' }, v.photos.map((p) => photoThumb(p, v.partyName))) : null,
      placeLine(v),
      h('small', { class: 'meet-f' }, who));
  }
  /* where the meeting was recorded from — visible to the main admin and the CEO only (the server sends it to nobody else) */
  const PLACE_WHY = { OFF: 'Location was off', DENIED: 'Location was blocked on the phone', UNAVAILABLE: 'The phone could not find its location', NONE: 'No place was recorded' };
  function placeLine(v) {
    if (!('geoStatus' in v)) return null;
    if (!v.geo) return h('div', { class: 'meet-l', style: { color: 'var(--bad)' } }, UI.icon('pin', 14), h('span', null, PLACE_WHY[v.geoStatus] || PLACE_WHY.NONE));
    return h('div', { class: 'meet-l' }, UI.icon('pin', 14), h('span', null, 'Recorded from here (±' + v.geo.acc + ' m)' + (v.geo.stale ? ' · position taken earlier' : '') + ' · '),
      h('a', { class: 'link', href: '#', onclick: (e) => { e.preventDefault(); e.stopPropagation(); RW.map.dialog({ title: v.partyName, sub: [v.userName, RW.fmtDate(v.date) + (v.time ? ' ' + v.time : '')].join(' · '), lat: v.geo.lat, lng: v.geo.lng, acc: v.geo.acc }); } }, 'View on map'));
  }
  async function deleteMeeting(v, done) {
    const own = v.userId === RW.app.user.id;
    const r = reasonBox(own ? 'Reason' : 'Reason (required)', 'Why is this meeting being deleted?');
    UI.modal({ title: 'Delete meeting', size: 'sm', body: h('div', { class: 'stack', style: { gap: '12px' } }, h('p', null, 'Delete the meeting with ', h('b', null, v.partyName), ' and its ' + plural(v.photoCount, 'photo') + '? This cannot be undone.'), r.f),
      actions: [{ label: 'Keep it' }, { label: 'Delete', kind: 'danger', keepOpen: true, onClick: async (m) => { await RW.api.call('visits.delete', { id: v.id, reason: r.t.value }); UI.toast('Meeting deleted.', 'success'); m.close(); done && done(); } }] });
  }

  /* ------------------------------------------------------------ meeting dialog */
  /* Record (or correct) a meeting. o = { tour:{id,title,startDate,endDate}, plannedPartyId, visit, onDone } */
  V.meetingDialog = async function (o) {
    o = o || {};
    const app = RW.app, today = app.today, editing = o.visit || null, v = editing || {};
    const st = { tour: o.tour || null, own: [], plan: null, photos: [], existing: editing ? editing.photos.slice() : [], removed: [] };
    const maxPhotos = 4;
    const planCache = {};
    const loadPlan = async (id) => (planCache[id] = planCache[id] || RW.api.call('tours.get', { id }));

    if (editing && editing.tourId && !st.tour) { try { const d = await loadPlan(editing.tourId); st.tour = tourBrief(d.tour); } catch (e) { /* the meeting can still be edited */ } }
    if (!st.tour && !editing) {
      try {
        const r = await RW.api.call('tours.list', { filters: { userId: app.user.id }, pageSize: 100 });
        st.own = r.rows.filter((t) => t.phase === 'ONGOING' || t.phase === 'ENDED' || t.phase === 'COMPLETED').sort((a, b) => (a.phase === 'ONGOING' ? -1 : 0) - (b.phase === 'ONGOING' ? -1 : 0));
      } catch (e) { st.own = []; }
    }

    /* fields */
    const dlId = 'dl_' + Math.random().toString(36).slice(2, 8);
    const dl = h('datalist', { id: dlId });
    const tourSel = !editing && !o.tour ? UI.select([{ value: '', label: 'No tour — a single visit' }].concat(st.own.map((t) => ({ value: t.id, label: t.title + ' (' + range(t.startDate, t.endDate) + ')' }))), (st.own.find((t) => t.phase === 'ONGOING') || {}).id || '') : null;
    const planSel = h('select', null);
    const date = V.dateInput(v.date || (st.tour ? (today < st.tour.startDate ? st.tour.startDate : today > st.tour.endDate ? st.tour.endDate : today) : today));
    const time = h('input', { type: 'time', value: v.time !== undefined ? v.time : nowHm() });
    const name = h('input', { type: 'text', maxlength: 100, list: dlId, autocomplete: 'off', placeholder: 'Party / shop / company name', value: v.partyName || '' });
    const address = h('textarea', { rows: 2, maxlength: 250, placeholder: 'Shop no., street, area, city' }); address.value = v.address || '';
    const phone = h('input', { type: 'tel', inputmode: 'tel', maxlength: 24, autocomplete: 'off', placeholder: 'Mobile or landline number', value: v.phone || '' });
    const contact = h('input', { type: 'text', maxlength: 100, placeholder: 'Person you met', value: v.contactPerson || '' });
    const notes = h('textarea', { rows: 3, maxlength: 1000, placeholder: 'What was discussed — order, payment promised, next follow-up…' }); notes.value = v.notes || '';
    const fTour = tourSel ? UI.field('Tour', tourSel, { optional: true }) : null;
    const fPlan = UI.field('Party from the tour plan', planSel, { optional: true, hint: 'Pick a planned party to fill the details, or leave it for a party that was not in the plan.' });
    fPlan.hidden = true;
    const fDate = UI.field('Date', date), fTime = UI.field('Time', time, { optional: true });
    const fName = UI.field('Party name', name), fAddr = UI.field('Address', address), fPhone = UI.field('Phone number', phone, { optional: true });
    const fContact = UI.field('Contact person', contact, { optional: true }), fNotes = UI.field('Notes', notes, { optional: true });

    /* parties met before: suggestions + auto-fill */
    const known = new Map();
    RW.api.call('visits.list', { filters: { userId: app.user.id }, pageSize: 100 }).then((r) => {
      for (const x of r.rows) { const k = x.partyName.toLowerCase(); if (!known.has(k)) known.set(k, x); }
      UI.mount(dl, [...known.values()].map((x) => h('option', { value: x.partyName })));
    }).catch(() => {});
    name.addEventListener('change', () => {
      const k = known.get(name.value.trim().toLowerCase());
      if (!k) return;
      if (!address.value.trim()) address.value = k.address;
      if (!phone.value.trim()) phone.value = k.phone;
      if (!contact.value.trim()) contact.value = k.contactPerson;
    });

    /* the date window follows the tour */
    const applyWindow = () => {
      date.max = st.tour && st.tour.endDate < today ? st.tour.endDate : today;
      if (st.tour) date.min = st.tour.startDate; else date.removeAttribute('min');
      if (date.value > date.max) date.value = date.max;
      if (st.tour && date.value < st.tour.startDate) date.value = st.tour.startDate;
    };
    const fillPlan = (d, keep) => {
      st.plan = d;
      planSel.innerHTML = '';
      planSel.appendChild(h('option', { value: '' }, 'Not in the plan — an extra meeting'));
      let n = 0;
      if (d) for (const day of d.tour.days) for (const p of day.parties) { n++; planSel.appendChild(h('option', { value: p.id }, RW.fmtDateShort(day.date) + ' · ' + p.name + (p.state === 'MET' ? '  ✓ met' : ''))); }
      planSel.value = keep || '';
      fPlan.hidden = !n;
    };
    const pickPlanned = () => {
      const id = planSel.value;
      if (!id || !st.plan) return;
      for (const day of st.plan.tour.days) {
        const p = day.parties.find((x) => x.id === id);
        if (p) { name.value = p.name; address.value = p.address || address.value; phone.value = p.phone || phone.value; if (day.date <= today && (!st.tour || (day.date >= st.tour.startDate && day.date <= st.tour.endDate))) date.value = day.date; return; }
      }
    };
    planSel.addEventListener('change', pickPlanned);
    const useTour = async (t) => {
      st.tour = t;
      applyWindow();
      if (!t) return fillPlan(null);
      try { fillPlan(await loadPlan(t.id), (editing && editing.plannedPartyId) || o.plannedPartyId || ''); if (o.plannedPartyId && !editing) pickPlanned(); } catch (e) { fillPlan(null); }
    };
    if (tourSel) tourSel.addEventListener('change', () => { const t = st.own.find((x) => x.id === tourSel.value); useTour(t ? tourBrief(t) : null); });
    applyWindow();
    if (st.tour) useTour(st.tour); else if (tourSel && tourSel.value) useTour(tourBrief(st.own.find((x) => x.id === tourSel.value)));

    /* photos */
    const photoHost = h('div'), photoInfo = h('small', { class: 'muted' });
    const total = () => st.existing.length + st.photos.length;
    function drawPhotos() {
      UI.mount(photoHost, total() ? h('div', { class: 'att-grid' },
        st.existing.map((p, i) => photoThumb(p, name.value || 'Meeting photo', () => { st.removed.push(p.id); st.existing.splice(i, 1); drawPhotos(); })),
        st.photos.map((a, i) => h('div', { class: 'att', onclick: () => UI.modal({ title: a.name, size: 'lg', body: h('img', { src: a.dataUrl, alt: a.name, style: { width: '100%', borderRadius: '8px' } }), actions: [{ label: 'Close' }] }) },
          h('img', { src: a.dataUrl, alt: a.name }), h('button', { class: 'att-x', type: 'button', 'aria-label': 'Remove photo', onclick: (e) => { e.stopPropagation(); st.photos.splice(i, 1); drawPhotos(); } }, UI.icon('x', 14)), h('span', { class: 'att-n' }, Math.round(a.size / 1024) + ' KB')))) : null);
      photoInfo.textContent = total() ? total() + ' of ' + maxPhotos + ' photos · compressed automatically' : 'Take a photo of the shop, the party or the order. Up to ' + maxPhotos + ' photos.';
    }
    const takePhoto = async () => {
      if (total() >= maxPhotos) return UI.toast('You can add up to ' + maxPhotos + ' photos.', 'warn');
      const a = await RW.img.camera({ title: 'Take photo of the meeting', hint: 'Photograph the shop board, the party or the order. Hold the phone steady.', prefix: 'meeting', alt: 'Meeting photo' });
      if (a) { st.photos.push(a); drawPhotos(); }
    };
    const fileIn = h('input', { type: 'file', accept: 'image/*', multiple: true, hidden: true, onchange: async () => {
      for (const f of Array.from(fileIn.files)) {
        if (total() >= maxPhotos) { UI.toast('You can add up to ' + maxPhotos + ' photos.', 'warn'); break; }
        try { st.photos.push(await RW.img.fromFile(f)); } catch (e) { UI.toast(UI.errMsg(e), 'error'); }
      }
      fileIn.value = ''; drawPhotos();
    } });
    drawPhotos();

    /* where the meeting is being recorded: the phone's position is saved with it (the main admin and the CEO see it on the map) */
    const locHost = !editing ? h('div') : null;
    let cap = null;
    const LOCWHY = { OFF: 'Location is off, so this meeting will be saved without a place.', DENIED: 'Location is blocked on this phone, so this meeting will be saved without a place.', UNAVAILABLE: 'Your location could not be found, so this meeting will be saved without a place.' };
    function drawLoc() {
      if (!locHost) return;
      if (cap === null) return UI.mount(locHost, h('div', { class: 'loc-row' }, UI.icon('pin', 16), h('span', null, 'Finding your location…')));
      if (cap.geo) return UI.mount(locHost, h('div', { class: 'loc-row ok' }, UI.icon('pin', 16), h('span', null, 'The place is saved with this meeting (accuracy about ±' + cap.geo.acc + ' m).')));
      UI.mount(locHost, h('div', { class: 'loc-row warn' }, UI.icon('alert', 16), h('span', null, LOCWHY[cap.geoStatus] || LOCWHY.UNAVAILABLE),
        h('button', { class: 'btn btn-ghost btn-sm', type: 'button', onclick: async () => { if (RW.tracker && cap.geoStatus !== 'UNAVAILABLE') await RW.tracker.enable(); getPlace(); } }, cap.geoStatus === 'UNAVAILABLE' ? 'Try again' : 'Turn on')));
    }
    async function getPlace() {
      if (!locHost) return;
      cap = null; drawLoc();
      cap = RW.tracker ? await RW.tracker.capture() : { geoStatus: 'UNAVAILABLE' };
      drawLoc();
    }
    getPlace();

    /* validate + save */
    function validate() {
      let ok = true, first = null;
      const need = (f, cond, msg) => { UI.fieldError(f, cond ? '' : msg); if (!cond) { ok = false; first = first || f; } };
      need(fName, name.value.trim().length >= 2, 'Enter the party name');
      need(fAddr, address.value.trim().length >= 2, 'Enter the party address');
      need(fPhone, !phone.value.trim() || (/^\+?[0-9 ()-]{6,24}$/.test(phone.value.trim()) && phone.value.replace(/\D/g, '').length >= 7 && phone.value.replace(/\D/g, '').length <= 15), 'Enter a valid phone number (7 to 15 digits)');
      need(fDate, /^\d{4}-\d{2}-\d{2}$/.test(date.value) && date.value <= today, 'Choose a valid date (not in the future)');
      if (st.tour && /^\d{4}-\d{2}-\d{2}$/.test(date.value)) need(fDate, date.value >= st.tour.startDate && date.value <= st.tour.endDate, 'The date must be within the tour (' + range(st.tour.startDate, st.tour.endDate) + ')');
      if (first) first.scrollIntoView({ block: 'center', behavior: 'smooth' });
      return ok;
    }
    const body = h('div', { class: 'stack', style: { gap: '14px' } },
      st.tour ? h('div', { class: 'callout info' }, UI.icon('map', 16), h('span', null, h('b', null, st.tour.title), ' · ' + range(st.tour.startDate, st.tour.endDate))) : null,
      locHost,
      fTour, fPlan,
      h('div', { class: 'form-grid' }, fDate, fTime),
      fName, dl, fAddr,
      h('div', { class: 'form-grid' }, fPhone, fContact),
      fNotes,
      h('div', { class: 'field' }, h('label', null, 'Photos', h('i', null, ' (optional)')), h('div', { class: 'photo-btns' },
        h('button', { class: 'btn btn-ghost photo-btn', type: 'button', onclick: takePhoto }, UI.icon('camera', 20), 'Take Photo'),
        h('button', { class: 'btn btn-ghost photo-btn', type: 'button', onclick: () => fileIn.click() }, UI.icon('image', 20), 'Choose from Gallery')), fileIn, photoHost, photoInfo));
    UI.modal({ title: editing ? 'Edit meeting' : 'Record meeting', size: 'md', persistent: true, body,
      actions: [{ label: 'Cancel' }, { label: editing ? 'Save changes' : 'Save meeting', kind: 'primary', keepOpen: true, onClick: async (m) => {
        if (!validate()) return false;
        const f = { date: date.value, time: time.value, partyName: name.value, address: address.value, phone: phone.value, contactPerson: contact.value, notes: notes.value, plannedPartyId: planSel.value || null };
        if (!editing) {
          // a position older than 3 minutes is renewed, so the place is where the meeting is saved from
          if (!cap || (cap.geo && Date.now() - cap.geo.at > 180000)) { cap = RW.tracker ? await RW.tracker.capture() : { geoStatus: 'UNAVAILABLE' }; drawLoc(); }
          const place = cap.geo ? { geo: { lat: cap.geo.lat, lng: cap.geo.lng, acc: cap.geo.acc, at: cap.geo.at } } : { geoStatus: cap.geoStatus || 'UNAVAILABLE' };
          await RW.api.call('visits.create', Object.assign(f, place, { tourId: st.tour ? st.tour.id : null, photos: st.photos.map((a) => ({ name: a.name, mime: a.mime, dataUrl: a.dataUrl })) }));
        } else {
          await RW.api.call('visits.update', { id: editing.id, patch: f });
          for (const id of st.removed) await RW.api.call('visits.removePhoto', { id: editing.id, photoId: id });
          for (const a of st.photos) await RW.api.call('visits.addPhoto', { id: editing.id, photo: { name: a.name, mime: a.mime, dataUrl: a.dataUrl } });
        }
        UI.toast('Meeting saved.', 'success'); m.close(); o.onDone && o.onDone();
      } }] });
  };

  /* ================================================================= list page */
  RW.route('/tours', async function (root, p, app) {
    app.title('Tours');
    let dead = false, tab = p.q.tab === 'details' ? 'details' : 'plans', page = 1, phase = p.q.approval ? 'PENDING_APPROVAL' : '';
    const mgmt = app.mgmt;
    const tabs = UI.segmented([{ value: 'plans', label: 'Tour Plans', icon: 'map' }, { value: 'details', label: 'Tour Details', icon: 'pin' }], tab, (v) => { tab = v; page = 1; phase = ''; draw(); });
    const newBtn = app.canCreate ? h('a', { class: 'btn btn-primary', href: '#/tours/new' }, UI.icon('plus', 16), 'New Tour Plan') : null;
    const recBtn = app.canCreate ? h('button', { class: 'btn btn-accent', type: 'button', onclick: () => V.meetingDialog({ onDone: load }) }, UI.icon('camera', 16), 'Record Meeting') : null;
    root.appendChild(V.pageHead('Tours', app.role === 'USER' ? 'Plan your tours in advance and record every party you meet.' : app.seesAll ? 'Tour plans and meetings of every branch.' : 'Tour plans and meetings of your branch.', [newBtn, recBtn]));
    root.appendChild(h('div', { style: { marginBottom: '14px' } }, tabs));
    const filterHost = h('div'), listHost = h('div', null, V.loading(5));
    root.appendChild(filterHost); root.appendChild(listHost);

    const q = h('input', { type: 'search', placeholder: 'Tour, place, party, address…' });
    const from = V.dateInput(''), to = V.dateInput('');
    const branchSel = UI.select([{ value: '', label: 'All branches' }], ''), userSel = UI.select([{ value: '', label: 'All people' }], '');
    if (app.seesAll) V.branchOptions(app).then((o) => { const cur = branchSel.value; branchSel.innerHTML = ''; o.forEach((x) => branchSel.appendChild(h('option', { value: x.value }, x.label))); branchSel.value = cur; });
    if (mgmt) RW.api.call('users.list', { filters: {} }).then((r) => { userSel.innerHTML = ''; userSel.appendChild(h('option', { value: '' }, 'All people')); r.rows.filter((u) => u.registerId || u.role === 'BRANCH_ADMIN' || u.role === 'SUPER_ADMIN').forEach((u) => userSel.appendChild(h('option', { value: u.id }, u.fullName + ' · ' + V.branchShort(u)))); }).catch(() => {});
    const reload = UI.debounce(() => { page = 1; load(); }, 300);
    q.addEventListener('input', reload);
    [from, to, branchSel, userSel].forEach((i) => i.addEventListener('change', () => { page = 1; load(); }));
    const phaseHost = h('div', { class: 'chips', style: { marginBottom: '14px' } });

    function draw() {
      UI.mount(filterHost, h('div', { class: 'bar-filters' }, UI.field('Search', q, { class: 'wide' }), app.seesAll ? UI.field('Branch', branchSel) : null, mgmt ? UI.field('Person', userSel) : null,
        UI.field(tab === 'plans' ? 'Tour from' : 'Meetings from', from), UI.field('To', to)), tab === 'plans' ? phaseHost : null);
      load();
    }
    const filters = () => ({ q: q.value.trim() || undefined, from: from.value || undefined, to: to.value || undefined, branchId: branchSel.value || undefined, userId: userSel.value || undefined });

    function tourCard(t) {
      const pct = t.plannedParties ? Math.round((t.metPlanned / t.plannedParties) * 100) : 0;
      return h('a', { class: 'tour-card', href: '#/tours/' + t.id },
        h('div', { class: 'tc-h' }, h('div', { class: 'tc-t' }, h('b', null, t.title), mgmt ? h('small', null, t.userName + ' · ' + V.branchShort(t)) : null), h('span', { class: 'tc-badges' }, phaseBadge(t.phase), t.awaiting ? waitBadge() : null)),
        h('div', { class: 'tc-d' }, UI.icon('calendar', 14), range(t.startDate, t.endDate), h('span', { class: 'muted' }, ' · ' + plural(t.dayCount, 'day'))),
        h('div', { class: 'tc-p' }, UI.icon('pin', 14), h('span', null, t.places.length ? t.places.slice(0, 4).join(', ') + (t.places.length > 4 ? ' +' + (t.places.length - 4) + ' more' : '') : '—')),
        h('div', { class: 'tc-f' },
          h('span', null, t.plannedParties ? h('b', null, t.metPlanned + ' / ' + t.plannedParties) : h('b', null, '0'), ' planned parties met'),
          h('span', null, h('b', null, String(t.visitCount)), ' meeting' + (t.visitCount === 1 ? '' : 's') + (t.photoCount ? ' · ' + plural(t.photoCount, 'photo') : ''))),
        t.plannedParties ? h('div', { class: 'tc-bar', 'aria-hidden': 'true' }, h('i', { style: { width: pct + '%' } })) : null);
    }

    async function load() {
      try {
        if (tab === 'plans') {
          const r = await RW.api.call('tours.list', { filters: Object.assign(filters(), phase === 'PENDING_APPROVAL' ? { approval: 'PENDING' } : { phase: phase || undefined }), page, pageSize: 12 });
          if (dead) return;
          const chip = (key, label, n) => h('button', { class: 'chip' + (phase === key ? ' active' : ''), type: 'button', onclick: () => { phase = key; page = 1; load(); } }, label + ' (' + n + ')');
          UI.mount(phaseHost, chip('', 'All', r.counts.ALL), r.counts.PENDING_APPROVAL || phase === 'PENDING_APPROVAL' ? chip('PENDING_APPROVAL', 'Awaiting approval', r.counts.PENDING_APPROVAL) : null, ['ONGOING', 'UPCOMING', 'ENDED', 'COMPLETED', 'CANCELLED'].map((k) => chip(k, PHASE[k][0], r.counts[k])));
          UI.mount(listHost, r.rows.length ? [h('div', { class: 'tour-grid' }, r.rows.map(tourCard)), UI.pager(r, (n) => { page = n; load(); })]
            : h('div', { class: 'card' }, UI.empty('No tour plans', app.canCreate ? 'Plan your next tour day by day — places to visit and parties to meet.' : 'No tour plans match these filters.', 'map',
              app.canCreate ? h('a', { class: 'btn btn-primary btn-sm', href: '#/tours/new', style: { marginTop: '14px' } }, UI.icon('plus', 14), 'New Tour Plan') : null)));
        } else {
          const r = await RW.api.call('visits.list', { filters: filters(), page, pageSize: 15 });
          if (dead) return;
          UI.mount(listHost, r.rows.length ? [h('div', { class: 'meet-list' }, r.rows.map((v) => meetingCard(v, { showUser: mgmt, showTour: true, showDate: true, onChange: load}))), UI.pager(r, (n) => { page = n; load(); })]
            : h('div', { class: 'card' }, UI.empty('No meetings recorded', app.canCreate ? 'Record the parties you meet during a tour — name, address, phone and a photo.' : 'No meetings match these filters.', 'pin',
              app.canCreate ? h('button', { class: 'btn btn-accent btn-sm', type: 'button', style: { marginTop: '14px' }, onclick: () => V.meetingDialog({ onDone: load }) }, UI.icon('camera', 14), 'Record Meeting') : null)));
        }
      } catch (e) { if (!dead) UI.mount(listHost, V.errorCard(e, load)); }
    }
    draw(); app.live(load);
    return { dispose() { dead = true; } };
  }, { });

  /* ================================================================ plan form */
  const PLAN_ROLES = ['USER', 'BRANCH_ADMIN', 'SUPER_ADMIN'];
  async function planPage(root, p, app, editId) {
    app.title(editId ? 'Edit Tour Plan' : 'New Tour Plan');
    const back = { href: editId ? '#/tours/' + editId : '#/tours', label: editId ? 'Tour' : 'Tours' };
    const host = h('div', null, V.loading(8));
    root.appendChild(host);
    let ex = null;
    if (editId) {
      try { ex = await RW.api.call('tours.get', { id: editId }); } catch (e) {
        UI.mount(host, V.pageHead('Tour not found', null, null, { href: '#/tours', label: 'Tours' }), h('div', { class: 'card' }, UI.empty('This tour could not be found', 'It may not exist, or it belongs to someone else.', 'search')));
        return;
      }
      if (!ex.canEdit) {
        const final = ex.tour.status === 'PLANNED' && ex.tour.approval === 'APPROVED';
        UI.mount(host, V.pageHead(ex.tour.title, null, null, back), h('div', { class: 'card' }, UI.empty(final ? 'This plan is approved and final' : ex.tour.status !== 'PLANNED' ? 'This tour is ' + ex.tour.phase.toLowerCase() : 'You cannot change this plan',
          final ? 'An approved tour plan cannot be changed by anyone. The tour can only be cancelled.' : 'Only the main admin can change a tour plan, and only until it is approved.', 'lock', h('a', { class: 'btn btn-primary btn-sm', href: '#/tours/' + editId, style: { marginTop: '14px' } }, 'Back to the tour'))));
        return;
      }
    }
    const t0 = app.today, tomorrow = RW.addDays(t0, 1);
    const st = {
      title: ex ? ex.tour.title : '', purpose: ex ? ex.tour.purpose : '', start: ex ? ex.tour.startDate : tomorrow, end: ex ? ex.tour.endDate : RW.addDays(tomorrow, 1),
      days: new Map(),
    };
    if (ex) for (const d of ex.tour.days) st.days.set(d.date, { place: d.place, notes: d.notes, skip: false, parties: d.parties.map((x) => ({ id: x.id, name: x.name, address: x.address, phone: x.phone, purpose: x.purpose, met: x.state === 'MET' })) });
    const dayOf = (date) => { let d = st.days.get(date); if (!d) st.days.set(date, d = { place: '', notes: '', skip: false, parties: [] }); return d; };
    const dates = () => { const a = []; for (let d = st.start; d <= st.end && a.length < 60; d = RW.addDays(d, 1)) a.push(d); return a; };

    /* suggestions from the parties met before */
    const known = new Map();
    const dlId = 'dl_' + Math.random().toString(36).slice(2, 8), dl = h('datalist', { id: dlId });
    RW.api.call('visits.list', { filters: { userId: app.user.id }, pageSize: 100 }).then((r) => {
      for (const x of r.rows) { const k = x.partyName.toLowerCase(); if (!known.has(k)) known.set(k, x); }
      UI.mount(dl, [...known.values()].map((x) => h('option', { value: x.partyName })));
    }).catch(() => {});

    /* top fields */
    const title = h('input', { type: 'text', maxlength: 80, placeholder: 'e.g. Gujarat dealer tour', value: st.title, oninput: () => { st.title = title.value; } });
    const purpose = h('textarea', { rows: 2, maxlength: 300, placeholder: 'What is this tour for? e.g. collect payments, new dealers, product demo' }); purpose.value = st.purpose; purpose.addEventListener('input', () => { st.purpose = purpose.value; });
    const start = V.dateInput(st.start), end = V.dateInput(st.end);
    const fTitle = UI.field('Tour name', title), fPurpose = UI.field('Purpose', purpose, { optional: true }), fStart = UI.field('From date', start), fEnd = UI.field('To date', end);
    const daysHost = h('div', { class: 'stack', style: { gap: '14px' } });
    const bar = h('span', { class: 'tb-sum' });

    const onDates = () => {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(start.value)) return;
      if (!/^\d{4}-\d{2}-\d{2}$/.test(end.value) || end.value < start.value) end.value = start.value;
      if (RW.diffDays(end.value, start.value) + 1 > 60) { end.value = RW.addDays(start.value, 59); UI.toast('A tour can last at most 60 days.', 'warn'); }
      end.min = start.value;
      st.start = start.value; st.end = end.value;
      renderDays();
    };
    start.addEventListener('change', onDates); end.addEventListener('change', onDates);
    end.min = st.start;

    function refreshBar() {
      const ds = dates().filter((d) => !dayOf(d).skip);
      const np = ds.reduce((n, d) => n + dayOf(d).parties.length, 0);
      bar.textContent = plural(ds.length, 'day') + ' · ' + plural(np, 'party', 'parties') + ' to meet';
    }

    function partyRow(d, pr, partiesHost, redraw) {
      const nm = h('input', { type: 'text', maxlength: 100, list: dlId, autocomplete: 'off', placeholder: 'Party / shop / company name', value: pr.name, oninput: () => { pr.name = nm.value; refreshBar(); } });
      const ph = h('input', { type: 'tel', inputmode: 'tel', maxlength: 24, placeholder: 'Phone number', value: pr.phone, oninput: () => { pr.phone = ph.value; } });
      const ad = h('input', { type: 'text', maxlength: 250, placeholder: 'Address (shop, street, area, city)', value: pr.address, oninput: () => { pr.address = ad.value; } });
      const pu = h('input', { type: 'text', maxlength: 200, placeholder: 'Purpose — e.g. collect payment, new order', value: pr.purpose, oninput: () => { pr.purpose = pu.value; } });
      nm.addEventListener('change', () => {
        const k = known.get(nm.value.trim().toLowerCase());
        if (!k) return;
        if (!ad.value.trim()) { ad.value = k.address; pr.address = k.address; }
        if (!ph.value.trim()) { ph.value = k.phone; pr.phone = k.phone; }
      });
      pr._f = UI.field('Party name', nm);
      const rm = h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Remove party', title: pr.met ? 'Already met — cannot be removed' : 'Remove party', disabled: !!pr.met, style: { color: pr.met ? undefined : 'var(--bad)' },
        onclick: () => { const i = d.parties.indexOf(pr); if (i >= 0) d.parties.splice(i, 1); redraw(); refreshBar(); } }, UI.icon('trash', 16));
      return h('div', { class: 'party-row' }, h('div', { class: 'pr-top' }, pr._f, UI.field('Phone', ph, { optional: true }), rm), UI.field('Address', ad, { optional: true }), UI.field('Purpose', pu, { optional: true }),
        pr.met ? h('small', { class: 'pr-met' }, UI.icon('check', 13), 'Already met — a meeting is recorded for this party') : null);
    }

    function dayCard(date, i) {
      const d = dayOf(date);
      const place = h('input', { type: 'text', maxlength: 200, placeholder: 'e.g. Rajkot, Gondal', value: d.place, oninput: () => { d.place = place.value; } });
      const notes = h('input', { type: 'text', maxlength: 500, placeholder: 'Travel, timing, anything to remember', value: d.notes, oninput: () => { d.notes = notes.value; } });
      d._fPlace = UI.field('Place(s) to visit', place);
      const partiesHost = h('div', { class: 'party-list' });
      const body = h('div', { class: 'day-body', hidden: d.skip });
      const redraw = () => UI.mount(partiesHost, d.parties.map((pr) => partyRow(d, pr, partiesHost, redraw)));
      redraw();
      const add = h('button', { class: 'btn btn-ghost btn-sm', type: 'button', onclick: () => {
        if (d.parties.length >= 15) return UI.toast('At most 15 parties a day.', 'warn');
        const pr = { id: '', name: '', address: '', phone: '', purpose: '', met: false }; d.parties.push(pr); redraw(); refreshBar();
        const inp = pr._f && pr._f.querySelector('input'); if (inp) inp.focus();
      } }, UI.icon('plus', 14), 'Add party to meet');
      body.append(d._fPlace, UI.field('Notes', notes, { optional: true }), h('div', { class: 'pl-h' }, h('b', null, 'Parties to meet'), h('small', null, 'Name, address and phone of each party you plan to meet this day')), partiesHost, add);
      const skip = h('input', { type: 'checkbox', checked: d.skip, onchange: () => { d.skip = skip.checked; body.hidden = d.skip; card.classList.toggle('skipped', d.skip); refreshBar(); } });
      const card = h('section', { class: 'card day-card' + (d.skip ? ' skipped' : '') },
        h('div', { class: 'day-h' }, h('span', { class: 'day-n' }, 'Day ' + (i + 1)), h('b', null, fmtDay(date)), h('label', { class: 'skip-t' }, skip, 'No visit this day')),
        body);
      return card;
    }
    function renderDays() { UI.mount(daysHost, dates().map(dayCard)); refreshBar(); }

    function validate() {
      let ok = true, first = null;
      const bad = (f, msg) => { UI.fieldError(f, msg); ok = false; first = first || f; };
      UI.fieldError(fTitle, ''); if (st.title.trim().length < 3) bad(fTitle, 'Enter a tour name (at least 3 characters)');
      const ds = dates().filter((x) => !dayOf(x).skip);
      if (!ds.length) { UI.toast('Add at least one day to visit.', 'error'); ok = false; }
      for (const date of dates()) {
        const d = dayOf(date);
        if (d._fPlace) UI.fieldError(d._fPlace, '');
        if (d.skip) continue;
        if (d._fPlace && d.place.trim().length < 2) bad(d._fPlace, 'Enter the place(s) to visit on ' + RW.fmtDateShort(date));
        for (const pr of d.parties) { if (pr._f) UI.fieldError(pr._f, ''); if (pr._f && pr.name.trim().length < 2) bad(pr._f, 'Enter the party name'); }
      }
      if (first) first.scrollIntoView({ block: 'center', behavior: 'smooth' });
      return ok;
    }
    async function save(btn) {
      if (!validate()) return;
      btn.disabled = true; btn.classList.add('busy');
      try {
        const days = dates().filter((d) => !dayOf(d).skip).map((date) => { const d = dayOf(date); return { date, place: d.place, notes: d.notes, parties: d.parties.map((x) => ({ id: x.id || undefined, name: x.name, address: x.address, phone: x.phone, purpose: x.purpose })) }; });
        const body = { title: st.title, purpose: st.purpose, startDate: st.start, endDate: st.end, days };
        const r = editId ? await RW.api.call('tours.update', { id: editId, patch: body }) : await RW.api.call('tours.create', body);
        UI.toast(editId ? 'Tour plan updated. It is still waiting for your approval.' : app.role === 'SUPER_ADMIN' ? 'Tour plan saved. Approve it to make it final.' : 'Tour plan sent to the admin for approval.', 'success');
        location.hash = '#/tours/' + r.tour.id;
      } catch (e) { UI.toast(UI.errMsg(e), 'error'); btn.disabled = false; btn.classList.remove('busy'); }
    }
    const saveBtn = h('button', { class: 'btn btn-primary btn-lg', type: 'button', onclick: () => save(saveBtn) }, UI.icon('check', 18), editId ? 'Save changes' : app.role === 'SUPER_ADMIN' ? 'Save tour plan' : 'Send for approval');
    UI.mount(host,
      V.pageHead(editId ? 'Edit tour plan' : 'New tour plan', 'Choose the dates, then write the places and the parties you will meet on each day.', null, back),
      h('div', { class: 'stack', style: { gap: '16px' } },
        editId ? h('div', { class: 'callout warn' }, UI.icon('shield', 16), h('span', null, h('b', null, ex.tour.userName + '\'s plan is waiting for approval. '), 'Make the changes here, then approve it. After approval nobody can change the plan.'))
          : h('div', { class: 'callout info' }, UI.icon('shield', 16), h('span', null, h('b', null, 'This plan goes to the main admin for approval. '), 'Until it is approved only the admin can change it. Once approved it is final — you can then only cancel the tour.')),
        h('div', { class: 'card' }, h('div', { class: 'card-b' }, h('div', { class: 'stack', style: { gap: '14px' } }, fTitle, h('div', { class: 'form-grid' }, fStart, fEnd), fPurpose))),
        h('div', { class: 'sec-h' }, h('h2', null, 'Day-wise plan'), h('small', null, 'Tick “No visit this day” for a rest or travel-only day.')),
        daysHost, dl,
        h('div', { class: 'tour-bar' }, bar, h('span', { class: 'tb-sp' }), h('a', { class: 'btn btn-ghost btn-lg', href: back.href }, 'Cancel'), saveBtn)));
    renderDays();
  }
  RW.route('/tours/new', (root, p, app) => planPage(root, p, app, null), { roles: PLAN_ROLES });
  RW.route('/tours/:id/edit', (root, p, app) => planPage(root, p, app, p.id), { roles: ['SUPER_ADMIN'] });

  /* ============================================================== tour page */
  RW.route('/tours/:id', async function (root, p, app) {
    let dead = false, data = null;
    const host = h('div', null, V.loading(8));
    root.appendChild(host);
    const back = { href: '#/tours', label: 'Tours' };

    async function load() {
      let d;
      try { d = await RW.api.call('tours.get', { id: p.id }); } catch (e) {
        if (dead) return;
        UI.mount(host, V.pageHead('Tour not found', null, null, back), h('div', { class: 'card' }, UI.empty('This tour could not be found', 'It may not exist, or it belongs to another person.', 'search', h('a', { class: 'btn btn-primary btn-sm', href: '#/tours', style: { marginTop: '14px' } }, 'Back to tours'))));
        return;
      }
      if (dead) return;
      data = d; app.title(d.tour.title); render(d);
    }

    async function setStatus(status, label, tone) {
      const t = data.tour;
      const r = status === 'CANCELLED' ? reasonBox('Why is the tour cancelled?', 'e.g. dealer meeting moved, trip postponed') : null;
      UI.modal({ title: label, size: 'sm', body: h('div', { class: 'stack', style: { gap: '12px' } }, h('p', null,
        status === 'COMPLETED' ? 'Mark ' : status === 'PLANNED' ? 'Reopen ' : 'Cancel ', h('b', null, t.title), status === 'COMPLETED' ? ' as completed? You can still add late meetings afterwards.' : status === 'PLANNED' ? ' so the plan can be changed again?' : '? Recorded meetings stay on record.'), r ? r.f : null),
        actions: [{ label: 'Not now' }, { label, kind: tone || 'primary', keepOpen: true, onClick: async (m) => { await RW.api.call('tours.setStatus', { id: t.id, status, reason: r ? r.t.value : undefined }); UI.toast('Tour updated.', 'success'); m.close(); load(); } }] });
    }
    function approve() {
      const t = data.tour;
      UI.modal({ title: 'Approve tour plan', size: 'sm', body: h('div', { class: 'stack', style: { gap: '12px' } },
        h('p', null, 'Approve ', h('b', null, t.title), ' of ', h('b', null, t.userName), '?'),
        h('div', { class: 'callout warn' }, UI.icon('lock', 16), h('span', null, 'Once approved the plan is final. Nobody — not even you — can change it. ' + t.userName + ' can only cancel the tour.'))),
        actions: [{ label: 'Not yet' }, { label: 'Approve plan', kind: 'primary', keepOpen: true, onClick: async (m) => { await RW.api.call('tours.approve', { id: t.id }); UI.toast('Tour plan approved.', 'success'); m.close(); load(); } }] });
    }
    function deleteTour() {
      const t = data.tour, r = reasonBox(t.visitCount ? 'Reason (required)' : 'Reason', 'Why is this tour being deleted?');
      UI.modal({ title: 'Delete tour', size: 'sm', body: h('div', { class: 'stack', style: { gap: '12px' } }, h('p', null, 'Delete ', h('b', null, t.title), t.visitCount ? ' with its ' + plural(t.visitCount, 'meeting') + ' and ' + plural(t.photoCount, 'photo') + '?' : '?', ' This cannot be undone.'), r.f),
        actions: [{ label: 'Keep it' }, { label: 'Delete tour', kind: 'danger', keepOpen: true, onClick: async (m) => { await RW.api.call('tours.delete', { id: t.id, reason: r.t.value }); UI.toast('Tour deleted.', 'success'); m.close(); location.hash = '#/tours'; } }] });
    }

    let tmap = null;
    /* the main admin and the CEO see where the meetings of this tour were recorded from */
    function placesCard(d) {
      const t = d.tour, sees = d.visits.length && 'geoStatus' in d.visits[0];
      if (!sees) return null;
      const gv = d.visits.filter((v) => v.geo);
      const host = h('div', { class: 'tour-map' });
      const card = h('div', { class: 'card' },
        h('div', { class: 'card-h', style: { display: 'flex', justifyContent: 'space-between', gap: '10px', alignItems: 'center', flexWrap: 'wrap' } }, h('b', null, 'Where the meetings were recorded'),
          h('span', { class: 'muted', style: { fontSize: '12.5px' } }, gv.length + ' of ' + d.visits.length + ' meetings have a place · ', h('a', { class: 'link', href: '#/live-map?user=' + t.userId + '&date=' + d.visits[d.visits.length - 1].date }, 'Open on Live Map'))),
        gv.length ? host : h('div', { class: 'card-b' }, h('p', { class: 'muted', style: { margin: 0 } }, 'None of the meetings has a place (location was off, blocked or not available on the phone).')));
      if (gv.length) setTimeout(() => {
        if (!host.isConnected || !RW.map) return;
        if (tmap) { try { tmap.remove(); } catch (e) { /* gone */ } }
        tmap = RW.map.create(host, {});
        if (!tmap) return;
        const L = g.L, pts = [];
        gv.forEach((v, i) => {
          const mk = L.marker([v.geo.lat, v.geo.lng], { icon: RW.map.meetIcon(i + 1, v.geo.stale ? 'late' : v.plannedPartyId ? 'plan' : 'ok'), title: v.partyName }).addTo(tmap);
          mk.bindPopup(h('div', { class: 'lm-pop' }, h('b', null, v.partyName), h('div', { class: 'muted' }, RW.fmtDate(v.date) + (v.time ? ' · ' + v.time : '')), h('div', { class: 'lm-pop-l' }, v.address),
            h('div', null, v.plannedPartyId ? UI.badge('In the tour plan', 'green') : UI.badge('Extra meeting', 'amber')), h('div', { class: 'lm-pop-l muted' }, '±' + v.geo.acc + ' m accuracy')));
          pts.push([v.geo.lat, v.geo.lng]);
        });
        if (pts.length > 1) L.polyline(pts, { color: '#D9530A', weight: 3, opacity: 0.6, dashArray: '6 8' }).addTo(tmap);
        RW.map.fit(tmap, pts, { maxZoom: 15 });
      }, 30);
      return card;
    }

    function render(d) {
      const t = d.tour, today = d.today;
      const brief = tourBrief(t);
      const record = (planned) => V.meetingDialog({ tour: brief, plannedPartyId: planned ? planned.id : undefined, onDone: load });
      const acts = [];
      if (d.canRecord) acts.push(h('button', { class: 'btn btn-accent', type: 'button', onclick: () => record() }, UI.icon('camera', 16), 'Record Meeting'));
      if (d.canApprove) acts.push(h('button', { class: 'btn btn-primary', type: 'button', onclick: approve }, UI.icon('check', 16), 'Approve plan'));
      if (d.canEdit) acts.push(h('a', { class: 'btn btn-ghost', href: '#/tours/' + t.id + '/edit' }, UI.icon('edit', 16), 'Edit plan'));
      if (d.canClose && t.startDate <= today) acts.push(h('button', { class: 'btn btn-ghost', type: 'button', onclick: () => setStatus('COMPLETED', 'Mark completed') }, UI.icon('check', 16), 'Mark completed'));
      if (d.canClose) acts.push(h('button', { class: 'btn btn-ghost', type: 'button', onclick: () => setStatus('CANCELLED', 'Cancel tour', 'danger') }, UI.icon('ban', 16), 'Cancel tour'));
      if (d.canReopen) acts.push(h('button', { class: 'btn btn-ghost', type: 'button', onclick: () => setStatus('PLANNED', 'Reopen tour') }, UI.icon('refresh', 16), 'Reopen'));
      if (d.canDelete) acts.push(h('button', { class: 'btn btn-ghost', type: 'button', style: { color: 'var(--bad)' }, onclick: deleteTour }, UI.icon('trash', 16), 'Delete'));

      const stat = (label, val, sub, icon) => h('div', { class: 'card kpi' }, h('div', { class: 'kpi-top' }, h('span', { class: 'kpi-ic' }, UI.icon(icon, 16)), label), h('div', { class: 'kpi-v' }, val), h('div', { class: 'kpi-s' }, h('span', null, sub || '')));
      const kpis = h('div', { class: 'grid tour-kpis' },
        stat('Days', String(t.dayCount), range(t.startDate, t.endDate), 'calendar'),
        stat('Parties planned', String(t.plannedParties), t.plannedParties ? t.metPlanned + ' met' : 'none planned', 'users'),
        stat('Meetings', String(t.visitCount), t.visitCount - t.metPlanned > 0 && t.visitCount ? 'incl. ' + (d.visits.filter((v) => !v.plannedPartyId).length) + ' not in the plan' : 'recorded', 'pin'),
        stat('Photos', String(t.photoCount), 'taken at meetings', 'camera'));

      /* every date that has a plan or a meeting */
      const byDate = new Map();
      d.visits.forEach((v) => { if (!byDate.has(v.date)) byDate.set(v.date, []); byDate.get(v.date).push(v); });
      const planned = new Map(t.days.map((x) => [x.date, x]));
      const dates = [...new Set([...planned.keys(), ...byDate.keys()])].sort();
      const secs = dates.map((date, i) => {
        const day = planned.get(date), vs = byDate.get(date) || [];
        const isToday = date === today;
        return h('section', { class: 'card day-sec' + (isToday ? ' today' : '') },
          h('div', { class: 'day-sh' }, h('span', { class: 'day-n' }, 'Day ' + (i + 1)),
            h('div', { class: 'day-sh-t' }, h('b', null, fmtDay(date)), h('small', null, day ? day.place : 'Not in the plan')),
            isToday ? UI.badge('Today', 'orange') : null, vs.length ? UI.badge(plural(vs.length, 'meeting'), 'navy') : null),
          h('div', { class: 'card-b', style: { paddingTop: '12px' } }, h('div', { class: 'stack', style: { gap: '12px' } },
            day && day.notes ? h('p', { class: 'muted', style: { margin: 0 } }, day.notes) : null,
            day && day.parties.length ? h('div', { class: 'pp-list' }, day.parties.map((x) => {
              const [lab, tone, ic] = STATE[x.state];
              return h('div', { class: 'pp-row ' + x.state },
                h('span', { class: 'pp-ic' }, UI.icon(ic, 15)),
                h('div', { class: 'pp-t' }, h('b', null, x.name), x.purpose ? h('small', null, x.purpose) : null, h('small', { class: 'pp-a' }, [x.address].filter(Boolean).join(' · ')), x.phone ? phoneLink(x.phone) : null),
                h('div', { class: 'pp-r' }, UI.badge(lab, tone), d.canRecord && x.state !== 'MET' ? h('button', { class: 'btn btn-primary btn-sm', type: 'button', onclick: () => record(x) }, UI.icon('camera', 14), 'Record') : null));
            })) : day ? h('p', { class: 'muted', style: { margin: 0, fontSize: '13px' } }, 'No parties planned for this day.') : null,
            vs.length ? h('div', { class: 'meet-list' }, vs.map((v) => meetingCard(v, { tour: brief, onChange: load, showUser: false }))) : null)));
      });

      const banners = [];
      if (t.awaiting) {
        banners.push(d.canApprove
          ? h('div', { class: 'callout warn' }, UI.icon('shield', 16), h('span', null, h('b', null, 'Waiting for your approval. '), 'You can change the plan first. After you approve it the plan is final and nobody can change it.'))
          : h('div', { class: 'callout warn' }, UI.icon('clock', 16), h('span', null, h('b', null, 'Waiting for admin approval. '), 'Only the main admin can change this plan until it is approved. You can still cancel the tour.')));
      } else if (t.status === 'PLANNED' && t.approval === 'APPROVED') {
        banners.push(h('div', { class: 'callout ok' }, UI.icon('lock', 16), h('span', null, h('b', null, 'Approved' + (t.approvedBy ? ' by ' + t.approvedBy : '') + (t.approvedAt ? ' on ' + approvedOn(t) : '') + ' — this plan is final. '), 'It cannot be changed' + (d.canClose ? '; the tour can only be cancelled.' : '.'))));
      }
      if (t.phase === 'ENDED') banners.push(h('div', { class: 'callout warn' }, UI.icon('alert', 16), h('span', null, 'The tour dates are over. Record any meetings that are still missing, then mark the tour completed.')));
      if (t.phase === 'CANCELLED') banners.push(h('div', { class: 'callout bad' }, UI.icon('ban', 16), h('span', null, h('b', null, 'Cancelled'), t.cancelReason ? ' — ' + t.cancelReason : '')));
      if (t.purpose) banners.push(h('div', { class: 'callout info' }, UI.icon('info', 16), h('span', null, h('b', null, 'Purpose: '), t.purpose)));
      if (d.canRecord && d.visits.some((v) => v.canEdit)) banners.push(h('p', { class: 'muted', style: { margin: 0, fontSize: '12.5px' } }, 'You can correct or delete a meeting for ' + d.editHours + ' hours after recording it; after that it is locked.'));

      UI.mount(host,
        V.pageHead(t.title, [t.userName, V.branchShort(t), range(t.startDate, t.endDate)].filter(Boolean).join(' · '), [phaseBadge(t.phase), t.awaiting ? waitBadge() : null].concat(acts), back),
        h('div', { class: 'stack', style: { gap: '16px' } }, kpis, placesCard(d), banners, secs.length ? secs : h('div', { class: 'card' }, UI.empty('Nothing planned yet', 'Edit the plan to add the places and parties.', 'map'))));
    }
    load(); app.live(load);
    return { dispose() { dead = true; if (tmap) { try { tmap.remove(); } catch (e) { /* gone */ } } } };
  });
})(typeof window !== 'undefined' ? window : globalThis);
