/* Ravi Cash — Attachments gallery, Audit logs, Notifications, Settings, Profile. */
(function (g) {
  'use strict';
  const RW = (g.RW = g.RW || {});
  const UI = RW.ui, V = RW.v;
  const { h } = UI;

  /* =========================================================== attachments */
  RW.route('/attachments', async function (root, p, app) {
    app.title('Attachments');
    let dead = false, page = 1, seq = 0;
    const q = h('input', { type: 'search', placeholder: 'File name, voucher no. or party…' });
    const branchSel = UI.select([{ value: '', label: 'All branches' }], '');
    const userSel = UI.select([{ value: '', label: 'All users' }], '');
    const grid = h('div', { class: 'att-grid att-grid-lg' }, UI.skeleton(3));
    const pagerHost = h('div');
    root.appendChild(V.pageHead('Attachments', 'Receipt and bill photos saved with vouchers. Open any photo to view it full size.'));
    root.appendChild(h('div', { class: 'bar-filters' }, UI.field('Search', q, { class: 'wide' }), app.seesAll ? UI.field('Branch', branchSel) : null, UI.field('User', userSel)));
    root.appendChild(h('div', { class: 'card' }, h('div', { class: 'card-b' }, grid, pagerHost)));

    const io = 'IntersectionObserver' in g ? new IntersectionObserver((es) => es.forEach((e) => { if (e.isIntersecting) { io.unobserve(e.target); e.target._load && e.target._load(); } }), { rootMargin: '160px' }) : null;
    async function fillUsers() {
      try { const us = await V.userOptions(app.seesAll ? branchSel.value : app.user.branchId); UI.mount(userSel, h('option', { value: '' }, 'All users'), us.map((u) => h('option', { value: u.id }, u.fullName))); } catch (e) { /* ignore */ }
    }
    if (app.seesAll) V.branchOptions(app).then((bo) => UI.mount(branchSel, bo.map((o) => h('option', { value: o.value }, o.label))));
    fillUsers();
    const reload = UI.debounce(() => { page = 1; load(); }, 240);
    q.addEventListener('input', reload); userSel.addEventListener('change', () => { page = 1; load(); });
    branchSel.addEventListener('change', async () => { await fillUsers(); page = 1; load(); });

    async function open(a) {
      try {
        const f = await RW.api.call('attachments.get', { id: a.id });
        if (f.mime === 'application/pdf') return UI.openBlob(RW.dataUrlBytes(f.dataUrl), 'application/pdf');
        UI.modal({ title: a.name + ' · ' + a.voucherNumber, size: 'lg', body: h('img', { src: f.dataUrl, alt: a.name, style: { width: '100%', borderRadius: '8px', background: '#fff' } }),
          actions: [{ label: 'Close' }, { label: 'Open voucher', icon: 'file', onClick: () => { location.hash = '#/vouchers/' + a.voucherId; } }, { label: 'Download', kind: 'primary', icon: 'download', keepOpen: true, onClick: () => { UI.download(RW.dataUrlBytes(f.dataUrl), a.name, f.mime); return false; } }] });
      } catch (e) { UI.toast(UI.errMsg(e), 'error'); }
    }
    function tile(a) {
      const pdf = a.mime === 'application/pdf';
      const t = h('button', { class: 'att' + (pdf ? ' file' : ''), type: 'button', 'aria-label': 'Open ' + a.name, onclick: () => open(a) }, pdf ? [UI.icon('file', 28), h('span', null, 'PDF')] : UI.icon('image', 26), h('span', { class: 'att-n' }, a.voucherNumber + ' · ' + a.partyName));
      t._load = async () => { try { const f = await RW.api.call('attachments.get', { id: a.id }); t.insertBefore(h('img', { src: f.dataUrl, alt: a.name, loading: 'lazy' }), t.firstChild); const ic = t.querySelector('.ico'); if (ic) ic.remove(); } catch (e) { /* placeholder stays */ } };
      if (!pdf) { if (io) io.observe(t); else t._load(); }
      return t;
    }
    async function load() {
      const my = ++seq;
      try {
        const r = await RW.api.call('attachments.list', { filters: { q: q.value.trim(), branchId: branchSel.value || undefined, userId: userSel.value || undefined }, page, pageSize: 24 });
        if (dead || my !== seq) return;
        if (!r.rows.length) { UI.mount(grid, UI.empty('No attachments', 'Photos attached to vouchers appear here.', 'image')); grid.classList.remove('att-grid'); UI.mount(pagerHost); return; }
        grid.classList.add('att-grid');
        UI.mount(grid, r.rows.map(tile));
        UI.mount(pagerHost, UI.pager(r, (n) => { page = n; load(); g.scrollTo({ top: 0, behavior: 'smooth' }); }));
      } catch (e) { if (!dead && my === seq) UI.mount(grid, V.errorCard(e, load)); }
    }
    load();
    return { dispose() { dead = true; if (io) io.disconnect(); } };
  }, { roles: ['SUPER_ADMIN', 'BRANCH_ADMIN', 'CEO', 'VIEWER'] });

  /* ====================================================== audit: voucher review */
  /* The queue an administrator works through: every payment voucher with Valid / Not valid buttons.
   * "Not valid" keeps the voucher but stops its amount counting as an expense. */
  V.reviewQueue = function (host, app, isDead) {
    const st = { filter: 'PENDING', page: 1, seq: 0 };
    const q = h('input', { type: 'search', placeholder: 'Party, particulars, user, voucher no.…', autocomplete: 'off' });
    const from = h('input', { type: 'date', max: app.today }), to = h('input', { type: 'date', max: app.today });
    const branch = UI.select([{ value: '', label: 'All branches' }], '');
    const sumHost = h('div', { class: 'review-sum' }), listHost = h('div', null, V.loading(5));
    const base = () => ({ q: q.value.trim() || undefined, from: from.value || undefined, to: to.value || undefined, branchId: branch.value || undefined });
    const fire = () => { st.page = 1; refresh(); };
    q.addEventListener('input', UI.debounce(fire, 260)); [from, to, branch].forEach((i) => i.addEventListener('change', fire));
    if (app.seesAll) V.branchOptions(app).then((o) => { UI.mount(branch, o.map((x) => h('option', { value: x.value }, x.label))); }).catch(() => {});

    host.appendChild(!app.isSuper ? h('div', { class: 'callout info', style: { marginBottom: '14px' } }, UI.icon('info', 16), h('span', null, h('b', null, 'Reviewed by the main admin: '), 'only the main (Super) admin checks payment vouchers and marks them ', h('b', null, 'Valid'), ' or ', h('b', null, 'Not valid'), '. You can see the result here. A voucher marked not valid is kept on record, but its amount is ', h('b', null, 'not counted as expense'), ' and goes back into the user\'s cash.')) : h('div', { class: 'callout info', style: { marginBottom: '14px' } }, UI.icon('info', 16), h('span', null, h('b', null, 'How it works: '), 'open a payment voucher, check the bill / photo, then mark it ', h('b', null, 'Valid'), ' or ', h('b', null, 'Not valid'), '. A voucher marked not valid is kept on record, but its amount is ', h('b', null, 'not counted as expense'), ' and goes back into the user\'s cash. You can change your decision later; every decision is logged.')));
    host.appendChild(sumHost);
    host.appendChild(h('div', { class: 'bar-filters', style: { marginTop: '14px' } }, UI.field('Search', q, { class: 'wide' }), app.seesAll ? UI.field('Branch', branch) : null, UI.field('From', from), UI.field('To', to)));
    host.appendChild(h('div', { class: 'card' }, h('div', { class: 'card-b flush' }, listHost)));

    function summary(s) {
      const card = (key, label, tone) => h('button', { type: 'button', class: st.filter === key ? 'on' : '', 'aria-pressed': st.filter === key ? 'true' : 'false', onclick: () => { st.filter = key; st.page = 1; refresh(); } },
        h('small', null, label), h('b', { class: tone || '' }, s[key].count + (s[key].count === 1 ? ' voucher' : ' vouchers')), h('span', null, RW.fmtINR(s[key].paise)));
      UI.mount(sumHost, card('PENDING', 'To review'), card('VALID', 'Valid'), card('INVALID', 'Not valid (not counted)', 'neg'));
    }
    function row(v) {
      const open = () => (location.hash = '#/vouchers/' + v.id);
      const btn = (label, icon, status, kind) => h('button', { class: 'btn btn-sm ' + (kind || 'btn-ghost'), type: 'button', onclick: (e) => { e.stopPropagation(); V.reviewDialog(v, status, refresh); } }, UI.icon(icon, 14), label);
      const acts = !app.isSuper ? [] : v.review === 'PENDING' ? [btn('Valid', 'check', 'VALID', 'btn-primary'), btn('Not valid', 'ban', 'INVALID')] : v.review === 'VALID' ? [btn('Not valid', 'ban', 'INVALID')] : [btn('Mark valid', 'check', 'VALID', 'btn-primary')];   // only the main (Super) admin reviews
      return h('tr', { class: 'click' + (v.review === 'INVALID' ? ' row-notvalid' : ''), tabindex: 0, onclick: open, onkeydown: (e) => { if (e.key === 'Enter') open(); } },
        h('td', { class: 'keep' }, V.vno(v), h('span', { class: 'sub' }, RW.fmtDate(v.date))),
        h('td', { class: 'trunc full', 'data-label': 'Paid to' }, v.partyName, h('span', { class: 'sub' }, v.particulars), h('span', { class: 'sub who' }, v.userName + ' · ' + V.branchShort(v) + (v.attachmentCount ? ' · ' : ''), v.attachmentCount ? [UI.icon('clip', 11), ' ' + v.attachmentCount + ' photo' + (v.attachmentCount > 1 ? 's' : '')] : ' · no receipt photo')),
        h('td', { class: 'num keep', 'data-label': 'Amount' }, h('span', { class: 'amt-out' + (v.review === 'INVALID' ? ' amt-struck' : '') }, '− ' + RW.fmtINR(v.amountPaise))),
        h('td', { class: 'keep', 'data-label': 'Review' }, UI.reviewBadge(v.review), v.review === 'INVALID' && v.reviewReason ? h('span', { class: 'sub' }, v.reviewReason) : v.reviewedBy ? h('span', { class: 'sub' }, 'by ' + v.reviewedBy.split(' ')[0]) : null),
        app.isSuper ? h('td', { class: 'keep', style: { textAlign: 'right' } }, h('div', { class: 'rq-acts' }, acts)) : null);
    }
    async function refresh() {
      const my = ++st.seq;
      try {
        const [s, r] = await Promise.all([
          RW.api.call('vouchers.reviewSummary', { filters: base() }),
          RW.api.call('vouchers.list', { filters: Object.assign(base(), { review: st.filter, status: 'ACTIVE' }), page: st.page, pageSize: 25, sort: st.filter === 'PENDING' ? 'date_asc' : 'created_desc' }),
        ]);
        if (isDead() || my !== st.seq) return;
        summary(s);
        UI.mount(listHost, r.rows.length
          ? [h('div', { class: 'tbl-wrap' }, h('table', { class: 'tbl rt' }, h('thead', null, h('tr', null, h('th', null, 'Voucher'), h('th', null, 'Paid to / particulars'), h('th', { class: 'num' }, 'Amount'), h('th', null, 'Review'), app.isSuper ? h('th', null, '') : null)), h('tbody', null, r.rows.map(row)))), UI.pager(r, (n) => { st.page = n; refresh(); })]
          : UI.empty(st.filter === 'PENDING' ? 'Nothing waiting for review' : 'No vouchers here', st.filter === 'PENDING' ? 'Every payment voucher has been reviewed. New vouchers will appear here.' : 'Vouchers you mark appear in this list.', 'check'));
      } catch (e) { if (!isDead() && my === st.seq) UI.mount(listHost, V.errorCard(e, refresh)); }
    }
    return { refresh };
  };

  /* ================================================================== audit */
  const ENTITIES = ['VOUCHER', 'USER', 'BRANCH', 'REGISTER', 'OUTSTANDING', 'TOUR', 'VISIT', 'SETTINGS', 'STATEMENT', 'EXPORT', 'AUTH', 'SYSTEM'];
  const ACTIONS = ['CREATE', 'EDIT', 'REVIEW', 'VOID', 'DELETE', 'PURGE', 'CLEAR', 'RESET', 'CLEAR_FAILED', 'ATTACH', 'ATTACH_REMOVED', 'PHOTO_ADDED', 'PHOTO_REMOVED', 'APPROVE', 'PDF', 'STATUS', 'PASSWORD_RESET', 'PASSWORD_CHANGED', 'GENERATE', 'SETTLE', 'CANCEL', 'EXPORT', 'LOGIN', 'LOGOUT', 'LOGIN_FAILED'];
  RW.route('/audit', async function (root, p, app) {
    app.title('Audit');
    let dead = false, page = 1, seq = 0;
    const q = h('input', { type: 'search', placeholder: 'Person, voucher no., reason…', value: p.q.entity || '' });
    const entity = UI.select([{ value: '', label: 'All records' }].concat(ENTITIES.map((e) => ({ value: e, label: e.charAt(0) + e.slice(1).toLowerCase() }))), '');
    const action = UI.select([{ value: '', label: 'All actions' }].concat(ACTIONS.map((a) => ({ value: a, label: a.replace(/_/g, ' ').toLowerCase().replace(/^./, (c) => c.toUpperCase()) }))), '');
    const from = h('input', { type: 'date', max: app.today }), to = h('input', { type: 'date', max: app.today });
    const body = h('div', null, V.loading(6));
    const verifyBox = h('div');
    const logHost = h('div'), reviewHost = h('div');
    const tab0 = p.q.entity || p.q.tab === 'log' ? 'log' : 'review'; // a voucher's "Audit" link opens the log for that voucher
    const showTab = (t) => { logHost.hidden = t !== 'log'; reviewHost.hidden = t !== 'review'; if (t === 'review') review.refresh(); };
    const tabs = UI.segmented([{ value: 'review', label: 'Voucher review', icon: 'check' }, { value: 'log', label: 'Activity log', icon: 'history' }], tab0, showTab);
    root.appendChild(V.pageHead('Audit', app.isSuper ? 'Check each payment voucher (valid or not valid) and see every change with who, when and why. History cannot be edited or deleted.' : 'See which payment vouchers the main admin has checked, and every change with who, when and why. History cannot be edited or deleted.', [app.isSuper ? h('button', { class: 'btn btn-ghost', type: 'button', onclick: (e) => verify(e.currentTarget) }, UI.icon('shield', 16), 'Verify integrity') : null]));
    root.appendChild(h('div', { style: { margin: '0 0 16px' } }, tabs));
    root.appendChild(reviewHost); root.appendChild(logHost);
    logHost.appendChild(verifyBox);
    logHost.appendChild(h('div', { class: 'bar-filters' }, UI.field('Search', q, { class: 'wide' }), UI.field('Record', entity), UI.field('Action', action), UI.field('From', from), UI.field('To', to)));
    logHost.appendChild(h('div', { class: 'card' }, h('div', { class: 'card-b flush' }, body)));
    const review = V.reviewQueue(reviewHost, app, () => dead);
    showTab(tab0);
    const reload = UI.debounce(() => { page = 1; load(); }, 240);
    q.addEventListener('input', reload); [entity, action, from, to].forEach((i) => i.addEventListener('change', () => { page = 1; load(); }));

    async function verify(btn) {
      btn.disabled = true; btn.classList.add('busy');
      try {
        const r = await RW.api.call('audit.verify', {});
        UI.mount(verifyBox, h('div', { class: 'callout ' + (r.ok ? 'ok' : 'bad'), style: { marginBottom: '16px' } }, UI.icon(r.ok ? 'shield' : 'alert', 18), h('span', null, r.ok ? h('span', null, h('b', null, 'Audit trail is intact.'), ' All ' + r.count + ' entries are chained together; none has been altered or removed.') : h('span', null, h('b', null, 'Tampering detected'), ' at entry #' + r.brokenAt + '. The chain is broken from that point.'))));
      } catch (e) { UI.toast(UI.errMsg(e), 'error'); } finally { btn.disabled = false; btn.classList.remove('busy'); }
    }
    const ICON = { CREATE: 'plus', EDIT: 'edit', REVIEW: 'check', VOID: 'ban', DELETE: 'trash', PURGE: 'trash', CLEAR: 'trash', RESET: 'alert', CLEAR_FAILED: 'alert', ATTACH: 'clip', ATTACH_REMOVED: 'x', PHOTO_ADDED: 'camera', PHOTO_REMOVED: 'camera', APPROVE: 'check', PDF: 'download', STATUS: 'user', PASSWORD_RESET: 'key', PASSWORD_CHANGED: 'key', GENERATE: 'chart', SETTLE: 'check', CANCEL: 'ban', EXPORT: 'download', LOGIN: 'logout', LOGOUT: 'logout', LOGIN_FAILED: 'alert' };
    const kvs = (o) => (o && Object.keys(o).length ? Object.keys(o).map((k) => h('div', null, h('span', { class: 'muted' }, k + ': '), typeof o[k] === 'object' ? JSON.stringify(o[k]) : String(o[k]))) : null);
    function row(a) {
      const detail = h('tr', { hidden: true }, h('td', { colspan: 5, class: 'full' }, h('div', { class: 'diff', style: { margin: '0 0 6px' } },
        a.reason ? h('div', null, h('b', null, 'Reason: '), a.reason) : null,
        a.old && Object.keys(a.old).length ? h('div', null, h('b', null, 'Before'), kvs(a.old)) : null, a.new && Object.keys(a.new).length ? h('div', null, h('b', null, 'After'), kvs(a.new)) : null,
        h('div', { class: 'muted' }, 'Entry #' + a.seq + ' · ' + (a.device || 'device unknown') + ' · hash ' + String(a.hash || '').slice(0, 16) + '…'))));
      const main = h('tr', { class: 'click', tabindex: 0, onclick: () => { detail.hidden = !detail.hidden; }, onkeydown: (e) => { if (e.key === 'Enter') detail.hidden = !detail.hidden; } },
        h('td', { class: 'keep nowrap' }, RW.fmtDateTime(a.at)),
        h('td', { class: 'full' }, h('span', { class: 'badge badge-gray' }, UI.icon(ICON[a.action] || 'clock', 12), a.action.replace(/_/g, ' ')), ' ', h('b', null, a.entityLabel || a.entityId)),
        h('td', { class: 'hide-m' }, a.actorName, h('span', { class: 'sub' }, UI.roleName(a.actorRole))), h('td', { class: 'hide-m' }, a.branchName ? V.branchShort(a) : '—'),
        h('td', { class: 'hide-m trunc', style: { maxWidth: '260px' } }, a.reason || ''));
      return [main, detail];
    }
    async function load() {
      const my = ++seq;
      body.classList.add('loading-dim');
      try {
        const r = await RW.api.call('audit.list', { filters: { q: q.value.trim(), entity: entity.value, action: action.value, from: from.value || undefined, to: to.value || undefined }, page, pageSize: 30 });
        if (dead || my !== seq) return;
        UI.mount(body, r.rows.length ? [h('div', { class: 'tbl-wrap' }, h('table', { class: 'tbl rt' }, h('thead', null, h('tr', null, h('th', null, 'When'), h('th', null, 'What'), h('th', { class: 'hide-m' }, 'Who'), h('th', { class: 'hide-m' }, 'Branch'), h('th', { class: 'hide-m' }, 'Reason'))), h('tbody', null, r.rows.map(row)))), UI.pager(r, (n) => { page = n; load(); })] : UI.empty('No entries', 'No audit entries match these filters.', 'shield'));
      } catch (e) { if (!dead && my === seq) UI.mount(body, V.errorCard(e, load)); } finally { body.classList.remove('loading-dim'); }
    }
    load(); app.live(() => { load(); if (!reviewHost.hidden) review.refresh(); });
    return { dispose() { dead = true; } };
  }, { roles: ['SUPER_ADMIN', 'BRANCH_ADMIN', 'CEO'] });

  /* ========================================================== notifications */
  RW.route('/notifications', async function (root, p, app) {
    app.title('Notifications');
    let dead = false;
    const body = h('div', null, V.loading(5));
    const markBtn = h('button', { class: 'btn btn-ghost', type: 'button', onclick: async () => { await RW.api.call('notifications.markRead', { all: true }); app.pollNotifs(true); load(); } }, UI.icon('check', 16), 'Mark all as read');
    root.appendChild(V.pageHead('Notifications', 'New vouchers, edits, voids and statements appear here as they happen.', [markBtn]));
    root.appendChild(h('div', { class: 'card' }, h('div', { class: 'card-b flush' }, body)));
    async function load() {
      try {
        const r = await RW.api.call('notifications.list', { limit: 100 });
        if (dead) return;
        markBtn.style.display = r.unread ? '' : 'none';
        UI.mount(body, r.rows.length ? h('div', { class: 'drop-list', style: { display: 'flex', flexDirection: 'column' } }, r.rows.map((n) => V.notifItem(n, async () => { if (!n.read) { await RW.api.call('notifications.markRead', { ids: [n.id] }); app.pollNotifs(true); } if (n.voucherId) location.hash = '#/vouchers/' + n.voucherId; else load(); }))) : UI.empty('You are all caught up', 'New activity will appear here instantly.', 'bell'));
        UI.$$('.item', body).forEach((el) => { el.style.cursor = 'pointer'; el.style.padding = '14px 18px'; el.style.borderBottom = '1px solid var(--line)'; });
      } catch (e) { if (!dead) UI.mount(body, V.errorCard(e, load)); }
    }
    load(); app.live(load);
    return { dispose() { dead = true; } };
  });

  /* ====================================================== clear all data (Super Admin) */
  // scope 'TRANSACTIONS' = every voucher / receipt photo / statement / outstanding entry / notification (branches and users stay)
  // scope 'EVERYTHING'   = a blank installation (in demo mode: fresh sample data)
  V.clearDataDialog = function (scope) {
    const demo = RW.api.kind === 'demo', all = scope === 'EVERYTHING';
    const sum = h('div', { class: 'callout bad' }, UI.icon('alert', 16), h('span', null, 'Counting what would be erased…'));
    const cbNum = h('input', { type: 'checkbox', checked: true }), cbOpen = h('input', { type: 'checkbox', checked: true }), cbAudit = h('input', { type: 'checkbox' });
    const pw = h('input', { type: 'password', autocomplete: 'current-password', placeholder: 'Your password' });
    const phrase = h('input', { type: 'text', autocomplete: 'off', autocapitalize: 'characters', placeholder: 'DELETE ALL' });
    const why = h('textarea', { rows: 2, maxlength: 500, placeholder: 'Optional — saved in the audit log' });
    const fPw = UI.field('Your password', pw), fPhrase = UI.field('Type DELETE ALL to confirm', phrase), fWhy = UI.field('Reason', why, { optional: true });
    const li = (n, label) => h('li', null, h('b', null, Number(n).toLocaleString('en-IN')), ' ' + label);
    RW.api.call('erase.preview', {}).then((c) => UI.mount(sum, UI.icon('alert', 16), h('div', { style: { flex: 1 } }, h('div', { style: { marginBottom: '8px', fontWeight: 600 } }, 'This will erase for good:'),
      h('ul', { class: 'danger-list' }, li(c.vouchers, 'vouchers'), li(c.attachments, 'receipt photos'), li(c.outstanding, 'outstanding entries'), li(c.statements, 'statements'), li(c.notifications, 'notifications'),
        all ? [li(c.tours, 'tour plans'), li(c.visits, 'tour meetings (with their photos)'), li(c.branches, 'branches'), li(c.users, 'users'), li(c.audit, 'audit entries'), h('li', null, 'all settings')] : null))), () => {});
    const opt = (cb, title, hint) => h('label', { class: 'opt-row' }, cb, h('span', null, title, h('small', null, hint)));
    const options = all ? null : h('div', { class: 'stack', style: { gap: '10px' } },
      opt(cbNum, 'Restart voucher numbers from 000001', 'Otherwise numbering carries on from where it is now.'),
      opt(cbOpen, 'Set every user’s opening balance back to ₹0', 'Otherwise opening balances stay as they are.'),
      opt(cbAudit, 'Also erase the audit history', 'Not recommended. The clearing itself is always recorded.'));
    const note = all
      ? (demo ? 'The demo is replaced by fresh sample data.' : 'Branches, users and settings are removed too. Afterwards the site shows the first-time setup screen, where you create your company and Super Admin again.')
      : 'Branches, users and settings stay. Everyone remains signed in.';
    const backup = demo ? 'This is demo data kept only in this browser — no backup is made.' : 'Before anything is deleted, the server saves a full backup copy (database and receipt photos) in its data/backups folder.';
    UI.modal({ title: all ? (demo ? 'Reset the demo' : 'Reset entire system') : 'Clear all transactions', size: 'md', persistent: true,
      body: h('div', { class: 'stack', style: { gap: '14px' } }, sum, h('p', { class: 'muted', style: { margin: 0, fontSize: '13px' } }, note), options,
        h('div', { class: 'callout info' }, UI.icon('shield', 16), h('span', null, backup)), fWhy, fPw, fPhrase),
      actions: [{ label: 'Cancel' }, { label: all ? (demo ? 'Reset demo' : 'Erase everything') : 'Clear all transactions', kind: 'danger', icon: 'trash', keepOpen: true, onClick: async (m) => {
        UI.fieldError(fPw, ''); UI.fieldError(fPhrase, '');
        if (!pw.value) { UI.fieldError(fPw, 'Enter your password'); return false; }
        if (phrase.value.trim() !== 'DELETE ALL') { UI.fieldError(fPhrase, 'Type DELETE ALL exactly as shown'); return false; }
        let r;
        try { r = await RW.api.call('system.clear', { scope, password: pw.value, confirm: phrase.value.trim(), reason: why.value, resetNumbers: cbNum.checked, resetOpening: cbOpen.checked, clearAudit: cbAudit.checked }); }
        catch (e) { if (/password|wrong/i.test(e.message || '')) { UI.fieldError(fPw, e.message); return false; } throw e; }
        if (all) { m.close(); RW.api.session.clear(); location.hash = ''; location.reload(); return; }   // every session is gone: start over at the login / first-time setup screen
        m.close();
        UI.toast('All transactions cleared.' + (r.backup ? ' A backup copy was saved in ' + r.backup + ' on the server.' : ''), 'success', { ms: 9000 });
        await RW.app.refreshMe(); location.hash = '#/dashboard';
      } }] });
  };

  /* ================================================================ settings */
  RW.route('/settings', async function (root, p, app) {
    app.title('Settings');
    let dead = false;
    const host = h('div', null, V.loading(6));
    root.appendChild(V.pageHead('Settings', 'Company details, voucher numbering and cash controls. Every change is recorded in the audit log.'));
    root.appendChild(host);
    const s = await RW.api.call('settings.get', {});
    if (dead) return;
    const f = (v, a) => h('input', Object.assign({ type: 'text', value: v === undefined || v === null ? '' : v }, a || {}));
    const co = s.company;
    const name = f(co.name, { maxlength: 80 }), tagline = f(co.tagline, { maxlength: 120 }), address = f(co.address, { maxlength: 250 }), phone = f(co.phone, { maxlength: 40 }), email = f(co.email, { maxlength: 80 }), gstin = f(co.gstin, { maxlength: 20 });
    const payP = f(s.numbering.PAYMENT.prefix, { maxlength: 5, style: { textTransform: 'uppercase' } }), recP = f(s.numbering.RECEIPT.prefix, { maxlength: 5, style: { textTransform: 'uppercase' } });
    const payPad = f(s.numbering.PAYMENT.pad, { inputmode: 'numeric' }), recPad = f(s.numbering.RECEIPT.pad, { inputmode: 'numeric' });
    const maxAmt = f(s.maxVoucherAmountPaise / 100, { inputmode: 'decimal' }), alertAmt = f(s.largePaymentAlertPaise / 100, { inputmode: 'decimal' }), backdate = f(s.userBackdateDays, { inputmode: 'numeric' });
    const fy = UI.select(RW.MONTHS.map((m, i) => ({ value: i + 1, label: m === 'Apr' ? 'April (India standard)' : m === 'Jan' ? 'January (calendar year)' : RW.MONTHS_LONG[i] })), s.fiscalYearStartMonth);
    const neg = h('input', { type: 'checkbox', checked: !!s.blockNegativeCash });
    const locOn = h('input', { type: 'checkbox', checked: s.locationTracking !== false }), keepDays = f(s.locationKeepDays || 30, { inputmode: 'numeric' });
    const why = h('textarea', { rows: 2, maxlength: 500, placeholder: 'Reason for this change (optional, saved in the audit log)' });
    const preview = h('b');
    const upd = () => { preview.textContent = (payP.value || '—').toUpperCase() + '-' + String(s.counters.PAYMENT + 1).padStart(parseInt(payPad.value, 10) || 6, '0') + '  /  ' + (recP.value || '—').toUpperCase() + '-' + String(s.counters.RECEIPT + 1).padStart(parseInt(recPad.value, 10) || 6, '0'); };
    [payP, recP, payPad, recPad].forEach((i) => i.addEventListener('input', upd)); upd();
    const adv = (type) => { const t = f('', { inputmode: 'numeric', placeholder: 'New counter' }); UI.modal({ title: 'Advance ' + (type === 'PAYMENT' ? 'payment' : 'receipt') + ' counter', size: 'sm', body: h('div', { class: 'stack', style: { gap: '12px' } }, h('p', { class: 'muted' }, 'Current counter: ', h('b', null, s.counters[type]), '. The counter can only move forward, so a number is never reused.'), UI.field('Next voucher will be after', t)), actions: [{ label: 'Cancel' }, { label: 'Advance', kind: 'primary', keepOpen: true, onClick: async (m) => { await RW.api.call('settings.update', { advanceCounter: { type, to: t.value } }); UI.toast('Counter advanced.', 'success'); m.close(); RW.app.go('#/settings'); location.reload(); } }] }); };

    async function save(btn) {
      btn.disabled = true; btn.classList.add('busy');
      try {
        await RW.api.call('settings.update', {
          company: { name: name.value, tagline: tagline.value, address: address.value, phone: phone.value, email: email.value, gstin: gstin.value },
          numbering: { PAYMENT: { prefix: payP.value, pad: payPad.value }, RECEIPT: { prefix: recP.value, pad: recPad.value } },
          fiscalYearStartMonth: fy.value, maxVoucherAmount: maxAmt.value.replace(/,/g, ''), largePaymentAlert: alertAmt.value.replace(/,/g, ''), userBackdateDays: backdate.value, blockNegativeCash: neg.checked, locationTracking: locOn.checked, locationKeepDays: keepDays.value, reason: why.value,
        });
        UI.toast('Settings saved.', 'success'); await RW.app.refreshMe();
      } catch (e) { UI.toast(UI.errMsg(e), e.message === 'Nothing was changed' ? 'info' : 'error'); } finally { btn.disabled = false; btn.classList.remove('busy'); }
    }
    const card = (title, sub, ...kids) => h('div', { class: 'card' }, h('div', { class: 'card-h' }, h('h3', null, title, h('small', null, sub))), h('div', { class: 'card-b' }, ...kids));
    UI.mount(host, h('div', { class: 'stack' },
      card('Company details', 'Printed on every voucher and statement', h('div', { class: 'form-grid' }, UI.field('Company name', name), UI.field('Tagline', tagline), UI.field('Address', address, { class: 'span2' }), UI.field('Phone', phone), UI.field('Email', email), UI.field('GSTIN', gstin, { optional: true }))),
      card('Voucher numbering', 'Numbers are assigned by the server, in order, and never repeat', h('div', { class: 'form-grid' }, UI.field('Payment voucher prefix', payP), UI.field('Digits', payPad), UI.field('Receipt prefix', recP), UI.field('Digits', recPad)),
        h('div', { class: 'callout info', style: { marginTop: '14px' } }, UI.icon('info', 16), h('span', null, 'Next numbers: ', preview)),
        h('div', { class: 'row', style: { gap: '8px', marginTop: '12px', flexWrap: 'wrap' } }, h('button', { class: 'btn btn-ghost btn-sm', type: 'button', onclick: () => adv('PAYMENT') }, 'Payment counter: ' + s.counters.PAYMENT + ' → advance'), h('button', { class: 'btn btn-ghost btn-sm', type: 'button', onclick: () => adv('RECEIPT') }, 'Receipt counter: ' + s.counters.RECEIPT + ' → advance'))),
      card('Cash controls', 'Limits that protect the cash registers', h('div', { class: 'form-grid' }, UI.field('Maximum voucher amount (₹)', maxAmt), UI.field('Large-payment alert from (₹)', alertAmt, { hint: 'Admins get a highlighted notification' }), UI.field('Users can back-date by (days)', backdate), UI.field('Financial year starts', fy)),
        h('label', { style: { display: 'flex', gap: '10px', alignItems: 'center', marginTop: '14px', fontSize: '13.5px' } }, neg, h('span', null, h('b', null, 'Block payments above the cash balance'), h('span', { class: 'muted' }, ' — a user cannot pay out more than the cash in their register')))),
      card('Live location', 'GPS position of staff, shown only to the main admin and the CEO on the Live Map',
        h('label', { style: { display: 'flex', gap: '10px', alignItems: 'flex-start', fontSize: '13.5px' } }, locOn, h('span', null, h('b', null, 'Staff share their live location'), h('span', { class: 'muted' }, ' — Users and Branch Admins are asked once; while they are signed in and the app is open their position is sent about once a minute, and each tour meeting saves the place it was recorded from. Switch off to stop it for everybody.'))),
        h('div', { class: 'form-grid', style: { marginTop: '14px' } }, UI.field('Keep each day\'s route for (days)', keepDays, { hint: '7 to 90. Older routes are erased automatically.' }))),
      h('div', { class: 'card' }, h('div', { class: 'card-b stack', style: { gap: '12px' } }, UI.field('Reason', why, { optional: true }), h('div', null, h('button', { class: 'btn btn-primary btn-lg', type: 'button', onclick: (e) => save(e.currentTarget) }, UI.icon('check', 18), 'Save settings')))),
      h('div', { class: 'card danger-zone' }, h('div', { class: 'card-h' }, h('h3', null, 'Danger zone', h('small', null, 'Permanent — these cannot be undone'))),
        h('div', { class: 'card-b' },
          h('div', { class: 'danger-row' }, h('div', null, h('b', null, 'Clear all transactions'), h('p', { class: 'muted' }, 'Erases every voucher, receipt photo, statement, outstanding entry and notification, for all branches. Branches, users and settings stay. Needs your password.')),
            h('button', { class: 'btn btn-ghost', type: 'button', style: { color: 'var(--bad)', flex: 'none' }, onclick: () => V.clearDataDialog('TRANSACTIONS') }, UI.icon('trash', 16), 'Clear all transactions…')),
          h('div', { class: 'danger-row' }, h('div', null, h('b', null, RW.api.kind === 'demo' ? 'Reset the demo' : 'Reset entire system'), h('p', { class: 'muted' }, RW.api.kind === 'demo' ? 'Throws away everything you added in this browser and loads fresh sample data.' : 'Erases everything — branches, users, vouchers, settings and history — and returns to the first-time setup screen.')),
            h('button', { class: 'btn btn-danger', type: 'button', style: { flex: 'none' }, onclick: () => V.clearDataDialog('EVERYTHING') }, UI.icon('trash', 16), RW.api.kind === 'demo' ? 'Reset demo…' : 'Reset entire system…'))))));
    return { dispose() { dead = true; } };
  }, { roles: ['SUPER_ADMIN'] });

  /* ================================================================= profile */
  RW.route('/profile', async function (root, p, app) {
    app.title('Profile');
    const u = app.user, forced = !!u.mustChangePassword;
    const cur = h('input', { type: 'password', autocomplete: 'current-password' }), nw = h('input', { type: 'password', autocomplete: 'new-password' }), cf = h('input', { type: 'password', autocomplete: 'new-password' });
    const strength = h('div', { class: 'pw-strength' }, h('i'), h('i'), h('i'), h('i'));
    const sLabel = h('small', { class: 'muted' }, 'At least 8 characters with letters and numbers');
    nw.addEventListener('input', () => { const v = nw.value; const sc = (v.length >= 8) + (/[A-Z]/.test(v) && /[a-z]/.test(v)) + /\d/.test(v) + /[^A-Za-z0-9]/.test(v) + 0; const n = v.length >= 8 && /[A-Za-z]/.test(v) && /\d/.test(v) ? Math.max(2, sc) : Math.min(1, sc); strength.dataset.s = v ? String(Math.min(4, n)) : '0'; sLabel.textContent = !v ? 'At least 8 characters with letters and numbers' : n >= 4 ? 'Strong password' : n >= 3 ? 'Good password' : n >= 2 ? 'Acceptable — add a symbol or capital letter to strengthen' : 'Too weak'; });
    const fCur = UI.field('Current password', cur), fNew = UI.field('New password', nw), fCf = UI.field('Confirm new password', cf);
    async function change(btn) {
      UI.fieldError(fCf, ''); UI.fieldError(fCur, '');
      if (!cur.value) return UI.fieldError(fCur, 'Enter your current password');
      if (nw.value !== cf.value) return UI.fieldError(fCf, 'The two passwords do not match');
      btn.disabled = true; btn.classList.add('busy');
      try {
        await RW.api.call('auth.changePassword', { currentPassword: cur.value, newPassword: nw.value });
        UI.toast('Password changed. Other devices were signed out.', 'success'); cur.value = nw.value = cf.value = ''; strength.dataset.s = '0';
        await app.refreshMe(); if (forced) location.hash = '#/dashboard'; else RW.app.go('#/profile');
      } catch (e) { UI.fieldError(fNew, UI.errMsg(e)); } finally { btn.disabled = false; btn.classList.remove('busy'); }
    }
    const row = (k, v) => [h('dt', null, k), h('dd', null, v || '—')];
    const themeSeg = UI.segmented([{ value: 'light', label: 'Light', icon: 'sun' }, { value: 'dark', label: 'Dark', icon: 'moon' }], app.theme, (v) => { if (v !== app.theme) app.toggleTheme(); });
    const demo = RW.api.kind === 'demo';
    const simBox = h('input', { type: 'checkbox', checked: RW.net.simulated, onchange: () => { RW.net.setSimulated(simBox.checked); UI.toast(simBox.checked ? 'Offline mode on — vouchers you save wait for sync.' : 'Back online — waiting vouchers will sync now.', simBox.checked ? 'warn' : 'success'); } });
    const installBtn = h('button', { class: 'btn btn-ghost', type: 'button', onclick: async () => { if (app.installEvent) { app.installEvent.prompt(); await app.installEvent.userChoice; app.installEvent = null; } else UI.modal({ title: 'Install on your phone', size: 'sm', body: h('div', { class: 'stack', style: { gap: '10px' } }, h('p', null, 'Open this page in Chrome on Android, tap the ⋮ menu, then choose ', h('b', null, 'Install app'), ' (or Add to Home screen). It opens full-screen like a normal app and keeps working offline.'), h('p', { class: 'muted' }, 'On iPhone: Safari → Share → Add to Home Screen.')), actions: [{ label: 'Got it', kind: 'primary' }] }); } }, UI.icon('install', 16), 'Install app');

    root.appendChild(V.pageHead('Profile', 'Your account, password and preferences.'));
    root.appendChild(h('div', { class: 'grid g2' },
      h('div', { class: 'stack' },
        forced ? h('div', { class: 'callout warn' }, UI.icon('lock', 16), h('span', null, h('b', null, 'Choose a new password to continue.'), ' You signed in with a temporary password.')) : null,
        h('div', { class: 'card' }, h('div', { class: 'card-b' }, h('div', { class: 'row', style: { gap: '14px', marginBottom: '16px', flexWrap: 'nowrap' } }, h('span', { class: 'avatar', style: { width: '56px', height: '56px', fontSize: '19px' } }, RW.initials(u.fullName)), h('div', null, h('b', { style: { fontSize: '17px' } }, u.fullName), h('div', { class: 'muted' }, UI.roleName(u.role) + (u.designation ? ' · ' + u.designation : '')))),
          h('dl', { class: 'kv' }, row('Username', u.username), row('Email', u.email), row('Mobile', u.mobile), row('Branch', app.branch && app.branch.name), row('Cash register', app.register && app.register.id), row('Joined', u.joiningDate ? RW.fmtDate(u.joiningDate) : ''), row('Last sign-in', u.lastLoginAt ? RW.fmtDateTime(u.lastLoginAt) : '')))),
        h('div', { class: 'card' }, h('div', { class: 'card-h' }, h('h3', null, 'Preferences')), h('div', { class: 'card-b stack', style: { gap: '16px' } },
          h('div', { class: 'row sb' }, h('div', null, h('b', null, 'Appearance'), h('div', { class: 'muted', style: { fontSize: '12.5px' } }, 'Vouchers always print on white paper')), themeSeg),
          h('div', { class: 'row sb' }, h('div', null, h('b', null, 'Install on your phone'), h('div', { class: 'muted', style: { fontSize: '12.5px' } }, 'Works offline, opens full-screen')), installBtn),
          demo ? h('label', { class: 'row', style: { gap: '10px', flexWrap: 'nowrap' } }, simBox, h('span', null, h('b', null, 'Simulate offline mode'), h('span', { class: 'muted' }, ' — try saving a voucher with no network; it waits for sync'))) : null,
          h('div', null, h('button', { class: 'btn btn-ghost', type: 'button', style: { color: 'var(--bad)' }, onclick: () => app.logout() }, UI.icon('logout', 16), 'Sign out'))))),
      h('div', { class: 'card' }, h('div', { class: 'card-h' }, h('h3', null, 'Change password', h('small', null, 'You will stay signed in here; other devices are signed out'))),
        h('div', { class: 'card-b stack', style: { gap: '14px' } }, fCur, fNew, strength, sLabel, fCf, h('div', null, h('button', { class: 'btn btn-primary', type: 'button', onclick: (e) => change(e.currentTarget) }, UI.icon('key', 16), 'Update password'))))));
    return {};
  });
})(typeof window !== 'undefined' ? window : globalThis);
