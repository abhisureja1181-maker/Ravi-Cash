/* Ravi Cash — CEO Dashboard: the whole company on one page, read-only.
 * What the CEO sees: what needs attention, company cash, every branch side by side, trends, who holds / spends the money,
 * the largest unchecked payments, overdue money, and a live feed of what staff and the main admin just did. */
(function (g) {
  'use strict';
  const RW = (g.RW = g.RW || {});
  const UI = RW.ui, V = RW.v;
  const { h } = UI;
  const CH = () => RW.charts;
  const INR = (p) => RW.fmtINR(p);
  const greeting = () => { const hr = +new Date(Date.now() + 19800000).toISOString().slice(11, 13); return hr < 12 ? 'Good morning' : hr < 17 ? 'Good afternoon' : 'Good evening'; };

  const card = (title, sub, body, acts, flush) => h('div', { class: 'card' },
    h('div', { class: 'card-h' }, h('div', null, h('h3', null, title), sub ? h('small', null, sub) : null), acts || null),
    h('div', { class: 'card-b' + (flush ? ' flush' : '') }, body));
  const none = (text) => h('p', { class: 'muted', style: { margin: 0, fontSize: '13px' } }, text);
  const pctText = (p, days) => (p === null || p === undefined ? '' : (p >= 0 ? '▲ ' : '▼ ') + Math.abs(p) + '% vs prev. ' + days + 'd');
  const branchTag = (b) => V.branchShort(b);

  const ACTION = {
    CREATE: ['Created', 'plus'], EDIT: ['Edited', 'edit'], VOID: ['Voided', 'ban'], DELETE: ['Deleted', 'trash'], PURGE: ['Erased', 'trash'], REVIEW: ['Reviewed', 'shield'],
    ATTACH: ['Photo added', 'clip'], ATTACH_REMOVED: ['Photo removed', 'clip'], PHOTO_ADDED: ['Photo added', 'camera'], PHOTO_REMOVED: ['Photo removed', 'camera'], SETTLE: ['Settled', 'check'], CANCEL: ['Cancelled', 'ban'], EXPORT: ['Exported', 'download'],
    STATUS: ['Status changed', 'users'], RESET_PASSWORD: ['Password reset', 'key'], UPDATE: ['Updated', 'edit'], OPENING: ['Opening balance', 'wallet'],
  };

  RW.route('/ceo', async function (root, p, app) {
    app.title('CEO Dashboard');
    let range = 'month', first = true, dead = false, donutMode = 'out';
    const chips = V.presetChips([{ value: 'today', label: 'Today' }, { value: 'week', label: 'This Week' }, { value: 'month', label: 'This Month' }, { value: 'year', label: 'This Year' }, { value: 'all', label: 'All Time' }], range, (v) => { range = v; load(false); });
    const stamp = h('span', { class: 'muted', style: { fontSize: '12.5px' } });
    root.appendChild(V.pageHead('CEO Dashboard', greeting() + ', ' + app.user.fullName.split(' ')[0] + ' · every branch, every user, one page' + (app.isCeo ? ' · view only' : ''),
      [h('button', { class: 'btn btn-ghost', type: 'button', onclick: (e) => { e.currentTarget.blur(); load(false); } }, UI.icon('refresh', 16), 'Refresh')]));
    const body = h('div', { class: 'stack' }, V.loading(6));
    root.appendChild(body);

    // pieces built once, refilled on every refresh
    let alertsHost, K, branchHost, listsHost, feedHost, donutCard;
    const charts = {
      daily: h('div'), balance: h('div'), monthly: h('div'),
    };

    function build() {
      UI.clear(body);
      alertsHost = h('div');
      K = {
        cash: V.kpi({ label: 'Company Cash In Hand', icon: 'wallet', money: true, signed: true, hero: true, sub: 'All registers together' }),
        in: V.kpi({ label: 'Cash In', icon: 'inflow', tone: 'in', money: true, sub: '', slot: 1 }),
        out: V.kpi({ label: 'Cash Out', icon: 'outflow', tone: 'out', money: true, sub: '', slot: 2 }),
        net: V.kpi({ label: 'Net Cash Flow', icon: 'scale', money: true, signed: true, sub: '' }),
        review: V.kpi({ label: 'Waiting For Review', icon: 'shield', tone: 'accent', money: true, sub: '' }),
        os: V.kpi({ label: 'Outstanding', icon: 'clock', money: true, sub: '' }),
        cnt: V.kpi({ label: 'Vouchers', icon: 'file', sub: '' }),
        nv: V.kpi({ label: 'Marked Not Valid', icon: 'ban', money: true, sub: '' }),
      };
      body.appendChild(h('div', { class: 'row sb' }, h('div', null, h('b', { style: { fontSize: '15px' } }, 'Company overview '), stamp), chips.el));
      body.appendChild(card('Needs your attention', 'Things worth a look right now', alertsHost, null, true));
      body.appendChild(h('div', { class: 'grid g-kpi5' }, K.cash, K.in, K.out, K.net, K.cnt));
      body.appendChild(h('div', { class: 'grid g3 m1' }, K.review, K.os, K.nv));
      branchHost = h('div');
      body.appendChild(card('Branches side by side', 'Tap a branch for its full analytics', branchHost, null, true));
      donutCard = h('div', { class: 'card' });
      body.appendChild(h('div', { class: 'grid g-main' }, card('Daily cash in vs out', 'Last 14 days · whole company', charts.daily), donutCard));
      body.appendChild(h('div', { class: 'grid g2 m1' }, card('Cash balance trend', 'Last 30 days · whole company', charts.balance), card('Monthly cash flow', 'Last 12 months', charts.monthly)));
      listsHost = h('div', { class: 'grid g2 m1' });
      body.appendChild(listsHost);
      feedHost = h('div');
      body.appendChild(card('Live activity', 'The latest things done in the system, newest first', feedHost, h('a', { class: 'link', href: '#/audit', style: { fontSize: '12.5px' } }, 'Full audit log →'), true));
    }

    const row = (left, right, href, sub) => {
      const inner = [h('div', { class: 'ml-l' }, h('span', { class: 'ml-t' }, left), sub ? h('small', null, sub) : null), h('b', { class: 'ml-r' }, right)];
      return href ? h('a', { class: 'ml-row click', href }, inner) : h('div', { class: 'ml-row' }, inner);
    };

    function fillAlerts(d) {
      UI.mount(alertsHost, d.alerts.length
        ? h('div', { class: 'alerts' }, d.alerts.map((a) => h('a', { class: 'al-row ' + a.level, href: a.href },
          h('span', { class: 'al-ic' }, UI.icon(a.icon || 'alert', 17)),
          h('div', { class: 'al-tx' }, h('div', { class: 'al-t' }, a.title), a.detail ? h('div', { class: 'al-d' }, a.detail) : null),
          h('span', { class: 'al-go' }, UI.icon('right', 16)))))
        : h('div', { class: 'al-clear' }, h('span', { class: 'al-ic ok' }, UI.icon('check', 18)), h('div', null, h('b', null, 'All clear'), h('div', { class: 'al-d' }, 'Nothing needs attention right now — no overdue money, no waiting reviews, no negative cash.'))));
    }

    function fillKpis(d) {
      const k = d.kpis, days = d.range.days, pv = k.prev;
      K.cash.set(k.cashInHandPaise, [k.activeBranches + ' active branches · ' + k.activeUsers + ' users', k.transitPaise ? '+ ' + RW.compactINR(k.transitPaise) + ' on the way between branches' : ''].filter(Boolean).join(' · '), d.charts.balanceTrend30.map((x) => x.balancePaise));
      K.in.set(k.inPaise, [pv && pctText(pv.inPct, days) || d.range.label, k.givenPaise ? RW.compactINR(k.givenPaise) + ' given to staff' : '', k.xInPaise ? RW.compactINR(k.xInPaise) + ' transfers not counted' : ''].filter(Boolean).join(' · '), d.charts.daily14.map((x) => x.inPaise));
      K.out.set(k.outPaise, [pv && pctText(pv.outPct, days) || d.range.label, k.xOutPaise ? RW.compactINR(k.xOutPaise) + ' transfers not counted' : ''].filter(Boolean).join(' · '), d.charts.daily14.map((x) => x.outPaise));
      K.net.set(k.netPaise, d.range.label);
      K.cnt.set(k.count, pv && pctText(pv.countPct, days) || d.range.label);
      const r = d.review;
      K.review.set(r.pendingPaise, r.pendingCount ? r.pendingCount + ' payment' + (r.pendingCount > 1 ? 's' : '') + ' · oldest ' + (r.oldestDays ? r.oldestDays + ' days' : 'today') : 'Everything is reviewed');
      K.os.set(k.outstanding.totalPaise, 'To receive ' + RW.compactINR(k.outstanding.receivablePaise) + ' · to pay ' + RW.compactINR(k.outstanding.payablePaise) + (k.overdue.count ? ' · ' + k.overdue.count + ' overdue' : ''));
      K.nv.set(k.notValidPaise, k.notValidCount ? k.notValidCount + ' payment' + (k.notValidCount > 1 ? 's' : '') + ' not counted as expense' : 'None in this period');
    }

    function fillBranches(d) {
      const tot = d.branches.reduce((a, b) => ({ bal: a.bal + b.balancePaise, in: a.in + b.inPaise, out: a.out + b.outPaise, c: a.c + b.count, p: a.p + b.pendingCount, o: a.o + b.overduePaise }), { bal: 0, in: 0, out: 0, c: 0, p: 0, o: 0 });
      const tr = (b) => {
        const slot = V.slotFor(b.id), off = b.status !== 'ACTIVE';
        return h('tr', { class: 'click', onclick: () => { location.hash = '#/branches/' + b.id; } },
          h('td', { class: 'keep full' }, h('i', { class: 'dot', style: { background: 'var(--c' + slot + ')' } }), h('b', null, branchTag(b)), off ? UI.badge('DISABLED', 'gray') : null,
            h('small', { class: 'sub-line' }, b.activeUsers + ' active user' + (b.activeUsers === 1 ? '' : 's') + (b.lastEntryAt ? ' · last entry ' + RW.timeAgo(b.lastEntryAt) : ' · no entries yet'))),
          h('td', { class: 'num keep' }, h('b', { class: b.balancePaise < 0 ? 'neg' : '' }, INR(b.balancePaise))),
          h('td', { class: 'num hide-m amt-in' }, INR(b.inPaise)),
          h('td', { class: 'num keep amt-out' }, INR(b.outPaise)),
          h('td', { class: 'num hide-m' }, h('span', { class: b.netPaise < 0 ? 'neg' : '' }, INR(b.netPaise))),
          h('td', { class: 'num hide-m' }, String(b.count)),
          h('td', { class: 'num keep' }, b.pendingCount ? UI.badge(b.pendingCount + ' · ' + RW.compactINR(b.pendingPaise), 'amber') : h('span', { class: 'muted' }, '—')),
          h('td', { class: 'num hide-m' }, b.overduePaise ? h('span', { class: 'neg' }, INR(b.overduePaise)) : h('span', { class: 'muted' }, '—')));
      };
      UI.mount(branchHost, h('div', { class: 'tbl-wrap' }, h('table', { class: 'tbl rt' },
        h('thead', null, h('tr', null, h('th', null, 'Branch'), h('th', { class: 'num' }, 'Cash in hand'), h('th', { class: 'num hide-m' }, 'Cash In'), h('th', { class: 'num' }, 'Cash Out'), h('th', { class: 'num hide-m' }, 'Net'), h('th', { class: 'num hide-m' }, 'Vouchers'), h('th', { class: 'num' }, 'To review'), h('th', { class: 'num hide-m' }, 'Overdue'))),
        h('tbody', null, d.branches.map(tr)),
        h('tfoot', null, h('tr', { class: 'total' }, h('td', { class: 'keep full' }, h('b', null, 'Whole company')), h('td', { class: 'num keep' }, h('b', null, INR(tot.bal))), h('td', { class: 'num hide-m' }, h('b', null, INR(tot.in))), h('td', { class: 'num keep' }, h('b', null, INR(tot.out))),
          h('td', { class: 'num hide-m' }, h('b', null, INR(tot.in - tot.out))), h('td', { class: 'num hide-m' }, h('b', null, String(tot.c))), h('td', { class: 'num keep' }, h('b', null, tot.p ? String(tot.p) : '—')), h('td', { class: 'num hide-m' }, h('b', null, tot.o ? INR(tot.o) : '—')))))));
    }

    function drawCharts(d, animate) {
      const a = animate ? {} : { animate: false }, ch = d.charts, full = (s) => RW.fmtDate(s);
      CH().bars(charts.daily, Object.assign({ labels: ch.daily14.map((x) => x.label), fullLabels: ch.daily14.map((x) => full(x.date)), series: [{ name: 'Cash In', values: ch.daily14.map((x) => x.inPaise), slot: 1 }, { name: 'Cash Out', values: ch.daily14.map((x) => x.outPaise), slot: 2 }], height: 230, ariaLabel: 'Company daily cash inflow versus outflow for the last 14 days', labelWidth: 42 }, a));
      CH().line(charts.balance, Object.assign({ labels: ch.balanceTrend30.map((x) => x.label), fullLabels: ch.balanceTrend30.map((x) => full(x.date)), series: [{ name: 'Cash in hand', values: ch.balanceTrend30.map((x) => x.balancePaise), slot: 1 }], height: 230, ariaLabel: 'Company cash in hand for the last 30 days', labelWidth: 42 }, a));
      CH().bars(charts.monthly, Object.assign({ labels: ch.monthly12.map((x) => x.label), series: [{ name: 'Cash In', values: ch.monthly12.map((x) => x.inPaise), slot: 1 }, { name: 'Cash Out', values: ch.monthly12.map((x) => x.outPaise), slot: 2 }], height: 230, ariaLabel: 'Company monthly cash flow for the last 12 months', labelWidth: 42 }, a));
    }

    function drawDonut(d) {
      const items = d.branches.map((b) => ({ label: V.branchShort(b), value: donutMode === 'out' ? b.outPaise : b.inPaise, slot: V.slotFor(b.id) }));
      const total = items.reduce((a, i) => a + i.value, 0);
      const host = h('div');
      UI.mount(donutCard,
        h('div', { class: 'card-h' }, h('div', null, h('h3', null, 'Branch share'), h('small', null, d.range.label + ' · part of total cash ' + (donutMode === 'out' ? 'outflow' : 'inflow'))),
          UI.segmented([{ value: 'out', label: 'Out' }, { value: 'in', label: 'In' }], donutMode, (v) => { donutMode = v; drawDonut(d); })),
        h('div', { class: 'card-b' }, host));
      CH().donut(host, { items, valueFormat: (v) => RW.compactINR(v), center: { value: RW.compactINR(total), label: donutMode === 'out' ? 'Cash out' : 'Cash in' }, ariaLabel: 'Branch share of cash ' + (donutMode === 'out' ? 'outflow' : 'inflow') });
    }

    function fillLists(d) {
      const vRow = (v) => row(h('span', null, v.partyName), INR(v.amountPaise), '#/vouchers/' + v.id, (v.number || 'Cash Received') + ' · ' + V.branchShort(v) + ' · ' + v.userName + ' · ' + RW.fmtDate(v.date));
      const bars = (arr, key, sub) => { const host = h('div'); CH().hbars(host, arr.map((x, i) => ({ label: x.name, sub: sub(x), value: x[key], slot: (i % 3) + 1 })), { valueFormat: (v) => INR(v) }); return host; };
      const ivChips = h('div', { class: 'chips', style: { marginBottom: d.interventionList.length ? '10px' : 0 } }, [['edit', 'edited'], ['renumber', 'renumbered'], ['void', 'voided'], ['delete', 'deleted'], ['notValid', 'marked not valid']]
        .filter(([k]) => d.interventions[k]).map(([k, w]) => h('span', { class: 'badge badge-gray' }, d.interventions[k] + ' ' + w)));
      const tr = d.tours, shortR = (a, b) => (a === b ? RW.fmtDateShort(a) : RW.fmtDateShort(a) + ' – ' + RW.fmtDateShort(b));
      const waitRow = tr.pendingApproval ? [h('div', { class: 'sec-lbl' }, 'Waiting for the main admin\'s approval (' + tr.pendingApproval + ')'),
        tr.pending.map((x) => row(x.userName + ' · ' + x.title, shortR(x.startDate, x.endDate), '#/tours/' + x.id, V.branchShort(x) + ' · not approved yet')), h('div', { style: { height: '12px' } })] : null;
      const tourBody = tr.onTour.length || tr.upcoming.length || tr.pendingApproval ? [
        waitRow,
        tr.onTour.length ? h('div', { class: 'sec-lbl' }, 'On tour today') : null,
        tr.onTour.map((x) => row(x.userName + ' · ' + x.title, x.todayPlace || 'No place planned for today', '#/tours/' + x.id, V.branchShort(x) + ' · ' + shortR(x.startDate, x.endDate) + ' · ' + x.metPlanned + '/' + x.plannedParties + ' planned parties met · ' + x.visitCount + ' meeting' + (x.visitCount === 1 ? '' : 's'))),
        tr.upcoming.length ? h('div', { class: 'sec-lbl', style: { marginTop: tr.onTour.length ? '12px' : 0 } }, 'Starting in the next 14 days') : null,
        tr.upcoming.map((x) => row(x.userName + ' · ' + x.title, shortR(x.startDate, x.endDate), '#/tours/' + x.id, V.branchShort(x) + (x.places ? ' · ' + x.places : '')))] : none('Nobody is on tour and no tour starts in the next 14 days.');
      UI.mount(listsHost,
        card('Field tours', tr.meetings ? tr.meetings + ' meeting' + (tr.meetings === 1 ? '' : 's') + ' with ' + tr.parties + ' part' + (tr.parties === 1 ? 'y' : 'ies') + ' · ' + tr.photos + ' photo' + (tr.photos === 1 ? '' : 's') + ' · ' + d.range.label : 'No meetings recorded in ' + d.range.label.toLowerCase(), tourBody,
          h('span', { style: { display: 'flex', gap: '14px', flexWrap: 'wrap' } }, h('a', { class: 'link', href: '#/live-map', style: { fontSize: '12.5px' } }, 'Live Map →'), h('a', { class: 'link', href: '#/tours', style: { fontSize: '12.5px' } }, 'All tours →'))),
        card('Payments waiting for review', d.review.pendingCount ? 'The five biggest of ' + d.review.pendingCount + ' · only the main admin can mark them' : 'Nothing is waiting', d.pending.length ? d.pending.map(vRow) : none('Every payment has been checked.'), h('a', { class: 'link', href: '#/audit', style: { fontSize: '12.5px' } }, 'Open review →')),
        card('Overdue money', d.kpis.overdue.count ? d.kpis.overdue.count + ' entries · ' + INR(d.kpis.overdue.totalPaise) : 'Nothing is overdue',
          d.overdueItems.length ? d.overdueItems.map((o) => row(o.party, INR(o.balancePaise), '#/outstanding', (o.direction === 'RECEIVABLE' ? 'To receive' : 'To pay') + ' · ' + o.branchName.split(/\s[-–—]\s/).pop() + ' · ' + o.days + ' day' + (o.days === 1 ? '' : 's') + ' late')) : none('All dues are on time.'),
          h('a', { class: 'link', href: '#/outstanding', style: { fontSize: '12.5px' } }, 'Outstanding →')),
        card('Where the money went', d.range.label + ' · top five payees', d.topParties.length ? bars(d.topParties, 'outPaise', (x) => x.count + ' payment' + (x.count > 1 ? 's' : '')) : none('No payments in this period.')),
        card('Who spent the most', d.range.label + ' · cash paid out by staff', d.topSpenders.length ? bars(d.topSpenders, 'outPaise', (x) => x.branchName.split(/\s[-–—]\s/).pop() + ' · ' + x.count + ' payment' + (x.count > 1 ? 's' : '')) : none('No payments in this period.')),
        card('Who holds the most cash', 'Current balance of each cash register', d.topHolders.length ? bars(d.topHolders.map((r) => ({ name: r.name, balance: Math.max(0, r.balancePaise), branchName: r.branchName })), 'balance', (x) => x.branchName.split(/\s[-–—]\s/).pop()) : none('No registers yet.'), h('a', { class: 'link', href: '#/register', style: { fontSize: '12.5px' } }, 'All registers →')),
        card('Large payments', d.largePayments.length ? 'Each at or above the alert limit · ' + d.range.label : 'No payment crossed the alert limit in ' + d.range.label.toLowerCase(), d.largePayments.length ? d.largePayments.map(vRow) : none('Quiet period — nothing unusually large.')),
        card('Corrections by the main admin', d.range.label, [ivChips, d.interventionList.length ? d.interventionList.map((a) => row((ACTION[a.action] || [a.action])[0] + ' · ' + a.label, RW.timeAgo(a.at), a.entityId && a.entityId.startsWith('v_') ? '#/vouchers/' + a.entityId : null, a.reason || null)) : none('No edits, voids or deletions in this period.')]),
        card('Sign-in security', 'Last 24 hours', [row('Failed sign-in attempts', String(d.security.failedLogins24h), '#/audit'), row('Accounts locked right now', String(d.security.lockedAccounts)), row('Staff silent for 7+ days', String(d.inactiveStaff.length ? d.inactiveStaff.length : 0), '#/users', d.inactiveStaff.slice(0, 3).map((x) => x.name).join(' · ') || null),
          row('Registers below zero', String(d.negativeRegisters.length), '#/register', d.negativeRegisters.slice(0, 3).map((x) => x.name + ' ' + INR(x.balancePaise)).join(' · ') || null)]));
    }

    function fillFeed(d) {
      UI.mount(feedHost, d.feed.length ? h('div', { class: 'feed' }, d.feed.map((f) => {
        const [word, icon] = ACTION[f.action] || [f.action.charAt(0) + f.action.slice(1).toLowerCase().replace(/_/g, ' '), 'info'];
        const href = f.entity === 'VOUCHER' && f.entityId ? '#/vouchers/' + f.entityId : f.entity === 'TOUR' && f.entityId && f.action !== 'DELETE' ? '#/tours/' + f.entityId : null;
        const inner = [h('span', { class: 'fd-ic' }, UI.icon(icon, 15)),
          h('div', { class: 'fd-tx' }, h('div', null, h('b', null, f.actorName || 'System'), ' · ', word, ' ', h('span', { class: 'fd-what' }, f.label || f.entity)), h('small', null, [f.branchName ? f.branchName.split(/\s[-–—]\s/).pop() : '', f.reason].filter(Boolean).join(' · ') || ' ')),
          h('span', { class: 'fd-at' }, RW.timeAgo(f.at))];
        return href ? h('a', { class: 'fd-row click', href }, inner) : h('div', { class: 'fd-row' }, inner);
      })) : h('div', { style: { padding: '18px' } }, none('Nothing has happened yet.')));
    }

    function fill(d, animate) {
      stamp.textContent = '· updated ' + RW.fmtTime(d.generatedAt);
      fillAlerts(d); fillKpis(d); fillBranches(d); drawCharts(d, animate); drawDonut(d); fillLists(d); fillFeed(d);
    }

    async function load(initial) {
      try {
        if (!initial) body.classList.add('loading-dim');
        const d = await RW.api.call('ceo.dashboard', { range });
        if (dead) return;
        if (first) build();
        fill(d, first);
        first = false;
        body.classList.remove('loading-dim');
      } catch (e) { if (!dead) { body.classList.remove('loading-dim'); if (first) UI.mount(body, V.errorCard(e, () => load(true))); else UI.toast(UI.errMsg(e), 'error'); } }
    }
    await load(true);
    const off = app.live(() => load(false));
    return { dispose() { dead = true; off(); } };
  }, { roles: ['CEO', 'SUPER_ADMIN'] });
})(typeof window !== 'undefined' ? window : globalThis);
