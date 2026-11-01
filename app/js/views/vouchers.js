/* Ravi Cash — voucher lists: "My Vouchers" (own) and "All Vouchers" (admin / viewer, filters + export). */
(function (g) {
  'use strict';
  const RW = (g.RW = g.RW || {});
  const UI = RW.ui, V = RW.v;
  const { h } = UI;

  /* ---------------------------------------------------------------- shared list engine */
  // Builds a filter bar + table + pager. `scope` = 'mine' | 'all'.
  function listPage(root, p, app, scope) {
    const all = scope === 'all';
    const st = { page: 1, pageSize: 25, sort: 'date_desc', f: { status: '', type: '', kind: '', review: '', transfer: ['ANY', 'NONE', 'PENDING'].includes(p.q.transfer) ? p.q.transfer : '', branchId: all ? (p.q.branch || '') : '', userId: '', from: '', to: '', q: '', minAmount: '', maxAmount: '' }, preset: 'all', busy: false };
    if (p.q.type === 'PAYMENT' || p.q.type === 'RECEIPT') st.f.type = p.q.type;
    if (p.q.type === 'RECEIVED') { st.f.kind = 'RECEIVED'; }
    if (p.q.review === 'PENDING' || p.q.review === 'VALID' || p.q.review === 'INVALID') st.f.review = p.q.review;
    if (p.q.status) st.f.status = p.q.status;
    let dead = false, seq = 0, branches = [], users = [];

    const mkInput = (type, attrs) => h('input', Object.assign({ type }, attrs || {}));
    const q = mkInput('search', { placeholder: 'Voucher no., party, amount, user…', autocomplete: 'off' });
    const type = UI.select([{ value: '', label: 'All types' }, { value: 'PAYMENT', label: 'Cash Payment' }, { value: 'RECEIPT', label: 'Cash Receipt' }, { value: 'RECEIVED', label: 'Cash Received' }], st.f.kind === 'RECEIVED' ? 'RECEIVED' : st.f.type);
    const transfer = UI.select([{ value: '', label: 'Everything' }, { value: 'NONE', label: 'Without branch transfers' }, { value: 'ANY', label: 'Only branch transfers' }, { value: 'PENDING', label: 'Transfers on the way' }], st.f.transfer);
    const review = UI.select([{ value: '', label: 'All' }, { value: 'PENDING', label: 'To review' }, { value: 'VALID', label: 'Valid' }, { value: 'INVALID', label: 'Not valid' }], st.f.review);
    const status = UI.select([{ value: '', label: 'Active + Void' }, { value: 'ACTIVE', label: 'Active (locked)' }, { value: 'VOID', label: 'Voided' }].concat(app.isAdmin && all ? [{ value: 'DELETED', label: 'Deleted' }] : []), st.f.status);
    const branch = UI.select([{ value: '', label: 'All branches' }], st.f.branchId);
    const user = UI.select([{ value: '', label: 'All users' }], '');
    const from = mkInput('date'), to = mkInput('date');
    const minA = mkInput('number', { placeholder: 'Min ₹', min: 0, step: '0.01', inputmode: 'decimal' }), maxA = mkInput('number', { placeholder: 'Max ₹', min: 0, step: '0.01', inputmode: 'decimal' });
    const sort = UI.select([{ value: 'date_desc', label: 'Newest date first' }, { value: 'date_asc', label: 'Oldest date first' }, { value: 'amount_desc', label: 'Amount high → low' }, { value: 'amount_asc', label: 'Amount low → high' }, { value: 'number_asc', label: 'Voucher number' }], st.sort);

    const chips = V.presetChips([{ value: 'all', label: 'All time' }].concat(V.PRESETS), 'all', (v) => {
      st.preset = v;
      if (v === 'all') { from.value = ''; to.value = ''; } else if (v !== 'custom') { const r = RW.rangeFor(v, app.today, app.settings.fiscalYearStartMonth); from.value = r.from; to.value = r.to; }
      st.page = 1; load();
    });

    const body = h('div', null, V.loading(6));
    // Super Admin: tick vouchers to erase them permanently (current page only, so nothing out of sight is ever deleted)
    const sel = all && app.isSuper ? { map: new Map(), onChange: () => drawSelBar() } : null;
    const selBar = h('div', { class: 'sel-bar', hidden: true });
    // "all N matching the filters" (every page) — only valid for the exact filters it was chosen with
    let allKey = null;
    const filterKey = () => JSON.stringify([st.f, st.last ? st.last.total : 0]);
    function drawSelBar() {
      if (allKey && allKey !== filterKey()) allKey = null;     // filters or data changed: back to normal selection
      if (!sel || (!sel.map.size && !allKey)) return UI.mount(selBar), (selBar.hidden = true);
      selBar.hidden = false;
      const last = st.last;
      if (allKey) {
        return UI.mount(selBar, UI.icon('trash', 16), h('span', null, 'All ', h('b', null, last.total), ' voucher' + (last.total === 1 ? '' : 's') + ' matching the current filters are selected'), h('span', { class: 'grow' }),
          h('button', { class: 'btn btn-ghost btn-sm', type: 'button', onclick: () => { allKey = null; sel.map.clear(); load(); } }, 'Clear selection'),
          h('button', { class: 'btn btn-danger btn-sm', type: 'button', onclick: bulkDialog }, UI.icon('trash', 14), 'Delete all ' + last.total + ' permanently'));
      }
      const pageAll = last && last.rows.length && last.rows.every((v) => sel.map.has(v.id));
      UI.mount(selBar, UI.icon('trash', 16), h('span', null, h('b', null, sel.map.size), ' voucher' + (sel.map.size === 1 ? '' : 's') + ' selected'),
        pageAll && last.total > last.rows.length ? h('button', { class: 'link', type: 'button', onclick: () => { allKey = filterKey(); drawSelBar(); } }, 'Select all ' + last.total + ' matching these filters (all pages)') : null,
        h('span', { class: 'grow' }),
        h('button', { class: 'btn btn-ghost btn-sm', type: 'button', onclick: () => { sel.map.clear(); load(); } }, 'Clear selection'),
        h('button', { class: 'btn btn-danger btn-sm', type: 'button', onclick: purgeDialog }, UI.icon('trash', 14), 'Delete permanently'));
    }
    // Delete every voucher the list shows for the current filters, across all pages. The server re-checks the count.
    function bulkDialog() {
      const last = st.last, filters = Object.assign({}, st.f), n = last.total;
      const reason = h('textarea', { rows: 2, maxlength: 500, placeholder: 'Reason (saved in the audit log)' });
      const fReason = UI.field('Reason', reason);
      const phrase = h('input', { type: 'text', placeholder: 'DELETE ALL', autocomplete: 'off', autocapitalize: 'characters' });
      const fPhrase = UI.field('Type DELETE ALL to confirm', phrase);
      const net = last.totals.movePaise !== undefined ? last.totals.movePaise : last.totals.netPaise;
      UI.modal({ title: 'Delete ' + n + ' voucher' + (n === 1 ? '' : 's') + ' permanently', size: 'sm',
        body: h('div', { class: 'stack', style: { gap: '12px' } },
          h('div', { class: 'confirm-body' }, h('div', { class: 'confirm-ic danger' }, UI.icon('trash', 22)), h('p', null, h('b', null, 'All ' + n + ' voucher' + (n === 1 ? '' : 's')), ' matching the current filters (every page, not only the ones you see) will be erased for good, with their receipt photos, and removed from every cash register (net effect on cash: ' + RW.fmtINR(Math.abs(net)) + (net < 0 ? ' more' : ' less') + '). Voucher numbers are not reused. A short summary stays in the audit log.')),
          fReason, fPhrase),
        actions: [{ label: 'Cancel' }, { label: 'Delete all ' + n, kind: 'danger', icon: 'trash', keepOpen: true, onClick: async (m) => {
          UI.fieldError(fReason, ''); UI.fieldError(fPhrase, '');
          if (reason.value.trim().length < 5) { UI.fieldError(fReason, 'Enter a reason (at least 5 characters)'); return false; }
          if (phrase.value.trim() !== 'DELETE ALL') { UI.fieldError(fPhrase, 'Type DELETE ALL exactly'); return false; }
          const r = await RW.api.call('vouchers.purge', { filters, expectCount: n, confirm: 'DELETE ALL', reason: reason.value.trim() });
          allKey = null; sel.map.clear(); m.close(); UI.toast(r.removed + ' voucher' + (r.removed === 1 ? '' : 's') + ' deleted permanently.', 'success'); st.page = 1; load();
        } }] });
    }
    function purgeDialog() {
      const rows = Array.from(sel.map.values());
      const reason = h('textarea', { rows: 2, maxlength: 500, placeholder: 'Reason (saved in the audit log)' });
      const fReason = UI.field('Reason', reason);
      const ack = h('input', { type: 'checkbox' });
      const money = rows.filter((v) => v.counted).reduce((a, v) => a + (v.type === 'RECEIPT' ? v.amountPaise : -v.amountPaise), 0);
      UI.modal({ title: 'Delete ' + rows.length + ' voucher' + (rows.length === 1 ? '' : 's') + ' permanently', size: 'sm',
        body: h('div', { class: 'stack', style: { gap: '12px' } },
          h('div', { class: 'confirm-body' }, h('div', { class: 'confirm-ic danger' }, UI.icon('trash', 22)), h('p', null, h('b', null, rows.slice(0, 4).map((v) => v.label).join(', ') + (rows.length > 4 ? ' and ' + (rows.length - 4) + ' more' : '')),
            ' will be erased for good, with their receipt photos, and removed from every cash register (net effect on cash: ' + RW.fmtINR(Math.abs(money)) + (money < 0 ? ' less' : ' more') + '). Voucher numbers are not reused. Only a short record of what was erased stays in the audit log.')),
          fReason, h('label', { class: 'opt-row' }, ack, h('span', null, 'I understand this cannot be undone'))),
        actions: [{ label: 'Cancel' }, { label: 'Delete permanently', kind: 'danger', icon: 'trash', keepOpen: true, onClick: async (m) => {
          UI.fieldError(fReason, '');
          if (reason.value.trim().length < 5) { UI.fieldError(fReason, 'Enter a reason (at least 5 characters)'); return false; }
          if (!ack.checked) { UI.toast('Tick the box to confirm', 'error'); return false; }
          const r = await RW.api.call('vouchers.purge', { ids: rows.map((v) => v.id), reason: reason.value });
          sel.map.clear(); m.close(); UI.toast(r.removed + ' voucher' + (r.removed === 1 ? '' : 's') + ' deleted permanently.', 'success'); load();
        } }] });
    }
    const summary = h('div', { class: 'row', style: { gap: '18px', flexWrap: 'wrap', fontSize: '13px', color: 'var(--ink-2)' } });
    const offlineBox = h('div');

    const bar = h('div', { class: 'bar-filters' },
      UI.field('Search', q, { class: 'wide' }),
      UI.field('Type', type),
      UI.field('Branch transfers', transfer),
      UI.field('Status', status),
      all ? UI.field('Audit review', review) : null,
      all && app.seesAll ? UI.field('Branch', branch) : null,
      all && app.mgmt ? UI.field('User', user) : null,
      UI.field('From', from), UI.field('To', to),
      UI.field('Amount from', minA), UI.field('Amount to', maxA),
      UI.field('Sort', sort),
      h('button', { class: 'btn btn-ghost btn-sm', type: 'button', style: { height: '38px' }, onclick: reset }, UI.icon('x', 14), 'Clear'));

    const syncF = () => {
      st.f.q = q.value.trim(); st.f.type = type.value === 'RECEIVED' ? '' : type.value; st.f.kind = type.value === 'RECEIVED' ? 'RECEIVED' : type.value === 'RECEIPT' ? 'VOUCHER' : ''; st.f.review = review.value; st.f.transfer = transfer.value; st.f.status = status.value; st.f.branchId = branch.value; st.f.userId = user.value;
      st.f.from = from.value; st.f.to = to.value; st.f.minAmount = minA.value; st.f.maxAmount = maxA.value; st.sort = sort.value;
    };
    function reset() {
      [q, from, to, minA, maxA].forEach((i) => { i.value = ''; }); type.value = ''; transfer.value = ''; review.value = ''; status.value = ''; branch.value = ''; user.value = ''; sort.value = 'date_desc';
      chips.set('all'); st.preset = 'all'; st.page = 1; load();
    }
    const refilter = UI.debounce(() => { st.page = 1; load(); }, 260);
    q.addEventListener('input', refilter);
    [type, transfer, review, status, user, sort, minA, maxA].forEach((i) => i.addEventListener('change', () => { st.page = 1; load(); }));
    [from, to].forEach((i) => i.addEventListener('change', () => { chips.set('custom'); st.preset = 'custom'; st.page = 1; load(); }));
    branch.addEventListener('change', async () => { await fillUsers(); st.page = 1; load(); });

    async function fillUsers() {
      if (!(all && app.mgmt)) return;
      try { users = await V.userOptions(branch.value || (app.seesAll ? '' : app.user.branchId)); } catch (e) { users = []; }
      const cur = user.value;
      UI.mount(user, h('option', { value: '' }, 'All users'), users.map((u) => h('option', { value: u.id }, u.fullName)));
      user.value = users.some((u) => u.id === cur) ? cur : '';
    }

    async function load() {
      if (dead) return;
      syncF();
      const my = ++seq;
      body.classList.add('loading-dim');
      try {
        const r = await RW.api.call('vouchers.list', { filters: scope === 'mine' ? Object.assign({}, st.f, { userId: app.user.id }) : st.f, page: st.page, pageSize: st.pageSize, sort: st.sort });
        if (my !== seq || dead) return;
        st.last = r;
        UI.mount(summary,
          h('span', null, h('b', null, r.total), ' voucher' + (r.total === 1 ? '' : 's')),
          h('span', { class: 'amt-in' }, 'In ', h('b', null, RW.fmtINR(r.totals.inPaise))),
          h('span', { class: 'amt-out' }, 'Out ', h('b', null, RW.fmtINR(r.totals.outPaise))),
          h('span', null, 'Net ', h('b', { class: r.totals.netPaise < 0 ? 'neg' : '' }, RW.fmtINR(r.totals.netPaise))),
          r.totals.xInPaise || r.totals.xOutPaise ? h('span', { class: 'amt-xfer', title: 'Money moved between branches: not counted as income or expense' }, UI.icon('swap', 13), ' Transfers in ', h('b', null, RW.fmtINR(r.totals.xInPaise)), ' · out ', h('b', null, RW.fmtINR(r.totals.xOutPaise))) : null,
          r.totals.notValidCount ? h('span', { class: 'sub bad', title: 'Marked not valid in the audit review — shown, but not counted as expense' }, UI.icon('ban', 13), ' ' + RW.fmtINR(r.totals.notValidPaise) + ' not counted (' + r.totals.notValidCount + ' not valid)') : null);
        if (sel) { for (const id of Array.from(sel.map.keys())) if (!r.rows.some((v) => v.id === id)) sel.map.delete(id); sel.map.forEach((_, id) => sel.map.set(id, r.rows.find((v) => v.id === id))); }
        UI.mount(body, r.rows.length
          ? [V.voucherTable(r.rows, { showUser: all && app.mgmt, showBranch: all && app.seesAll, select: sel }), UI.pager(r, (n) => { st.page = n; load(); g.scrollTo({ top: 0, behavior: 'smooth' }); })]
          : UI.empty('No vouchers match', 'Try clearing a filter or widening the date range.', 'file', h('button', { class: 'btn btn-ghost btn-sm', style: { marginTop: '12px' }, onclick: reset }, 'Clear filters')));
        drawSelBar();
      } catch (e) { if (my === seq) UI.mount(body, V.errorCard(e, load)); } finally { body.classList.remove('loading-dim'); }
    }

    async function drawOutbox() {
      if (scope !== 'mine') return;
      const items = await RW.outbox.list(app.user.id);
      if (!items.length) return UI.mount(offlineBox);
      UI.mount(offlineBox, h('div', { class: 'card', style: { marginBottom: '16px', borderColor: 'var(--warn)' } },
        h('div', { class: 'card-h' }, h('h3', null, UI.icon('wifioff', 16), ' Waiting for sync (' + items.length + ')'), h('button', { class: 'btn btn-ghost btn-sm', onclick: async () => { await app.syncOutbox(); drawOutbox(); load(); } }, UI.icon('refresh', 14), 'Sync now')),
        h('div', { class: 'card-b flush' }, items.map((it) => h('div', { class: 'pend-item' },
          h('div', { class: 'pend-main' }, h('span', { class: 'pend' }, UI.icon('clock', 13), 'OFFLINE — WAITING FOR SYNC'),
            h('b', null, it.payload.partyName), h('span', { class: 'sub' }, it.payload.particulars || (it.payload.kind === 'RECEIVED' ? 'Cash received' : '')),
            h('span', { class: 'sub' }, it.payload.kind === 'RECEIVED' ? 'Cash received entry — no voucher number' : 'Number is assigned when it reaches the server'),
            it.error ? h('span', { class: 'amt-out', style: { fontSize: '12px' } }, it.error) : null),
          h('div', { class: 'pend-side' }, h('span', { class: it.payload.type === 'RECEIPT' || it.payload.kind === 'RECEIVED' ? 'amt-in' : 'amt-out' }, RW.fmtINR(RW.toPaise(it.payload.amount))),
            h('button', { class: 'btn btn-ghost btn-sm', type: 'button', onclick: async () => { if (await UI.confirm({ title: 'Discard this draft?', message: 'It has not reached the server yet and will be removed from this device.', ok: 'Discard', tone: 'danger', icon: 'trash' })) { await RW.outbox.remove(app.user.id, it.id); drawOutbox(); } } }, 'Discard')))))));
    }

    /* ---- export (admin) */
    const exportMenu = app.isAdmin && all ? h('div', { class: 'acts' }, [['csv', 'CSV'], ['xlsx', 'Excel'], ['pdf', 'PDF']].map(([k, label]) => h('button', { class: 'btn btn-ghost btn-sm', type: 'button', onclick: (e) => doExport(k, e.currentTarget) }, UI.icon('download', 14), label))) : null;
    async function doExport(kind, btn) {
      syncF();
      btn.disabled = true; btn.classList.add('busy');
      try {
        const r = await RW.api.call('export.vouchers', { filters: st.f });
        const stamp = RW.today().replace(/-/g, '');
        const scopeName = st.f.branchId ? V.branchShort(branches.find((b) => b.id === st.f.branchId) || {}) : (app.seesAll ? 'All branches' : app.branch.name);
        const period = (st.f.from ? RW.fmtDate(st.f.from) : 'Beginning') + ' to ' + (st.f.to ? RW.fmtDate(st.f.to) : RW.fmtDate(app.today));
        if (kind === 'csv') UI.download(RW.buildCsv(RW.VOUCHER_COLUMNS, r.rows), 'vouchers-' + stamp + '.csv', 'text/csv;charset=utf-8');
        else if (kind === 'xlsx') {
          UI.download(await RW.buildXlsx([{ name: 'Vouchers', title: 'Voucher Register — Ravi Water Flow Pump', subtitle: ['Scope: ' + scopeName, 'Period: ' + period, 'Generated by ' + r.generatedBy + ' on ' + RW.fmtDateTime(r.generatedAt)], columns: RW.VOUCHER_COLUMNS, rows: r.rows, totals: { label: 'TOTAL', sum: ['cashIn', 'cashOut', 'transferIn', 'transferOut'] } }]),
            'vouchers-' + stamp + '.xlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        } else {
          await RW.loadFonts();
          const m = (p) => RW.fmtINR2(p, { symbol: false });
          UI.download(await RW.buildTableDoc({
            title: 'Voucher Register', subtitle: 'Filters applied', landscape: true, company: app.settings.company,
            identity: [{ label: 'Scope', value: scopeName }, { label: 'Period', value: period }, { label: 'Generated for', value: app.user.fullName, sub: UI.roleName(app.user.role) }],
            cards: [{ label: 'Entries counted', value: String(r.totals.count) + (r.totals.notValidCount ? ' (+' + r.totals.notValidCount + ' not valid)' : '') }, { label: 'Cash Inflow', value: '₹' + m(r.totals.inPaise), tone: 'in' }, { label: 'Cash Outflow', value: '₹' + m(r.totals.outPaise), tone: 'out' }, { label: 'Net', value: '₹' + m(r.totals.netPaise), tone: 'accent' }].concat(r.totals.xInPaise || r.totals.xOutPaise ? [{ label: 'Transfers in / out (not counted)', value: '₹' + m(r.totals.xInPaise) + ' / ₹' + m(r.totals.xOutPaise) }] : []),
            columns: [{ label: 'Voucher No.', w: 24 }, { label: 'Date', w: 22 }, { label: 'Branch', w: 34, wrap: true }, { label: 'User', w: 30, wrap: true }, { label: 'Party', w: 52, wrap: true }, { label: 'Particulars', w: 56, wrap: true }, { label: 'Cash In (₹)', w: 26, align: 'right' }, { label: 'Cash Out (₹)', w: 26, align: 'right' }, { label: 'Transfer (₹)', w: 26, align: 'right' }, { label: 'Status', w: 16 }, { label: 'Audit review', w: 20 }],
            rows: r.rows.map((v) => ({ cells: [v.number, RW.fmtDate(v.date), v.branchCode ? v.branchCode.charAt(0) + v.branchCode.slice(1).toLowerCase() : v.branch, v.user, v.party, v.particulars, v.cashIn ? RW.fmtINR2(Math.round(v.cashIn * 100), { symbol: false }) : '', v.cashOut ? RW.fmtINR2(Math.round(v.cashOut * 100), { symbol: false }) : '', v.transferIn ? '+ ' + RW.fmtINR2(Math.round(v.transferIn * 100), { symbol: false }) : v.transferOut ? '− ' + RW.fmtINR2(Math.round(v.transferOut * 100), { symbol: false }) : '', v.status, v.review], colors: v.status === 'VOID' || v.review === 'Not valid' ? Array(11).fill('#98A4B3') : [null, null, null, null, null, null, RW.COLORS.inflow, RW.COLORS.outflow, null, null, null] })),
            generatedBy: r.generatedBy, generatedAt: r.generatedAt, branchName: app.branch.name,
          }), 'vouchers-' + stamp + '.pdf', 'application/pdf');
        }
        UI.toast('Export ready — ' + r.rows.length + ' vouchers, filters applied.', 'success');
      } catch (e) { UI.toast(UI.errMsg(e), 'error'); } finally { btn.disabled = false; btn.classList.remove('busy'); }
    }

    root.appendChild(V.pageHead(all ? (app.isAdmin ? 'All Vouchers' : 'Vouchers') : 'My Vouchers', all ? (app.seesAll ? 'Every voucher across all branches' : 'Vouchers of ' + app.branch.name) : 'Your cash payment vouchers and cash receipts · register ' + (app.register ? app.register.id : ''),
      [exportMenu, app.canCreate ? h('a', { class: 'btn btn-ghost', href: '#/vouchers/new?type=RECEIVED' }, UI.icon('wallet', 16), 'Cash Received') : null, app.canCreate ? h('a', { class: 'btn btn-accent', href: '#/vouchers/new' }, UI.icon('plus', 16), 'Create Voucher') : null]));
    root.appendChild(offlineBox);
    root.appendChild(h('div', { style: { marginBottom: '12px' } }, chips.el));
    root.appendChild(bar);
    root.appendChild(h('div', { class: 'card' }, h('div', { class: 'card-h', style: { paddingBottom: '10px' } }, summary), selBar, h('div', { class: 'card-b flush' }, body)));

    (async () => {
      if (all && app.seesAll) { try { branches = (await RW.api.call('branches.list', {})).rows; UI.mount(branch, h('option', { value: '' }, 'All branches'), branches.map((b) => h('option', { value: b.id }, V.branchShort(b) + ' — ' + b.name))); branch.value = st.f.branchId; } catch (e) { /* ignore */ } }
      await fillUsers();
      await drawOutbox();
      load();
    })();
    const offOutbox = RW.outbox.on(drawOutbox);
    app.live(() => { drawOutbox(); load(); });
    return { dispose() { dead = true; offOutbox(); } };
  }

  RW.route('/vouchers', async (root, p, app) => { app.title('My Vouchers'); return listPage(root, p, app, 'mine'); }, { roles: ['USER', 'BRANCH_ADMIN', 'SUPER_ADMIN'] });
  RW.route('/all-vouchers', async (root, p, app) => { app.title('All Vouchers'); return listPage(root, p, app, 'all'); }, { roles: ['SUPER_ADMIN', 'BRANCH_ADMIN', 'CEO', 'VIEWER'] });
})(typeof window !== 'undefined' ? window : globalThis);
