/* Ravi Cash — application shell: boot, router, navigation, global search, notifications, theme, live sync. */
(function (g) {
  'use strict';
  const RW = (g.RW = g.RW || {});
  const UI = RW.ui, V = RW.v;
  const { h } = UI;
  const doc = g.document;

  const app = (RW.app = {
    user: null, branch: null, register: null, settings: null, today: null, theme: 'light',
    page: null, current: null, liveCbs: new Set(), started: false, unread: 0, lastNotif: 0, installEvent: null,
    get role() { return app.user && app.user.role; },
    get isAdmin() { return app.role === 'SUPER_ADMIN' || app.role === 'BRANCH_ADMIN' || app.role === 'CEO'; },   // sees the admin screens
    get isSuper() { return app.role === 'SUPER_ADMIN'; },                       // the main admin: the only one who can change things
    get isCeo() { return app.role === 'CEO'; },                                 // sees every branch, changes nothing
    get seesAll() { return app.role === 'SUPER_ADMIN' || app.role === 'CEO'; }, // data of every branch
    get mgmt() { return !!app.user && app.role !== 'USER'; }, // sees more than their own data
    get canCreate() { return !!app.user && app.role !== 'VIEWER' && app.role !== 'CEO'; },
  });

  /* ------------------------------------------------------------------ theme */
  app.applyTheme = (t) => { app.theme = t === 'dark' ? 'dark' : 'light'; doc.documentElement.dataset.theme = app.theme; const m = doc.querySelector('meta[name=theme-color]'); if (m) m.content = app.theme === 'dark' ? '#0A1220' : '#0B2A4A'; };
  app.toggleTheme = () => {
    app.applyTheme(app.theme === 'dark' ? 'light' : 'dark');
    RW.LS.set('rw.theme', app.theme);
    UI.$$('[data-theme-btn]').forEach((b) => { UI.clear(b); b.appendChild(UI.icon(app.theme === 'dark' ? 'sun' : 'moon', 18)); });
    if (RW.charts) RW.charts.redrawAll();
  };

  /* ------------------------------------------------------------------ nav */
  const NAV_USER = [
    { id: 'dashboard', label: 'Dashboard', icon: 'home', href: '#/dashboard' },
    { id: 'new', label: 'Create Voucher', icon: 'plus', href: '#/vouchers/new', need: 'create' },
    { id: 'vouchers', label: 'My Vouchers', icon: 'file', href: '#/vouchers' },
    { id: 'tours', label: 'Tours', icon: 'map', href: '#/tours' },
    { id: 'register', label: 'Cash Register', icon: 'wallet', href: '#/register' },
    { id: 'statements', label: 'Statements', icon: 'chart', href: '#/statements' },
    { id: 'profile', label: 'Profile', icon: 'user', href: '#/profile' },
  ];
  const NAV_ADMIN = [
    { id: 'dashboard', label: 'Dashboard', icon: 'home', href: '#/dashboard' },
    { id: 'ceo', label: 'CEO Dashboard', icon: 'pie', href: '#/ceo', need: 'super' },
    { id: 'livemap', label: 'Live Map', icon: 'pin', href: '#/live-map', need: 'super' },
    { id: 'branches', label: 'Branches', icon: 'building', href: '#/branches' },
    { id: 'users', label: 'Users', icon: 'users', href: '#/users' },
    { id: 'all-vouchers', label: 'All Vouchers', icon: 'file', href: '#/all-vouchers' },
    { id: 'tours', label: 'Tours', icon: 'map', href: '#/tours' },
    { id: 'register', label: 'Cash Register', icon: 'wallet', href: '#/register' },
    { id: 'statements', label: 'Statements', icon: 'chart', href: '#/statements' },
    { id: 'outstanding', label: 'Outstanding', icon: 'scale', href: '#/outstanding' },
    { id: 'reports', label: 'Reports', icon: 'pie', href: '#/reports' },
    { id: 'attachments', label: 'Attachments', icon: 'clip', href: '#/attachments' },
    { id: 'audit', label: 'Audit', icon: 'shield', href: '#/audit' },
    { id: 'notifications', label: 'Notifications', icon: 'bell', href: '#/notifications', badge: true },
    { id: 'backup', label: 'Backup', icon: 'cloudup', href: '#/backup', need: 'super' },
    { id: 'settings', label: 'Settings', icon: 'settings', href: '#/settings', need: 'super' },
  ];
  const NAV_CEO = [
    { id: 'ceo', label: 'CEO Dashboard', icon: 'pie', href: '#/ceo' },
    { id: 'livemap', label: 'Live Map', icon: 'pin', href: '#/live-map' },
    { id: 'branches', label: 'Branches', icon: 'building', href: '#/branches' },
    { id: 'users', label: 'Users', icon: 'users', href: '#/users' },
    { id: 'all-vouchers', label: 'All Vouchers', icon: 'file', href: '#/all-vouchers' },
    { id: 'tours', label: 'Tours', icon: 'map', href: '#/tours' },
    { id: 'register', label: 'Cash Register', icon: 'wallet', href: '#/register' },
    { id: 'statements', label: 'Statements', icon: 'chart', href: '#/statements' },
    { id: 'outstanding', label: 'Outstanding', icon: 'scale', href: '#/outstanding' },
    { id: 'reports', label: 'Reports', icon: 'pie', href: '#/reports' },
    { id: 'attachments', label: 'Attachments', icon: 'clip', href: '#/attachments' },
    { id: 'audit', label: 'Audit', icon: 'shield', href: '#/audit' },
    { id: 'notifications', label: 'Notifications', icon: 'bell', href: '#/notifications', badge: true },
  ];
  const NAV_VIEWER = [
    { id: 'dashboard', label: 'Dashboard', icon: 'home', href: '#/dashboard' },
    { id: 'all-vouchers', label: 'Vouchers', icon: 'file', href: '#/all-vouchers' },
    { id: 'tours', label: 'Tours', icon: 'map', href: '#/tours' },
    { id: 'register', label: 'Cash Register', icon: 'wallet', href: '#/register' },
    { id: 'statements', label: 'Statements', icon: 'chart', href: '#/statements' },
    { id: 'reports', label: 'Reports', icon: 'pie', href: '#/reports' },
    { id: 'profile', label: 'Profile', icon: 'user', href: '#/profile' },
  ];
  app.nav = () => (app.isCeo ? NAV_CEO : app.isAdmin ? NAV_ADMIN : app.role === 'VIEWER' ? NAV_VIEWER : NAV_USER).filter((n) => !n.need || (n.need === 'create' ? app.canCreate : app.isSuper));
  const activeId = (path) => {
    const p = path.split('/')[1] || 'dashboard';
    if (p === 'vouchers') return path === '/vouchers/new' ? 'new' : 'vouchers';
    return p;
  };

  /* ---------------------------------------------------------------- shell */
  function buildShell() {
    const nav = app.nav();
    const navEls = nav.map((n) => h('a', { class: 'nav-item', href: n.href, dataset: { id: n.id }, onclick: () => doc.body.classList.remove('nav-open') }, UI.icon(n.icon, 19), n.label, n.badge ? h('span', { class: 'badge-n', hidden: true, id: 'nav-unread' }) : null));
    const side = h('aside', { class: 'side', 'aria-label': 'Main navigation' },
      h('div', { class: 'side-brand' }, V.logoTile('full', 64)),
      h('div', { class: 'side-tag' }, app.isCeo ? 'CEO Control Room' : app.isAdmin ? 'Admin Control Center' : app.role === 'VIEWER' ? 'Viewer Portal' : 'Cash Management'),
      h('nav', { class: 'side-nav' }, navEls),
      h('div', { class: 'side-foot' }, h('b', null, app.branch ? app.branch.name : ''), app.register ? 'Register ' + app.register.id : (app.seesAll ? 'All branches' : '')));

    // global search
    const sIn = h('input', { type: 'search', placeholder: 'Search voucher no., party, user, branch, amount…', 'aria-label': 'Global search', autocomplete: 'off', spellcheck: 'false' });
    const sDrop = h('div', { class: 'drop', hidden: true, role: 'listbox' });
    const sClose = h('button', { class: 's-close icon-btn', type: 'button', 'aria-label': 'Close search', onclick: (e) => { e.stopPropagation(); closeSearch(); } }, UI.icon('x', 18));
    const search = h('div', { class: 'search' }, UI.icon('search', 17), sIn, h('kbd', null, '/'), sClose, sDrop);
    const isPhone = () => g.matchMedia && g.matchMedia('(max-width: 720px)').matches;
    const closeSearch = () => { search.classList.remove('open'); sDrop.hidden = true; sIn.blur(); };
    search.addEventListener('click', () => { if (isPhone() && !search.classList.contains('open')) { search.classList.add('open'); sIn.focus(); } });
    sIn.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeSearch(); });
    search.closeSearch = closeSearch;
    wireSearch(sIn, sDrop);

    // notifications bell
    const bellDot = h('span', { class: 'dot', hidden: true, id: 'bell-dot' });
    const bell = h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Notifications', onclick: (e) => { e.stopPropagation(); toggleBell(bell); } }, UI.icon('bell', 20), bellDot);
    const isDemo = RW.api.kind === 'demo';
    const net = h('span', { class: 'pill-net ' + (isDemo ? 'demo' : 'on'), id: 'net-pill', title: isDemo ? 'Demo: sample data kept on this device only. Not connected to your real system.' : 'Real-time sync' }, h('i'), h('span', null, isDemo ? 'Demo' : 'Live'));
    const demoBar = isDemo ? h('div', { class: 'demo-bar', role: 'note' }, UI.icon('info', 14),
      h('span', null, h('b', null, 'DEMO'), ' — sample data kept on this device only. It is not connected to your real Ravi Cash system, so nothing syncs with your PC or other phones.')) : null;
    const themeBtn = h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Toggle dark mode', dataset: { themeBtn: '1' }, onclick: () => app.toggleTheme() }, UI.icon(app.theme === 'dark' ? 'sun' : 'moon', 18));
    const who = h('button', { class: 'who', type: 'button', 'aria-label': 'Account menu', onclick: (e) => { e.stopPropagation(); toggleUserMenu(who); } },
      h('span', { class: 'avatar' }, RW.initials(app.user.fullName)), h('span', { class: 'wt' }, h('b', null, app.user.fullName), h('small', null, UI.roleName(app.user.role))));
    const create = app.canCreate ? h('a', { class: 'btn btn-accent btn-sm', href: '#/vouchers/new', style: { display: app.isAdmin ? '' : 'none' }, id: 'top-create' }, UI.icon('plus', 15), 'Create Voucher') : null;
    const top = h('header', { class: 'top' },
      h('button', { class: 'icon-btn menu-btn', type: 'button', 'aria-label': 'Open menu', onclick: () => doc.body.classList.toggle('nav-open') }, UI.icon('menu', 20)),
      h('a', { class: 'brand-m', href: app.isCeo ? '#/ceo' : '#/dashboard', 'aria-label': 'Ravi water flow PUMP' }, V.logoTile('mark', 26)), search, h('span', { class: 'top-sp' }), RW.tracker ? RW.tracker.chip() : null, net, create, themeBtn, bell, who);

    const pageHost = h('main', { id: 'main', tabindex: -1 });
    const mobile = nav.filter((n) => ['dashboard', 'ceo', 'vouchers', 'tours', 'all-vouchers', 'register', 'statements', 'profile'].includes(n.id) && n.id !== 'new' && (n.id !== 'ceo' || app.isCeo));
    // Admins get 4 shortcuts + "More". Users and viewers get every shortcut, Profile included (it used to be pushed off the bar when Tours was added).
    let bn = app.isAdmin ? mobile.filter((n) => n.id !== 'profile' && n.id !== 'tours').slice(0, 4) : mobile.slice(0, 6);
    const more = app.isAdmin ? h('button', { type: 'button', onclick: () => doc.body.classList.toggle('nav-open'), 'aria-label': 'More menu' }, UI.icon('menu', 21), 'More') : null;
    const shortLabel = { 'My Vouchers': 'Vouchers', 'All Vouchers': 'Vouchers', 'Cash Register': 'Cash', Dashboard: 'Home', 'CEO Dashboard': 'CEO', Statements: 'Statement' };
    const bnav = h('nav', { class: 'bnav' + (bn.length + (more ? 1 : 0) >= 6 ? ' n6' : ''), 'aria-label': 'Quick navigation' }, bn.map((n) => h('a', { href: n.href, dataset: { id: n.id } }, UI.icon(n.icon, 21), shortLabel[n.label] || n.label)), more);
    const fab = app.canCreate ? h('a', { class: 'fab', href: '#/vouchers/new', 'aria-label': 'Create voucher' }, UI.icon('plus', 22), 'Create Voucher') : null;
    const scrim = h('div', { class: 'scrim', onclick: () => doc.body.classList.remove('nav-open') });
    return { frag: [h('div', { class: 'app' }, side, h('div', { class: 'main' }, top, demoBar, pageHost)), bnav, fab, scrim], pageHost, top, create, fab };
  }

  /* ------------------------------------------------------- dropdown menus */
  let openDrop = null;
  const closeDrop = () => { if (openDrop) { openDrop.remove(); openDrop = null; } };
  doc.addEventListener('click', (e) => { if (openDrop && !openDrop.contains(e.target)) closeDrop(); const sd = UI.$('.search .drop'); if (sd && !sd.hidden && !e.target.closest('.search')) sd.hidden = true; });
  doc.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeDrop(); });
  function placeDrop(anchor, el, w) {
    closeDrop();
    el.style.width = w + 'px';
    doc.body.appendChild(el);
    const r = anchor.getBoundingClientRect();
    el.style.position = 'fixed';
    el.style.top = r.bottom + 8 + 'px';
    el.style.left = Math.max(8, Math.min(innerWidth - w - 8, r.right - w)) + 'px';
    openDrop = el;
  }
  function toggleUserMenu(anchor) {
    if (openDrop && openDrop.dataset.k === 'user') return closeDrop();
    const m = h('div', { class: 'drop', dataset: { k: 'user' } },
      h('div', { style: { padding: '14px 16px', borderBottom: '1px solid var(--line)' } }, h('b', null, app.user.fullName), h('div', { class: 'muted', style: { fontSize: '12px' } }, UI.roleName(app.user.role) + ' · ' + (app.branch ? app.branch.name : '')), app.register ? h('div', { class: 'muted', style: { fontSize: '12px' } }, 'Cash register ' + app.register.id) : null),
      h('a', { class: 'item', href: '#/profile', onclick: closeDrop }, UI.icon('user', 17), 'Profile & password'),
      h('button', { class: 'item', style: { width: '100%', border: 0, background: 'none', textAlign: 'left' }, onclick: () => { closeDrop(); app.toggleTheme(); } }, UI.icon(app.theme === 'dark' ? 'sun' : 'moon', 17), app.theme === 'dark' ? 'Light mode' : 'Dark mode'),
      h('button', { class: 'item', style: { width: '100%', border: 0, background: 'none', textAlign: 'left', color: 'var(--bad)' }, onclick: () => { closeDrop(); app.logout(); } }, UI.icon('logout', 17), 'Sign out'));
    placeDrop(anchor, m, 270);
  }

  /* ------------------------------------------------------- notifications */
  const KIND_ICON = { VOUCHER_CREATED: 'file', RECEIPT_CREATED: 'inflow', VOUCHER_EDITED: 'edit', VOUCHER_VOID: 'ban', VOUCHER_DELETED: 'trash', VOUCHER_REVIEW: 'check', STATEMENT_GENERATED: 'chart', USER_CREATED: 'users', USER_STATUS: 'user', TOUR_PLANNED: 'map', TOUR_PENDING: 'shield', TOUR_APPROVED: 'check', TOUR_EDITED: 'edit', TOUR_CANCELLED: 'ban', SYSTEM: 'alert' };
  V.notifItem = (n, onClick) => h('div', { class: 'item' + (n.read ? '' : ' unread'), style: { alignItems: 'flex-start', opacity: n.read ? 0.78 : 1 }, onclick: onClick },
    h('span', { class: 'kpi-ic', style: { flex: 'none', background: n.important ? 'var(--accent-soft)' : undefined, color: n.important ? 'var(--accent-ink)' : undefined } }, UI.icon(KIND_ICON[n.kind] || 'bell', 15)),
    h('div', { style: { minWidth: 0 } }, h('b', { style: { fontSize: '13px' } }, n.title), h('small', { style: { whiteSpace: 'normal', lineHeight: 1.4 } }, n.body), h('small', null, RW.timeAgo(n.at) + (n.branchName ? ' · ' + n.branchName : ''))),
    n.read ? null : h('i', { style: { marginLeft: 'auto', width: '8px', height: '8px', borderRadius: '50%', background: 'var(--orange)', flex: 'none', marginTop: '6px' } }));
  async function toggleBell(anchor) {
    if (openDrop && openDrop.dataset.k === 'bell') return closeDrop();
    const box = h('div', { class: 'drop', dataset: { k: 'bell' } });
    placeDrop(anchor, box, Math.min(400, innerWidth - 16));
    UI.mount(box, UI.skeleton(3));
    try {
      const r = await RW.api.call('notifications.list', { limit: 8 });
      UI.mount(box,
        h('div', { class: 'row sb', style: { padding: '12px 14px 6px' } }, h('b', null, 'Notifications'), r.unread ? h('button', { class: 'link', style: { fontSize: '12px' }, onclick: async () => { await RW.api.call('notifications.markRead', { all: true }); closeDrop(); app.pollNotifs(true); } }, 'Mark all read') : null),
        r.rows.length ? r.rows.map((n) => V.notifItem(n, () => { closeDrop(); if (n.voucherId) location.hash = '#/vouchers/' + n.voucherId; else location.hash = '#/notifications'; RW.api.call('notifications.markRead', { ids: [n.id] }).then(() => app.pollNotifs(true)); })) : UI.empty('You’re all caught up', 'New activity will appear here instantly.', 'bell'),
        h('a', { class: 'item', href: '#/notifications', onclick: closeDrop, style: { justifyContent: 'center', borderTop: '1px solid var(--line)', color: 'var(--accent-ink)', fontWeight: 600 } }, 'View all notifications'));
    } catch (e) { UI.mount(box, UI.empty('Could not load', UI.errMsg(e), 'alert')); }
  }
  app.pollNotifs = async function (quiet) {
    if (!app.user) return;
    try {
      const r = await RW.api.call('notifications.list', { limit: 12 });
      app.unread = r.unread;
      const dot = doc.getElementById('bell-dot'), nb = doc.getElementById('nav-unread');
      if (dot) { dot.hidden = !r.unread; dot.textContent = r.unread > 9 ? '9+' : r.unread; }
      if (nb) { nb.hidden = !r.unread; nb.textContent = r.unread; }
      const idNum = (n) => +String(n.id).replace('nt_', '');
      const maxId = r.rows.reduce((a, n) => Math.max(a, idNum(n)), 0);
      if (!quiet && app.lastNotif) {
        r.rows.filter((n) => idNum(n) > app.lastNotif && !n.read).slice(0, 2).reverse().forEach((n) => UI.toast(n.body, 'live', { title: n.title, onClick: () => { if (n.voucherId) location.hash = '#/vouchers/' + n.voucherId; } }));
      }
      app.lastNotif = Math.max(app.lastNotif, maxId);
    } catch (e) { /* ignore */ }
  };

  /* --------------------------------------------------------- global search */
  function wireSearch(input, drop) {
    let items = [], sel = -1, seq = 0;
    const go = (hash) => { drop.hidden = true; input.blur(); location.hash = hash; };
    const render = (res, q) => {
      UI.clear(drop); items = [];
      const add = (el, hash) => { el.addEventListener('click', () => go(hash)); el.dataset.i = items.length; items.push({ el, hash }); return el; };
      if (res.exact) {
        const v = res.exact;
        drop.appendChild(h('h5', null, 'Voucher found'));
        drop.appendChild(add(h('div', { class: 'item', style: { alignItems: 'flex-start', flexDirection: 'column', gap: '4px' } },
          h('div', { class: 'row', style: { width: '100%', gap: '8px' } }, h('b', { style: { fontSize: '15px' } }, v.label), UI.typeBadge(v.type, v.kind), UI.statusBadge(v.status), UI.reviewBadge(v.status === 'ACTIVE' ? v.review : ''), h('span', { class: 'amt', style: { marginLeft: 'auto' } }, RW.fmtINR(v.amountPaise))),
          h('div', null, v.partyName), h('small', null, v.particulars), h('small', null, RW.amountInWords(v.amountPaise)), h('small', null, RW.fmtDate(v.date) + ' · ' + v.userName + ' · ' + v.branchName)), '#/vouchers/' + v.id));
      }
      const rest = res.vouchers.filter((v) => !res.exact || v.id !== res.exact.id);
      if (rest.length) {
        drop.appendChild(h('h5', null, 'Vouchers'));
        rest.slice(0, 7).forEach((v) => drop.appendChild(add(h('div', { class: 'item' }, h('span', { class: 'kpi-ic' }, UI.icon(v.type === 'PAYMENT' ? 'outflow' : 'inflow', 15)), h('div', { style: { minWidth: 0 } }, h('b', null, v.label + ' · ' + v.partyName), h('small', null, RW.fmtDate(v.date) + (app.mgmt ? ' · ' + v.userName : ''))), h('span', { class: 'amt ' + (v.type === 'PAYMENT' ? 'amt-out' : 'amt-in') }, RW.fmtINR(v.amountPaise))), '#/vouchers/' + v.id)));
      }
      if (res.users.length) { drop.appendChild(h('h5', null, 'Users')); res.users.forEach((u) => drop.appendChild(add(h('div', { class: 'item' }, h('span', { class: 'avatar', style: { width: '28px', height: '28px', fontSize: '11px' } }, RW.initials(u.fullName)), h('div', null, h('b', null, u.fullName), h('small', null, UI.roleName(u.role) + ' · ' + u.branchName))), app.isAdmin ? '#/reports?tab=user&user=' + u.id : '#/register?user=' + u.id))); }
      if (res.branches.length) { drop.appendChild(h('h5', null, 'Branches')); res.branches.forEach((b) => drop.appendChild(add(h('div', { class: 'item' }, h('span', { class: 'kpi-ic' }, UI.icon('building', 15)), h('div', null, h('b', null, b.name), h('small', null, b.code))), '#/branches/' + b.id))); }
      if (!items.length) drop.appendChild(h('div', { class: 'empty', style: { padding: '24px' } }, h('h4', null, 'No results'), h('p', null, 'Nothing matches “' + q + '”. Try a voucher number like CPV-000245.')));
      sel = items.length ? 0 : -1; mark();
      drop.hidden = false;
    };
    const mark = () => items.forEach((it, i) => it.el.classList.toggle('sel', i === sel));
    const run = UI.debounce(async () => {
      const q = input.value.trim();
      if (q.length < 2) { drop.hidden = true; return; }
      const my = ++seq;
      try { const res = await RW.api.call('search.global', { q }); if (my === seq) render(res, q); } catch (e) { /* ignore */ }
    }, 180);
    input.addEventListener('input', run);
    input.addEventListener('focus', () => { if (items.length && input.value.trim().length >= 2) drop.hidden = false; });
    input.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowDown') { sel = Math.min(items.length - 1, sel + 1); mark(); e.preventDefault(); } else if (e.key === 'ArrowUp') { sel = Math.max(0, sel - 1); mark(); e.preventDefault(); }
      else if (e.key === 'Enter') { e.preventDefault(); run.cancel(); if (!drop.hidden && items[sel]) go(items[sel].hash); else if (input.value.trim().length >= 2) RW.api.call('search.global', { q: input.value.trim() }).then((r) => { render(r, input.value); if (items[0]) go(items[0].hash); }); }
      else if (e.key === 'Escape') { drop.hidden = true; input.blur(); }
    });
  }
  doc.addEventListener('keydown', (e) => {
    const t = e.target && e.target.tagName;
    if ((e.key === '/' && t !== 'INPUT' && t !== 'TEXTAREA' && t !== 'SELECT') || ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k')) { const i = UI.$('.search input'); if (i) { e.preventDefault(); i.focus(); i.select(); } }
  });

  /* ----------------------------------------------------------------- router */
  app.live = (cb) => { app.liveCbs.add(cb); return () => app.liveCbs.delete(cb); };
  app.title = (t) => { doc.title = (t ? t + ' · ' : '') + 'Ravi Cash'; };
  const parseHash = () => {
    const raw = (location.hash || '').replace(/^#/, '') || '/dashboard';
    const [path, qs] = raw.split('?');
    const q = {};
    (qs || '').split('&').filter(Boolean).forEach((p) => { const [k, v] = p.split('='); q[decodeURIComponent(k)] = decodeURIComponent(v || ''); });
    return { path: path.replace(/\/+$/, '') || '/dashboard', q };
  };
  app.go = (hash) => { if (location.hash === hash) route(); else location.hash = hash; };
  let routeSeq = 0;
  async function route() {
    if (!app.started) return;
    const { path, q } = parseHash();
    const my = ++routeSeq;
    if (app.current && app.current.dispose) { try { app.current.dispose(); } catch (e) { console.error(e); } }
    app.current = null; app.liveCbs.clear(); closeDrop();
    const _sr = UI.$('.search.open'); if (_sr && _sr.closeSearch) _sr.closeSearch();
    doc.body.classList.remove('nav-open');
    let hit = null, params = {};
    for (const r of RW.routes) { const m = path.match(r.re); if (m) { hit = r; r.keys.forEach((k, i) => { params[k] = decodeURIComponent(m[i + 1]); }); break; } }
    if (app.isCeo && path === '/dashboard') { location.hash = '#/ceo'; return; }   // the CEO's home page is the CEO Dashboard
    if (app.user && app.user.mustChangePassword && path !== '/profile') { location.hash = '#/profile'; return; } // temporary password: must choose a new one first
    const page = h('div', { class: 'page fade-in' });
    UI.mount(app.page, page);
    if (!hit) return UI.mount(page, V.pageHead('Page not found'), h('div', { class: 'card' }, UI.empty('This page does not exist', 'Check the address or go back to the dashboard.', 'search', h('a', { class: 'btn btn-primary btn-sm', style: { marginTop: '14px' }, href: '#/dashboard' }, 'Go to dashboard'))));
    if (hit.roles && !hit.roles.includes(app.role)) return UI.mount(page, V.pageHead('Not allowed'), h('div', { class: 'card' }, UI.empty('You do not have access to this page', 'Ask your administrator if you need access.', 'lock', h('a', { class: 'btn btn-primary btn-sm', style: { marginTop: '14px' }, href: '#/dashboard' }, 'Go to dashboard'))));
    const id = activeId(path);
    UI.$$('[data-id]').forEach((el) => el.classList.toggle('active', el.dataset.id === id));
    const tc = doc.getElementById('top-create');
    if (tc) tc.style.display = app.isAdmin && path !== '/vouchers/new' ? '' : 'none';
    const ownsBottom = path === '/vouchers/new' || path === '/tours/new' || /^\/tours\/[^/]+\/edit$/.test(path);
    if (app.fab) app.fab.style.display = ownsBottom || path.startsWith('/tours') ? 'none' : '';
    doc.body.classList.toggle('no-bnav', ownsBottom); // the create / plan forms own the bottom edge on phones
    g.scrollTo(0, 0);
    try {
      const inst = await hit.view(page, Object.assign({ q }, params), app);
      if (my !== routeSeq) { if (inst && inst.dispose) inst.dispose(); return; }
      app.current = inst || null;
    } catch (e) {
      console.error(e);
      if (my === routeSeq && e.code !== 'UNAUTHENTICATED') UI.mount(page, V.pageHead('Something went wrong'), V.errorCard(e, () => route()));
    }
  }
  g.addEventListener('hashchange', route);

  /* -------------------------------------------------------------- live sync */
  const onChanged = UI.debounce(async () => {
    if (!app.started) return;
    await app.refreshMe();
    app.pollNotifs();
    app.liveCbs.forEach((cb) => { try { cb(); } catch (e) { console.error(e); } });
  }, 250);

  app.refreshMe = async function () {
    try {
      const me = await RW.api.call('auth.me', {});
      app.user = me.user; app.branch = me.branch; app.register = me.register ? Object.assign({ id: me.user.registerId }, me.register) : null; app.settings = me.settings; app.today = me.today;
      const f = UI.$('.side-foot'); if (f) UI.mount(f, h('b', null, app.branch ? app.branch.name : ''), app.register ? 'Register ' + app.register.id : (app.seesAll ? 'All branches' : ''));
    } catch (e) { if (e.code === 'UNAUTHENTICATED' || e.code === 'ACCOUNT_DISABLED') throw e; }
  };

  /* ---------------------------------------------------------- connectivity */
  function netState() {
    const pill = doc.getElementById('net-pill'); if (!pill) return;
    const on = RW.net.online;
    pill.classList.toggle('on', on); pill.classList.toggle('off', !on);
    if (RW.api.kind === 'demo') { pill.classList.remove('on', 'off'); pill.classList.add('demo'); pill.title = 'Demo: sample data kept on this device only. Not connected to your real system.'; UI.mount(pill, h('i'), h('span', null, 'Demo')); return; }
    UI.mount(pill, h('i'), h('span', null, on ? 'Live' : 'Offline'));
    if (on && app.user) syncOutbox();
  }
  async function syncOutbox() {
    if (!app.user) return;
    const n = await RW.outbox.count(app.user.id);
    if (!n) return;
    const done = await RW.outbox.flush(app.user.id);
    if (done.length) { UI.toast(done.map((v) => v.label || v.number).join(', ') + ' saved' + (done.every((v) => v.kind === 'RECEIVED') ? '.' : ' and numbered by the server.'), 'success', { title: 'Offline vouchers synced' }); onChanged(); }
  }
  app.syncOutbox = syncOutbox;

  /* ------------------------------------------------------------ lifecycle */
  app.start = async function () {
    UI.closeAllModals();
    const root = doc.getElementById('app');
    await app.refreshMe();
    const shell = buildShell();
    UI.mount(root, shell.frag);
    app.page = shell.pageHost; app.fab = shell.fab;
    app.started = true;
    app.lastNotif = 0;
    if (RW.unsub) RW.unsub();
    RW.unsub = RW.api.onChange(() => onChanged());
    RW.netUnsub && RW.netUnsub();
    RW.netUnsub = RW.net.on(netState);
    netState();
    await app.pollNotifs(true);
    if (!location.hash || location.hash === '#/' || location.hash === '#') location.hash = '#/dashboard';
    await route();
    syncOutbox();
    if (RW.tracker) RW.tracker.start(app);        // staff: ask once, then share the live location while the app is open
  };
  app.stop = function () { if (RW.tracker) RW.tracker.stop(); app.started = false; app.user = null; app.liveCbs.clear(); if (RW.unsub) { RW.unsub(); RW.unsub = null; } if (app.current && app.current.dispose) { try { app.current.dispose(); } catch (e) { /* ignore */ } } app.current = null; closeDrop(); UI.closeAllModals(); doc.body.classList.remove('nav-open'); };
  app.showLogin = async function (notice) { app.stop(); await V.login(doc.getElementById('app'), app, notice); };
  app.logout = async function () {
    try { await RW.api.call('auth.logout', {}, { noAuthRedirect: true }); } catch (e) { /* ignore */ }
    RW.api.session.clear();
    location.hash = '';
    await app.showLogin();
    UI.toast('You have been signed out.', 'info', { ms: 2500 });
  };

  app.boot = async function () {
    app.applyTheme(RW.LS.get('rw.theme') === 'dark' ? 'dark' : 'light');
    const splash = doc.getElementById('splash');
    const sub = splash && splash.querySelector('p');
    const hideSplash = () => { if (splash) { splash.classList.add('out'); setTimeout(() => splash.remove(), 600); } };
    try {
      const cfg = g.RW_CONFIG || {};
      if (cfg.supabaseUrl && RW.supabaseAdapter) RW.api.init(await RW.supabaseAdapter(cfg));
      else if (cfg.mode === 'server') RW.api.init(RW.remoteAdapter(cfg));
      else RW.api.init(RW.demoAdapter());
      RW.api.onAuthLost = (e) => { if (app.started || !doc.querySelector('.login')) app.showLogin(e && e.message); };
      if (RW.api.kind === 'demo' && await RW.api.adapter.isEmpty()) {
        if (sub) sub.textContent = 'Preparing demo data…';
        await RW.api.adapter.seed(true);
      }
      if (RW.api.session.token) {
        try { await app.start(); } catch (e) { RW.api.session.clear(); await app.showLogin(e && e.code !== 'UNAUTHENTICATED' ? e.message : ''); }
      } else await app.showLogin();
    } catch (e) {
      console.error(e);
      UI.mount(doc.getElementById('app'), h('div', { class: 'page' }, h('div', { class: 'card' }, UI.empty('The application could not start', UI.errMsg(e), 'alert', h('button', { class: 'btn btn-primary btn-sm', style: { marginTop: '14px' }, onclick: () => location.reload() }, 'Reload')))));
    }
    hideSplash();
  };

  g.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); app.installEvent = e; });
  RW.outbox && RW.outbox.on(() => { const pill = doc.getElementById('net-pill'); void pill; });
})(typeof window !== 'undefined' ? window : globalThis);
