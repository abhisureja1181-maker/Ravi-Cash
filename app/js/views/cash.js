/* Ravi Cash — cash registers and statements.
 * Register = opening + cash in − cash out, with a running balance after every voucher. */
(function (g) {
  'use strict';
  const RW = (g.RW = g.RW || {});
  const UI = RW.ui, V = RW.v;
  const { h } = UI;

  const NAMES = { DAY: 'Daily', WEEK: 'Weekly', MONTH: 'Monthly', YEAR: 'Yearly', CUSTOM: 'Custom' };
  const money = (p) => RW.fmtINR2(p, { symbol: false });

  /* ---------- identity block: STATEMENT OF / BRANCH / PERIOD / CASH REGISTER */
  V.idBlock = (items) => h('div', { class: 'idblock' }, items.map((it) => h('div', null, h('small', null, it.label), h('b', null, it.value || '—'), it.sub ? h('span', null, it.sub) : null)));

  V.cashCards = (r) => h('div', { class: 'grid g-kpi5' },
    V.kpi({ label: 'Opening Balance', icon: 'wallet', money: true, signed: true, value: r.openingPaise, sub: 'Brought forward' }),
    V.kpi({ label: 'Cash Inflow', icon: 'inflow', tone: 'in', money: true, value: r.inPaise, sub: r.receivedPaise ? 'incl. ' + RW.fmtINR(r.receivedPaise) + ' cash received' : 'Receipts' }),
    V.kpi({ label: 'Cash Outflow', icon: 'outflow', tone: 'out', money: true, value: r.outPaise, sub: r.notValidCount ? 'Payments · ' + r.notValidCount + ' not valid (' + RW.fmtINR(r.notValidPaise) + ' not counted)' : 'Payments' }),
    V.kpi({ label: 'Closing Balance', icon: 'rupee', hero: true, money: true, signed: true, value: r.closingPaise, sub: 'Opening + In − Out' }),
    V.kpi({ label: 'Entries', icon: 'file', value: r.count, sub: [r.voidedCount ? r.voidedCount + ' voided' : '', r.notValidCount ? r.notValidCount + ' not valid' : ''].filter(Boolean).join(' · ') + ([r.voidedCount, r.notValidCount].some(Boolean) ? ' (excluded)' : 'No voided vouchers') }));

  /* ---------- running-balance table (lazy: renders in chunks of 100) */
  V.cashTable = function (r, o) {
    o = o || {};
    const CH = 100;
    let shown = 0;
    const body = h('tbody');
    const more = h('div', { style: { textAlign: 'center', padding: '12px' } });
    const row = (x) => h('tr', { class: 'click', tabindex: 0, onclick: () => (location.hash = '#/vouchers/' + x.id), onkeydown: (e) => { if (e.key === 'Enter') location.hash = '#/vouchers/' + x.id; } },
      h('td', { class: 'keep nowrap' }, V.vno(x), h('span', { class: 'sub' }, RW.fmtDate(x.date))),
      h('td', { class: 'hide-m nowrap' }, UI.typeBadge(x.type, x.kind)),
      h('td', { class: 'trunc full', 'data-label': x.type === 'RECEIPT' ? 'Received from' : 'Paid to' }, x.partyName, h('span', { class: 'sub' }, x.particulars)),
      h('td', { class: 'num', 'data-label': 'Cash in' }, x.inPaise ? h('span', { class: 'amt-in' }, money(x.inPaise)) : h('span', { class: 'muted' }, '–')),
      h('td', { class: 'num', 'data-label': 'Cash out' }, x.notValid ? h('span', { class: 'sub bad' }, 'Not valid · ', h('s', null, money(x.amountPaise))) : x.outPaise ? h('span', { class: 'amt-out' }, money(x.outPaise)) : h('span', { class: 'muted' }, '–')),
      h('td', { class: 'num keep', 'data-label': 'Balance' }, h('b', { class: x.balancePaise < 0 ? 'neg' : '' }, money(x.balancePaise))));
    const next = () => {
      r.rows.slice(shown, shown + CH).forEach((x) => body.appendChild(row(x)));
      shown = Math.min(r.rows.length, shown + CH);
      UI.mount(more, shown < r.rows.length ? h('button', { class: 'btn btn-ghost btn-sm', type: 'button', onclick: next }, 'Show next ' + Math.min(CH, r.rows.length - shown) + ' of ' + (r.rows.length - shown) + ' remaining') : null);
    };
    const open = h('tr', { class: 'total' }, h('td', { colspan: 3, class: 'full' }, 'Opening balance · ' + RW.fmtDate(r.from)), h('td', { class: 'num hide-m' }), h('td', { class: 'num hide-m' }), h('td', { class: 'num', 'data-label': 'Balance' }, money(r.openingPaise)));
    const close = h('tr', { class: 'total' }, h('td', { colspan: 3, class: 'full' }, 'Closing balance · ' + RW.fmtDate(r.to) + ' · ' + r.count + ' entr' + (r.count === 1 ? 'y' : 'ies')), h('td', { class: 'num', 'data-label': 'Cash in' }, h('span', { class: 'amt-in' }, money(r.inPaise))), h('td', { class: 'num', 'data-label': 'Cash out' }, h('span', { class: 'amt-out' }, money(r.outPaise))), h('td', { class: 'num', 'data-label': 'Balance' }, h('b', { class: r.closingPaise < 0 ? 'neg' : '' }, money(r.closingPaise))));
    body.appendChild(open);
    const holder = h('div');
    const tbl = h('table', { class: 'tbl rt' },
      h('thead', null, h('tr', null, h('th', null, 'Voucher'), h('th', { class: 'hide-m' }, 'Type'), h('th', null, 'Party / Particulars'), h('th', { class: 'num' }, 'Cash In ₹'), h('th', { class: 'num' }, 'Cash Out ₹'), h('th', { class: 'num' }, 'Balance ₹'))), body);
    holder.appendChild(h('div', { class: 'tbl-wrap' }, tbl));
    holder.appendChild(more);
    if (!r.rows.length) body.appendChild(h('tr', null, h('td', { colspan: 6, class: 'full' }, h('div', { class: 'empty', style: { padding: '26px' } }, h('p', null, 'No vouchers in this period.')))));
    next();
    // closing row is appended after the last chunk, so it stays at the bottom
    const tfoot = h('tfoot', null, close); tbl.appendChild(tfoot);
    return holder;
  };

  /* ---------- download a numbered statement PDF (also logged in statement history) */
  V.statementPdf = async function (app, st, open) {
    await RW.loadFonts();
    const bytes = await RW.buildStatementPdf(st);
    const name = UI.safeName((st.user.username || 'statement') + '_' + st.period.from + '_' + st.period.to) + '.pdf';
    if (open) UI.openBlob(bytes, 'application/pdf'); else UI.download(bytes, name, 'application/pdf');
  };
  V.generateStatement = async function (app, params) { return RW.api.call('statements.generate', params); };

  const statementView = (st) => h('div', { class: 'stack' },
    h('div', { class: 'card' }, h('div', { class: 'card-h' }, h('h3', null, 'Statement ', h('span', { class: 'muted' }, st.number), h('small', null, NAMES[st.period.type] + ' · generated ' + RW.fmtDateTime(st.generatedAt) + ' by ' + st.generatedBy.fullName))),
      h('div', { class: 'card-b' }, V.idBlock([
        { label: 'Statement of', value: st.user.fullName, sub: st.user.designation || '' }, { label: 'Branch', value: st.branch ? st.branch.name : '' },
        { label: 'Period', value: st.period.label }, { label: 'Cash register', value: st.register.id, sub: st.user.username }]))),
    V.cashCards(st),
    h('div', { class: 'card' }, h('div', { class: 'card-b flush' }, V.cashTable(st))));

  /* ============================================================ #/register */
  RW.route('/register', async function (root, p, app) {
    app.title('Cash Register');
    const targetId = p.q.user || (app.role === 'USER' || (app.register && !app.mgmt) ? app.user.id : null);
    if (targetId) return registerDetail(root, p, app, targetId);
    return registerList(root, p, app);
  });

  function registerList(root, p, app) {
    let dead = false, branch = '';
    const host = h('div', null, V.loading(6));
    const sum = h('div', { class: 'grid g-kpi5' });
    const bsel = UI.select([{ value: '', label: 'All branches' }], '');
    root.appendChild(V.pageHead('Cash Registers', 'One register per user. Balance = opening + cash in − cash out.',
      [app.seesAll ? UI.field('', bsel) : null, app.register ? h('a', { class: 'btn btn-accent', href: '#/register?user=' + app.user.id }, UI.icon('wallet', 16), 'My register') : null]));
    root.appendChild(sum); root.appendChild(h('div', { style: { height: '16px' } })); root.appendChild(h('div', { class: 'card' }, h('div', { class: 'card-b flush' }, host)));
    bsel.addEventListener('change', () => { branch = bsel.value; load(); });
    (async () => { if (app.seesAll) { const bo = await V.branchOptions(app); UI.mount(bsel, bo.map((o) => h('option', { value: o.value }, o.label))); } })();
    async function load() {
      try {
        const r = await RW.api.call('registers.list', {});
        if (dead) return;
        const rows = r.rows.filter((x) => !branch || x.branchId === branch);
        const t = rows.reduce((a, x) => ({ bal: a.bal + x.balancePaise, i: a.i + x.inPaise, o: a.o + x.outPaise, n: a.n + x.voucherCount, rc: a.rc + (x.receivedPaise || 0) }), { bal: 0, i: 0, o: 0, n: 0, rc: 0 });
        UI.mount(sum, V.kpi({ label: 'Total Cash in Hand', icon: 'wallet', hero: true, money: true, signed: true, value: t.bal, sub: rows.length + ' registers' }), V.kpi({ label: 'Total Inflow', icon: 'inflow', tone: 'in', money: true, value: t.i, sub: t.rc ? 'incl. ' + RW.fmtINR(t.rc) + ' cash received' : 'All time' }), V.kpi({ label: 'Total Outflow', icon: 'outflow', tone: 'out', money: true, value: t.o, sub: 'All time' }), V.kpi({ label: 'Entries', icon: 'file', value: t.n, sub: 'Counted only (not valid / void excluded)' }));
        UI.mount(host, rows.length ? h('div', { class: 'tbl-wrap' }, h('table', { class: 'tbl rt' },
          h('thead', null, h('tr', null, h('th', null, 'Register'), h('th', null, 'User'), h('th', { class: 'hide-m' }, 'Branch'), h('th', { class: 'num hide-m' }, 'Opening'), h('th', { class: 'num hide-m' }, 'Cash received'), h('th', { class: 'num hide-m' }, 'In'), h('th', { class: 'num hide-m' }, 'Out'), h('th', { class: 'num' }, 'Balance'))),
          h('tbody', null, rows.map((x) => h('tr', { class: 'click', tabindex: 0, onclick: () => (location.hash = '#/register?user=' + x.userId), onkeydown: (e) => { if (e.key === 'Enter') location.hash = '#/register?user=' + x.userId; } },
            h('td', { class: 'keep' }, h('span', { class: 'vno' }, x.id), h('span', { class: 'sub' }, x.voucherCount + ' entries' + (x.notValidPaise ? ' · ' + RW.fmtINR(x.notValidPaise) + ' not valid' : ''))),
            h('td', { class: 'full' }, x.userName, h('span', { class: 'sub' }, UI.roleName(x.role))),
            h('td', { class: 'hide-m' }, V.branchShort(x)),
            h('td', { class: 'num hide-m' }, money(x.openingPaise)), h('td', { class: 'num hide-m' }, x.receivedPaise ? money(x.receivedPaise) : h('span', { class: 'muted' }, '–')), h('td', { class: 'num hide-m' }, h('span', { class: 'amt-in' }, money(x.inPaise))), h('td', { class: 'num hide-m' }, h('span', { class: 'amt-out' }, money(x.outPaise))),
            h('td', { class: 'num keep' }, h('b', { class: x.balancePaise < 0 ? 'neg' : '' }, RW.fmtINR(x.balancePaise)))))))) : UI.empty('No registers', 'Registers are created together with user accounts.', 'wallet'));
      } catch (e) { if (!dead) UI.mount(host, V.errorCard(e, load)); }
    }
    load(); app.live(load);
    return { dispose() { dead = true; } };
  }

  async function registerDetail(root, p, app, userId) {
    let dead = false, preset = 'month', data = null, seq = 0;
    const r0 = RW.rangeFor('month', app.today, app.settings.fiscalYearStartMonth);
    const from = h('input', { type: 'date', value: r0.from, max: app.today, style: { width: '152px' } }), to = h('input', { type: 'date', value: r0.to, max: app.today, style: { width: '152px' } });
    const chips = V.presetChips(V.PRESETS.concat([{ value: 'all', label: 'All time' }]), 'month', (v) => {
      preset = v;
      if (v !== 'custom') { const r = RW.rangeFor(v, app.today, app.settings.fiscalYearStartMonth); from.value = r.from; to.value = r.to; }
      load();
    });
    [from, to].forEach((i) => i.addEventListener('change', () => { chips.set('custom'); preset = 'custom'; if (from.value && to.value && from.value <= to.value) load(); }));
    const idHost = h('div'), cardsHost = h('div'), tableHost = h('div', { class: 'card' }, h('div', { class: 'card-b' }, UI.skeleton(6)));
    const acts = h('div', { class: 'acts' });
    const head = h('div');
    root.appendChild(head);
    root.appendChild(h('div', { class: 'stack' },
      h('div', { class: 'row sb', style: { flexWrap: 'wrap', gap: '12px' } }, chips.el, h('div', { class: 'row', style: { gap: '8px' } }, from, h('span', { class: 'muted' }, 'to'), to)),
      idHost, cardsHost, tableHost));

    async function load() {
      if (dead) return;
      const my = ++seq;
      try {
        const r = await RW.api.call('register.get', { userId, from: from.value, to: to.value });
        if (dead || my !== seq) return;
        data = r;
        const self = r.user.id === app.user.id;
        UI.mount(head, V.pageHead(self ? 'My Cash Register' : r.user.fullName + ' — Cash Register', r.register.id + ' · ' + (r.branch ? r.branch.name : ''), acts, app.mgmt ? { href: '#/register' + (p.q.user && self && !app.mgmt ? '' : ''), label: 'All registers' } : null));
        UI.mount(acts,
          h('button', { class: 'btn btn-accent', type: 'button', onclick: (e) => makePdf(e.currentTarget) }, UI.icon('download', 16), 'Statement PDF'),
          h('a', { class: 'btn btn-ghost', href: '#/statements?user=' + r.user.id + '&from=' + r.from + '&to=' + r.to }, UI.icon('chart', 16), 'Statements'),
          app.isSuper ? h('button', { class: 'btn btn-ghost', type: 'button', onclick: () => setOpening(r) }, UI.icon('edit', 16), 'Opening balance') : null);
        UI.mount(idHost, h('div', { class: 'card' }, h('div', { class: 'card-b' }, V.idBlock([{ label: 'Register of', value: r.user.fullName, sub: r.user.designation || '' }, { label: 'Branch', value: r.branch ? r.branch.name : '' }, { label: 'Period', value: RW.fmtDate(r.from) + ' – ' + RW.fmtDate(r.to) }, { label: 'Cash register', value: r.register.id, sub: 'Balance now ' + RW.fmtINR(r.currentBalancePaise) }]))));
        UI.mount(cardsHost, V.cashCards(r));
        UI.mount(tableHost, h('div', { class: 'card-b flush' }, V.cashTable(r)));
        app.title(r.register.id + ' register');
      } catch (e) { if (!dead && my === seq) { UI.mount(head, V.pageHead('Cash Register', null, null, app.mgmt ? { href: '#/register', label: 'All registers' } : null)); UI.mount(tableHost, V.errorCard(e, load)); } }
    }
    async function makePdf(btn) {
      btn.disabled = true; btn.classList.add('busy');
      try { const st = await V.generateStatement(app, { userId, period: 'CUSTOM', from: from.value, to: to.value }); await V.statementPdf(app, st); UI.toast('Statement ' + st.number + ' downloaded.', 'success'); } catch (e) { UI.toast(UI.errMsg(e), 'error'); } finally { btn.disabled = false; btn.classList.remove('busy'); }
    }
    function setOpening(r) {
      const amt = h('input', { type: 'text', inputmode: 'decimal', value: String(r.register.openingPaise / 100) });
      const why = h('textarea', { rows: 2, maxlength: 500, placeholder: 'Reason (saved in the audit log)' });
      UI.modal({ title: 'Opening balance · ' + r.register.id, size: 'sm', body: h('div', { class: 'stack', style: { gap: '12px' } }, h('p', { class: 'muted' }, 'The cash brought forward when this register started. Changing it moves every running balance.'), UI.field('Opening balance (₹)', amt), UI.field('Reason', why)),
        actions: [{ label: 'Cancel' }, { label: 'Save', kind: 'primary', keepOpen: true, onClick: async (m) => { await RW.api.call('registers.setOpening', { userId: r.user.id, amount: amt.value.replace(/,/g, ''), reason: why.value }); UI.toast('Opening balance updated.', 'success'); m.close(); load(); } }] });
    }
    load(); app.live(load);
    return { dispose() { dead = true; } };
  }

  /* ========================================================== #/statements */
  RW.route('/statements', async function (root, p, app) {
    app.title('Statements');
    let dead = false, period = p.q.from ? 'CUSTOM' : 'MONTH', last = null;
    const anchor = h('input', { type: 'date', value: app.today, max: app.today });
    const from = h('input', { type: 'date', value: p.q.from || RW.startOfMonth(app.today), max: app.today }), to = h('input', { type: 'date', value: p.q.to || app.today, max: app.today });
    const branchSel = UI.select([{ value: '', label: 'My branch' }], ''), userSel = UI.select([{ value: app.user.id, label: app.user.fullName + ' (me)' }], app.user.id);
    const seg = UI.segmented([{ value: 'DAY', label: 'Daily' }, { value: 'WEEK', label: 'Weekly' }, { value: 'MONTH', label: 'Monthly' }, { value: 'YEAR', label: 'Yearly' }, { value: 'CUSTOM', label: 'Custom' }], period, (v) => { period = v; sync(); });
    const fAnchor = UI.field('Pick a date in the period', anchor, { hint: '' }), fFrom = UI.field('From', from), fTo = UI.field('To', to);
    const result = h('div'), historyHost = h('div');
    const hint = h('small', { class: 'muted' });
    function sync() {
      fAnchor.style.display = period === 'CUSTOM' ? 'none' : ''; fFrom.style.display = fTo.style.display = period === 'CUSTOM' ? '' : 'none';
      const lab = { DAY: 'Date', WEEK: 'Any day in the week (Mon–Sun)', MONTH: 'Any day in the month', YEAR: 'Any day in the financial year', CUSTOM: '' }[period];
      fAnchor.querySelector('label').textContent = lab;
    }
    const canPick = app.mgmt;
    const gen = h('button', { class: 'btn btn-primary btn-lg', type: 'button', onclick: (e) => generate(e.currentTarget) }, UI.icon('chart', 18), 'Generate statement');
    const controls = h('div', { class: 'card' }, h('div', { class: 'card-b stack', style: { gap: '16px' } }, seg,
      h('div', { class: 'form-grid' }, canPick && app.seesAll ? UI.field('Branch', branchSel) : null, canPick ? UI.field('User', userSel) : null, fAnchor, fFrom, fTo), hint, h('div', null, gen)));
    root.appendChild(V.pageHead('Statements', 'Daily, weekly, monthly, yearly or custom cash statements with running balance.'));
    root.appendChild(h('div', { class: 'stack' }, controls, result, h('div', { class: 'card' }, h('div', { class: 'card-h' }, h('h3', null, 'Recent statements', h('small', null, 'Every generated statement is numbered and logged'))), h('div', { class: 'card-b flush' }, historyHost))));
    sync();

    async function fillUsers() {
      if (!canPick) return;
      try {
        const list = await V.userOptions(app.seesAll ? branchSel.value : app.user.branchId);
        UI.mount(userSel, list.map((u) => h('option', { value: u.id }, u.fullName + ' · ' + u.registerId)));
        userSel.value = list.some((u) => u.id === (p.q.user || userSel.dataset.keep)) ? (p.q.user || userSel.dataset.keep) : (list[0] ? list[0].id : '');
      } catch (e) { /* leave */ }
    }
    if (canPick && app.seesAll) { V.branchOptions(app).then((bo) => { UI.mount(branchSel, bo.map((o) => h('option', { value: o.value }, o.label.replace('All branches', 'All branches')))); }); }
    branchSel.addEventListener('change', () => fillUsers());
    fillUsers();

    async function generate(btn) {
      btn.disabled = true; btn.classList.add('busy');
      try {
        const st = await V.generateStatement(app, { userId: canPick ? userSel.value : app.user.id, period, anchor: anchor.value, from: from.value, to: to.value });
        last = st; showStatement(st); loadHistory();
        result.scrollIntoView({ behavior: 'smooth', block: 'start' });
      } catch (e) { UI.toast(UI.errMsg(e), 'error'); } finally { btn.disabled = false; btn.classList.remove('busy'); }
    }
    function showStatement(st) {
      UI.mount(result, h('div', { class: 'stack' },
        h('div', { class: 'row sb', style: { flexWrap: 'wrap', gap: '10px' } }, h('b', { style: { fontSize: '16px' } }, 'Statement ' + st.number),
          h('div', { class: 'acts', style: { display: 'flex', gap: '8px', flexWrap: 'wrap' } },
            h('button', { class: 'btn btn-accent', type: 'button', onclick: async (e) => { const b = e.currentTarget; b.disabled = true; try { await V.statementPdf(app, st); } catch (er) { UI.toast(UI.errMsg(er), 'error'); } finally { b.disabled = false; } } }, UI.icon('download', 16), 'Download PDF'),
            h('button', { class: 'btn btn-ghost', type: 'button', onclick: () => V.statementPdf(app, st, true) }, UI.icon('eye', 16), 'Open PDF'),
            h('button', { class: 'btn btn-ghost', type: 'button', onclick: () => g.print() }, UI.icon('printer', 16), 'Print'))),
        h('div', { class: 'print-area' }, statementView(st))));
    }
    async function openHistory(x) {
      try {
        const r = await RW.api.call('register.get', { userId: x.userId, from: x.from, to: x.to });
        const st = Object.assign(r, { number: x.number, period: { type: x.period, name: NAMES[x.period] || 'Custom', label: x.periodLabel, from: x.from, to: x.to }, generatedAt: x.generatedAt, generatedBy: { fullName: x.generatedBy }, generatedByBranch: x.branchName, company: app.settings.company });
        last = st; showStatement(st); result.scrollIntoView({ behavior: 'smooth', block: 'start' });
      } catch (e) { UI.toast(UI.errMsg(e), 'error'); }
    }
    async function loadHistory() {
      try {
        const r = await RW.api.call('statements.history', {});
        if (dead) return;
        UI.mount(historyHost, r.rows.length ? h('div', { class: 'tbl-wrap' }, h('table', { class: 'tbl rt' },
          h('thead', null, h('tr', null, h('th', null, 'Statement'), h('th', null, 'Register of'), h('th', { class: 'hide-m' }, 'Period'), h('th', { class: 'num' }, 'Closing'), h('th', { class: 'hide-m' }, 'Generated'))),
          h('tbody', null, r.rows.slice(0, 12).map((x) => h('tr', { class: 'click', tabindex: 0, onclick: () => openHistory(x), onkeydown: (e) => { if (e.key === 'Enter') openHistory(x); } },
            h('td', { class: 'keep' }, h('span', { class: 'vno' }, x.number), h('span', { class: 'sub' }, NAMES[x.period])), h('td', { class: 'full' }, x.userName, h('span', { class: 'sub' }, x.branchName)),
            h('td', { class: 'hide-m' }, x.periodLabel), h('td', { class: 'num keep' }, h('b', null, RW.fmtINR(x.closingPaise))), h('td', { class: 'hide-m' }, RW.timeAgo(x.generatedAt) + ' · ' + x.generatedBy)))))) : UI.empty('No statements yet', 'Generate your first statement above.', 'chart'));
      } catch (e) { UI.mount(historyHost, V.errorCard(e, loadHistory)); }
    }
    loadHistory();
    if (p.q.from && p.q.to) generate(gen);
    return { dispose() { dead = true; } };
  });
})(typeof window !== 'undefined' ? window : globalThis);
