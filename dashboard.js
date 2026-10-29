/* Ravi Cash — dashboards (branch user + admin/viewer) and branch analytics. */
(function (g) {
  'use strict';
  const RW = (g.RW = g.RW || {});
  const UI = RW.ui, V = RW.v;
  const { h } = UI;
  const CH = () => RW.charts;

  const greeting = () => { const hr = +new Date(Date.now() + 19800000).toISOString().slice(11, 13); return hr < 12 ? 'Good morning' : hr < 17 ? 'Good afternoon' : 'Good evening'; };
  const cnt = (v) => RW.groupIndian(String(Math.round(v)));

  /* Charts shared by both dashboards. `d` is the dashboard.get payload. */
  function chartCards() {
    const mk = (title, sub, cls) => { const host = h('div'); return { host, el: h('div', { class: 'card ' + (cls || '') }, h('div', { class: 'card-h' }, h('div', null, h('h3', null, title), h('small', null, sub))), h('div', { class: 'card-b' }, host)) }; };
    return { daily: mk('Daily Cash Inflow vs Outflow', 'Last 14 days'), balance: mk('Cash Balance Trend', 'Last 30 days'), weekly: mk('Weekly Cash Flow', 'Last 8 weeks'), monthly: mk('Monthly Cash Flow', 'Last 12 months'), count: mk('Voucher Count', 'Vouchers per day, last 14 days') };
  }
  function drawCharts(c, d, animate) {
    const a = animate ? {} : { animate: false };
    const full = (s) => RW.fmtDate(s);
    const ch = d.charts;
    CH().bars(c.daily.host, Object.assign({ labels: ch.daily14.map((x) => x.label), fullLabels: ch.daily14.map((x) => full(x.date)), series: [{ name: 'Cash In', values: ch.daily14.map((x) => x.inPaise), slot: 1 }, { name: 'Cash Out', values: ch.daily14.map((x) => x.outPaise), slot: 2 }], height: 230, ariaLabel: 'Daily cash inflow versus outflow for the last 14 days', labelWidth: 42 }, a));
    CH().line(c.balance.host, Object.assign({ labels: ch.balanceTrend30.map((x) => x.label), fullLabels: ch.balanceTrend30.map((x) => full(x.date)), series: [{ name: 'Cash balance', values: ch.balanceTrend30.map((x) => x.balancePaise), slot: 1 }], height: 230, area: true, ariaLabel: 'Cash balance for the last 30 days', labelWidth: 52 }, a));
    CH().line(c.weekly.host, Object.assign({ labels: ch.weekly8.map((x) => x.label), fullLabels: ch.weekly8.map((x) => 'Week of ' + full(x.date)), series: [{ name: 'Cash In', values: ch.weekly8.map((x) => x.inPaise), slot: 1 }, { name: 'Cash Out', values: ch.weekly8.map((x) => x.outPaise), slot: 2 }], height: 210, area: false, ariaLabel: 'Weekly cash inflow and outflow', labelWidth: 48 }, a));
    CH().bars(c.monthly.host, Object.assign({ labels: ch.monthly12.map((x) => x.label), series: [{ name: 'Cash In', values: ch.monthly12.map((x) => x.inPaise), slot: 1 }, { name: 'Cash Out', values: ch.monthly12.map((x) => x.outPaise), slot: 2 }], height: 210, ariaLabel: 'Monthly cash inflow and outflow', labelWidth: 46 }, a));
    CH().bars(c.count.host, Object.assign({ labels: ch.voucherCount14.map((x) => x.label), fullLabels: ch.voucherCount14.map((x) => full(x.date)), series: [{ name: 'Vouchers', values: ch.voucherCount14.map((x) => x.count), slot: 1 }], height: 210, valueFormat: (v) => cnt(v), axisFormat: (v) => cnt(v), marginLeft: 36, ariaLabel: 'Number of vouchers per day', labelWidth: 42 }, a));
  }

  function recentCard(title, href) {
    const body = h('div');
    return { body, el: h('div', { class: 'card' }, h('div', { class: 'card-h' }, h('h3', null, title), h('a', { class: 'link', href, style: { fontSize: '12.5px' } }, 'View all →')), h('div', { class: 'card-b flush' }, body)) };
  }

  /* ============================================================ #/dashboard */
  RW.route('/dashboard', async function (root, p, app) {
    const mgmt = app.mgmt;
    app.title('Dashboard');
    let range = 'month', first = true, dead = false;
    root.appendChild(V.pageHead('Dashboard', greeting() + ', ' + app.user.fullName.split(' ')[0] + ' · ' + RW.fmtDate(app.today) + ' · ' + (mgmt && app.seesAll ? 'All branches' : app.branch.name),
      app.canCreate ? [h('a', { class: 'btn btn-ghost', href: '#/vouchers/new?type=RECEIVED' }, UI.icon('wallet', 16), 'Cash Received'), h('a', { class: 'btn btn-accent', href: '#/vouchers/new' }, UI.icon('plus', 16), 'Create Voucher')] : null));
    const body = h('div', { class: 'stack' }, V.loading(5));
    root.appendChild(body);

    /* ----- my tour: shown only while a tour is running or about to start */
    const tourHost = h('div', { class: 'tour-host' });
    root.insertBefore(tourHost, body);
    async function loadTour() {
      try {
        const sup = app.role === 'SUPER_ADMIN';
        const [r, w] = await Promise.all([
          app.canCreate ? RW.api.call('tours.list', { filters: { userId: app.user.id }, pageSize: 100 }) : Promise.resolve({ rows: [] }),
          sup ? RW.api.call('tours.list', { filters: { approval: 'PENDING' }, pageSize: 3 }) : Promise.resolve({ rows: [], total: 0 }),
        ]);
        if (dead) return;
        const plural = (n) => n + ' tour plan' + (n === 1 ? '' : 's');
        const parts = [];
        if (w.total) {
          parts.push(h('div', { class: 'card tour-strip tour-wait' },
            h('span', { class: 'kpi-ic' }, UI.icon('shield', 18)),
            h('div', { class: 'ts-t' }, h('small', null, 'Needs your approval'), h('b', null, w.total + ' tour plan' + (w.total === 1 ? '' : 's') + ' waiting for approval'),
              h('small', null, w.rows.map((t) => t.userName + ' · ' + t.title).join('  |  ') + (w.total > w.rows.length ? '  +' + (w.total - w.rows.length) + ' more' : ''))),
            h('div', { class: 'ts-a' }, h('a', { class: 'btn btn-primary btn-sm', href: '#/tours?approval=1' }, 'Review'))));
        }
        const on = r.rows.find((t) => t.phase === 'ONGOING');
        const next = r.rows.filter((t) => t.phase === 'UPCOMING').sort((a, b) => (a.startDate < b.startDate ? -1 : 1))[0];
        const t = on || next;
        if (t) {
          const days = RW.diffDays(t.startDate, app.today);
          parts.push(h('div', { class: 'card tour-strip' },
            h('span', { class: 'kpi-ic' }, UI.icon('map', 18)),
            h('div', { class: 'ts-t' }, h('small', null, on ? 'You are on tour' : 'Your next tour · starts ' + (days === 1 ? 'tomorrow' : 'in ' + days + ' days')), h('b', null, t.title),
              h('small', null, RW.fmtDateShort(t.startDate) + ' – ' + RW.fmtDate(t.endDate) + (on ? ' · ' + t.metPlanned + ' of ' + t.plannedParties + ' planned parties met · ' + t.visitCount + ' meeting' + (t.visitCount === 1 ? '' : 's') : '')),
              t.awaiting ? h('small', { style: { color: 'var(--warn)', fontWeight: 600 } }, 'Waiting for admin approval — only the admin can change the plan')
                : !sup && r.rows.some((x) => x.awaiting) ? h('small', { style: { color: 'var(--warn)', fontWeight: 600 } }, plural(r.rows.filter((x) => x.awaiting).length) + ' waiting for admin approval') : null),
            h('div', { class: 'ts-a' }, on ? h('button', { class: 'btn btn-accent btn-sm', type: 'button', onclick: () => V.meetingDialog({ tour: { id: t.id, title: t.title, startDate: t.startDate, endDate: t.endDate }, onDone: loadTour }) }, UI.icon('camera', 14), 'Record Meeting') : null,
              h('a', { class: 'btn btn-ghost btn-sm', href: '#/tours/' + t.id }, 'Open'))));
        }
        if (!parts.length) return UI.clear(tourHost);
        UI.mount(tourHost, parts);
      } catch (e) { UI.clear(tourHost); }
    }
    loadTour();

    // ----- persistent pieces (built once, updated on live refresh)
    const charts = chartCards();
    const recent = recentCard(mgmt ? 'Recent vouchers' : 'My recent vouchers', mgmt ? '#/all-vouchers' : '#/vouchers');
    let K = null, branchesHost = null, donutCard = null, rangeChips = null, periodsHost = null;

    function build(d) {
      UI.clear(body);
      if (!mgmt) {
        K = {
          bal: V.kpi({ label: 'Current Cash Balance', icon: 'wallet', money: true, signed: true, hero: true, sub: 'Cash in hand' }),
          in: V.kpi({ label: 'Cash In', icon: 'inflow', tone: 'in', money: true, sub: '', slot: 1 }),
          out: V.kpi({ label: 'Cash Out', icon: 'outflow', tone: 'out', money: true, sub: '', slot: 2 }),
          net: V.kpi({ label: 'Net Cash', icon: 'scale', money: true, signed: true, sub: '' }),
          cnt: V.kpi({ label: 'Total Vouchers', icon: 'file', sub: '' }),
        };
        body.appendChild(h('div', { class: 'grid g-kpi5' }, K.bal, K.in, K.out, K.net, K.cnt));
        periodsHost = h('div', { class: 'grid g3 m1' });
        body.appendChild(periodsHost);
      } else {
        rangeChips = V.presetChips([{ value: 'today', label: 'Today' }, { value: 'week', label: 'This Week' }, { value: 'month', label: 'This Month' }, { value: 'year', label: 'This Year' }, { value: 'all', label: 'All Time' }], range, (v) => { range = v; load(false); });
        K = {
          in: V.kpi({ label: 'Total Cash Inflow', icon: 'inflow', tone: 'in', money: true, sub: '', slot: 1 }),
          out: V.kpi({ label: 'Total Cash Outflow', icon: 'outflow', tone: 'out', money: true, sub: '', slot: 2 }),
          net: V.kpi({ label: 'Net Cash Flow', icon: 'scale', money: true, signed: true, sub: '' }),
          bal: V.kpi({ label: 'Cash In Hand', icon: 'wallet', money: true, signed: true, hero: true, sub: 'Across all registers' }),
          os: V.kpi({ label: 'Total Outstanding', icon: 'clock', tone: 'accent', money: true, sub: 'Receivable + payable' }),
          cnt: V.kpi({ label: 'Total Vouchers', icon: 'file', sub: '' }),
          users: V.kpi({ label: 'Active Users', icon: 'users', sub: 'Can sign in today' }),
          br: V.kpi({ label: 'Active Branches', icon: 'building', sub: 'Isolated data per branch' }),
        };
        body.appendChild(h('div', { class: 'row sb' }, h('b', { style: { fontSize: '15px' } }, 'Overview'), rangeChips.el));
        body.appendChild(h('div', { class: 'grid g-auto' }, K.bal, K.in, K.out, K.net, app.isAdmin ? K.os : null, K.cnt, K.users, K.br));
        branchesHost = h('div', { class: 'grid g3 m1' });
        body.appendChild(h('div', { class: 'row sb', style: { marginTop: '6px' } }, h('b', { style: { fontSize: '15px' } }, app.seesAll ? 'Branch monitoring' : 'Your branch'), app.seesAll ? h('span', { class: 'muted', style: { fontSize: '12.5px' } }, 'Click a branch for full analytics') : null));
        body.appendChild(branchesHost);
      }
      body.appendChild(h('div', { class: 'grid g-main' }, charts.daily.el, charts.balance.el));
      body.appendChild(h('div', { class: 'grid g3' }, charts.weekly.el, charts.monthly.el, charts.count.el));
      if (mgmt) { donutCard = h('div', { class: 'card' }); body.appendChild(h('div', { class: 'grid g-main' }, recent.el, donutCard)); } else body.appendChild(recent.el);
    }

    function fill(d, animate) {
      const day = d.charts.daily14, tdy = day[day.length - 1], yst = day[day.length - 2] || { inPaise: 0, outPaise: 0, count: 0 };
      const ser = (f) => day.map(f);
      if (!mgmt) {
        K.bal.set(d.self.balancePaise, 'Opening ' + RW.fmtINR(d.self.openingPaise) + ' · ' + (d.self.registerId || ''), d.charts.balanceTrend30.map((x) => x.balancePaise));
        K.in.set(d.periods.today.inPaise, 'Yesterday ' + RW.fmtINR(yst.inPaise), ser((x) => x.inPaise));
        K.out.set(d.periods.today.outPaise, 'Yesterday ' + RW.fmtINR(yst.outPaise), ser((x) => x.outPaise));
        K.net.set(d.periods.today.netPaise, 'Yesterday ' + RW.fmtINR(yst.inPaise - yst.outPaise), ser((x) => x.inPaise - x.outPaise));
        K.cnt.set(d.periods.today.count, 'Yesterday ' + yst.count, ser((x) => x.count));
        UI.mount(periodsHost, ['week', 'month', 'year'].map((k) => {
          const x = d.periods[k];
          return h('div', { class: 'card', style: { padding: '16px 18px' } }, h('div', { class: 'row sb' }, h('b', { style: { fontSize: '13px' } }, x.label), h('span', { class: 'muted', style: { fontSize: '12px' } }, x.count + ' vouchers')),
            h('div', { class: 'bc-grid', style: { marginTop: '12px' } }, h('div', { class: 'in' }, h('small', null, 'Cash In'), h('b', null, RW.fmtINR(x.inPaise))), h('div', { class: 'out' }, h('small', null, 'Cash Out'), h('b', null, RW.fmtINR(x.outPaise))), h('div', { style: { gridColumn: '1 / -1' } }, h('small', null, 'Net cash'), h('b', { class: x.netPaise < 0 ? 'neg' : '' }, RW.fmtINR(x.netPaise)))));
        }));
      } else {
        const k = d.kpis;
        K.in.set(k.inPaise, d.kpiRange.label, ser((x) => x.inPaise)); K.out.set(k.outPaise, d.kpiRange.label, ser((x) => x.outPaise)); K.net.set(k.netPaise, d.kpiRange.label);
        K.bal.set(k.balancePaise, 'Across all registers', d.charts.balanceTrend30.map((x) => x.balancePaise)); if (app.isAdmin) K.os.set(k.outstandingPaise || 0, 'Receivable + payable');
        K.cnt.set(k.count, d.kpiRange.label); K.users.set(k.activeUsers); K.br.set(k.activeBranches);
        UI.mount(branchesHost, d.branches.map((b, i) => {
          const slot = V.slotFor(b.id);
          const card = h(app.seesAll ? 'button' : 'div', { class: 'card branch-card', type: 'button', onclick: app.seesAll ? () => (location.hash = '#/branches/' + b.id) : null },
            h('div', { class: 'bc-h' }, h('b', null, h('i', { style: { background: 'var(--c' + slot + ')' } }), b.code + ' BRANCH'), b.status === 'ACTIVE' ? UI.badge('ACTIVE', 'green') : UI.badge('DISABLED', 'gray')),
            h('h4', null, b.name),
            h('div', { class: 'bc-grid' }, h('div', { class: 'in' }, h('small', null, 'Cash In'), h('b', null, RW.fmtINR(b.inPaise))), h('div', { class: 'out' }, h('small', null, 'Cash Out'), h('b', null, RW.fmtINR(b.outPaise))), h('div', null, h('small', null, 'Balance'), h('b', { class: b.balancePaise < 0 ? 'neg' : '' }, RW.fmtINR(b.balancePaise))), h('div', null, h('small', null, 'Vouchers · Users'), h('b', null, b.count + ' · ' + b.userCount))));
          return card;
        }));
        branchDonut(d);
      }
      drawCharts(charts, d, animate);
      UI.mount(recent.body, d.recent.length ? V.voucherTable(d.recent, { showUser: mgmt, showBranch: mgmt && app.seesAll, compact: mgmt }) : UI.empty('No vouchers yet', app.canCreate ? 'Create your first voucher to see it here.' : 'Vouchers will appear here once created.', 'file'));
      if (animate) UI.stagger(recent.body, 'tbody tr', 40);
    }

    let donutMode = 'out';
    function branchDonut(d) {
      const items = d.branches.map((b) => ({ label: V.branchShort(b), value: donutMode === 'out' ? b.outPaise : b.inPaise, slot: V.slotFor(b.id) }));
      const total = items.reduce((a, i) => a + i.value, 0);
      const host = h('div');
      UI.mount(donutCard,
        h('div', { class: 'card-h' }, h('div', null, h('h3', null, 'Branch share'), h('small', null, d.kpiRange.label + ' · part of total ' + (donutMode === 'out' ? 'cash outflow' : 'cash inflow'))),
          UI.segmented([{ value: 'out', label: 'Out' }, { value: 'in', label: 'In' }], donutMode, (v) => { donutMode = v; branchDonut(d); })),
        h('div', { class: 'card-b' }, host));
      CH().donut(host, { items, valueFormat: (v) => RW.compactINR(v), center: { value: RW.compactINR(total), label: donutMode === 'out' ? 'Cash out' : 'Cash in' }, ariaLabel: 'Branch share of cash ' + (donutMode === 'out' ? 'outflow' : 'inflow') });
    }

    async function load(initial) {
      try {
        if (!initial) body.classList.add('loading-dim');
        const d = await RW.api.call('dashboard.get', { range });
        if (dead) return;
        if (first) { build(d); }
        fill(d, first);
        first = false;
        body.classList.remove('loading-dim');
      } catch (e) { if (!dead) { body.classList.remove('loading-dim'); if (first) UI.mount(body, V.errorCard(e, () => load(true))); else UI.toast(UI.errMsg(e), 'error'); } }
    }
    await load(true);
    const off = app.live(() => { load(false); loadTour(); });
    return { dispose() { dead = true; off(); } };
  });

  /* ================================================= #/branches/:id analytics */
  RW.route('/branches/:id', async function (root, p, app) {
    const id = p.id;
    let range = 'month', dead = false;
    const rb = await RW.api.call('branches.list', {});
    const br = rb.rows.find((b) => b.id === id);
    if (!br) { UI.mount(root, V.pageHead('Branch not found', null, null, { href: '#/branches', label: 'Branches' }), h('div', { class: 'card' }, UI.empty('This branch does not exist or you cannot access it', '', 'building'))); return; }
    app.title(br.name);
    const slot = V.slotFor(br.id);
    const kpis = h('div', { class: 'grid g4' }), charts = h('div', { class: 'stack' }), lists = h('div', { class: 'stack' });
    const chips = V.presetChips([{ value: 'today', label: 'Today' }, { value: 'week', label: 'This Week' }, { value: 'month', label: 'This Month' }, { value: 'year', label: 'This Year' }], range, (v) => { range = v; load(); });
    root.appendChild(V.pageHead(br.name, br.code + ' · ' + br.address + ' · ' + br.contact, [chips.el, app.isSuper ? h('button', { class: 'btn btn-ghost', onclick: () => RW.v.editBranch && RW.v.editBranch(br, () => app.go('#/branches/' + id)) }, UI.icon('edit', 15), 'Edit') : null], { href: '#/branches', label: 'All branches' }));
    root.appendChild(h('div', { class: 'stack' }, kpis, charts, lists));
    async function load() {
      try {
        const [b, cash, users, vs, os] = await Promise.all([
          RW.api.call('branches.list', { preset: range }), RW.api.call('reports.cash', { preset: range, branchId: id }),
          RW.api.call('users.list', { filters: { branchId: id } }), RW.api.call('vouchers.list', { filters: { branchId: id }, pageSize: 10 }),
          app.isAdmin ? RW.api.call('outstanding.list', { filters: { branchId: id }, pageSize: 5 }) : Promise.resolve(null),
        ]);
        if (dead) return;
        const s = b.rows.find((x) => x.id === id);
        UI.mount(kpis,
          V.kpi({ label: 'Cash In', icon: 'inflow', tone: 'in', money: true, value: s.inPaise, sub: cash.range.label }), V.kpi({ label: 'Cash Out', icon: 'outflow', tone: 'out', money: true, value: s.outPaise, sub: cash.range.label }),
          V.kpi({ label: 'Cash Balance', icon: 'wallet', money: true, signed: true, hero: true, value: s.balancePaise, sub: 'All registers in this branch' }), V.kpi({ label: 'Vouchers', icon: 'file', value: s.count, sub: s.userCount + ' active users' }));
        const cc = h('div'), card = h('div', { class: 'card' }, h('div', { class: 'card-h' }, h('div', null, h('h3', null, 'Cash flow'), h('small', null, cash.range.label))), h('div', { class: 'card-b' }, cc));
        UI.mount(charts, card);
        const ser = cash.series;
        if (cash.series.length > 40) CH().line(cc, { labels: ser.map((x) => x.label), series: [{ name: 'Cash In', values: ser.map((x) => x.inPaise), slot: 1 }, { name: 'Cash Out', values: ser.map((x) => x.outPaise), slot: 2 }], height: 240, area: false });
        else CH().bars(cc, { labels: ser.map((x) => x.label), fullLabels: ser.map((x) => RW.fmtDate(x.date)), series: [{ name: 'Cash In', values: ser.map((x) => x.inPaise), slot: 1 }, { name: 'Cash Out', values: ser.map((x) => x.outPaise), slot: 2 }], height: 240 });
        const ut = h('table', { class: 'tbl rt' }, h('thead', null, h('tr', null, ['User', 'Role', 'Register', 'Vouchers', 'Balance', 'Status'].map((x, i) => h('th', { class: i === 3 || i === 4 ? 'num' : '' }, x)))),
          h('tbody', null, users.rows.map((u) => h('tr', { class: 'click', onclick: () => (location.hash = '#/reports?tab=user&user=' + u.id) }, h('td', null, h('b', null, u.fullName), h('span', { class: 'sub' }, u.designation || u.username)), h('td', { class: 'hide-m' }, UI.roleName(u.role)), h('td', { class: 'hide-m' }, u.registerId || '—'), h('td', { class: 'num hide-m' }, u.voucherCount), h('td', { class: 'num' }, u.balancePaise === null ? '—' : RW.fmtINR(u.balancePaise)), h('td', { class: 'hide-m' }, UI.userStatusBadge(u.status))))));
        UI.mount(lists,
          h('div', { class: 'grid g-main' },
            h('div', { class: 'card' }, h('div', { class: 'card-h' }, h('h3', null, 'Recent vouchers'), h('a', { class: 'link', style: { fontSize: '12.5px' }, href: '#/all-vouchers?branch=' + id }, 'View all →')), h('div', { class: 'card-b flush' }, vs.rows.length ? V.voucherTable(vs.rows, { showUser: true }) : UI.empty('No vouchers yet', '', 'file'))),
            h('div', { class: 'stack' },
              h('div', { class: 'card' }, h('div', { class: 'card-h' }, h('h3', null, 'Users'), h('span', { class: 'muted', style: { fontSize: '12px' } }, users.rows.length)), h('div', { class: 'card-b flush' }, h('div', { class: 'tbl-wrap' }, ut))),
              os ? h('div', { class: 'card' }, h('div', { class: 'card-h' }, h('h3', null, 'Outstanding'), h('a', { class: 'link', style: { fontSize: '12.5px' }, href: '#/outstanding?branch=' + id }, 'Manage →')), h('div', { class: 'card-b' }, h('div', { class: 'bc-grid' }, h('div', { class: 'in' }, h('small', null, 'Receivable'), h('b', null, RW.fmtINR(os.summary.total.receivablePaise))), h('div', { class: 'out' }, h('small', null, 'Payable'), h('b', null, RW.fmtINR(os.summary.total.payablePaise))), h('div', null, h('small', null, 'Overdue'), h('b', null, RW.fmtINR(os.summary.overdue.totalPaise))), h('div', null, h('small', null, 'Due this week'), h('b', null, RW.fmtINR(os.summary.dueWeek.totalPaise)))))) : null)));
      } catch (e) { if (!dead) UI.toast(UI.errMsg(e), 'error'); }
    }
    void slot;
    await load();
    const off = app.live(load);
    return { dispose() { dead = true; off(); } };
  }, { roles: ['SUPER_ADMIN', 'CEO'] });
})(typeof window !== 'undefined' ? window : globalThis);
