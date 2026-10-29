/* Ravi Cash — shared view helpers. */
(function (g) {
  'use strict';
  const RW = (g.RW = g.RW || {});
  const UI = RW.ui;
  const { h } = UI;
  const V = (RW.v = RW.v || {});
  RW.routes = RW.routes || [];
  RW.route = (path, view, o) => RW.routes.push(Object.assign({ re: new RegExp('^' + path.replace(/:[a-z]+/gi, '([^/]+)') + '$'), keys: (path.match(/:[a-z]+/gi) || []).map((k) => k.slice(1)), view }, o || {}));

  // "MAIN" -> "Main" (falls back to the name when no code is available)
  V.branchShort = (b) => { const c = b && (b.branchCode || b.code); return c ? c.charAt(0) + c.slice(1).toLowerCase() : (b && (b.branchName || b.name)) || ''; };

  V.BRANCH_SLOTS = {}; // branchId -> chart slot (stable colour per branch)
  V.slotFor = (id, list) => { if (!(id in V.BRANCH_SLOTS)) V.BRANCH_SLOTS[id] = ((Object.keys(V.BRANCH_SLOTS).length) % 3) + 1; return V.BRANCH_SLOTS[id]; };

  V.pageHead = function (title, sub, acts, crumb) {
    return h('div', { class: 'page-head' },
      h('div', null, crumb ? h('a', { class: 'crumb', href: crumb.href }, UI.icon('left', 14), crumb.label) : null, h('h1', null, title), sub ? h('p', null, sub) : null),
      acts ? h('div', { class: 'acts' }, acts) : null);
  };

  /* KPI card. value is paise (money) or a count; returns the element */
  V.kpi = function (o) {
    const val = h('div', { class: 'kpi-v' }, o.money ? '₹0' : '0');
    const spark = h('span', { class: 'spark-host' });
    const el = h('div', { class: 'card kpi ' + (o.tone || '') + (o.hero ? ' kpi-hero' : '') },
      h('div', { class: 'kpi-top' }, h('span', { class: 'kpi-ic' }, UI.icon(o.icon || 'rupee', 16)), o.label),
      val, h('div', { class: 'kpi-s' }, h('span', null, o.sub || ''), spark));
    el.set = (v, sub, series) => {
      if (o.money) UI.money(val, v); else UI.animateValue(val, v, (x) => RW.groupIndian(String(Math.round(x))));
      val.classList.toggle('neg', !!o.signed && v < 0);
      if (sub !== undefined) el.querySelector('.kpi-s span').textContent = sub;
      if (series && series.length > 1 && RW.charts) RW.charts.spark(spark, series, { slot: o.slot || 1 });
    };
    if (o.value !== undefined) el.set(o.value, o.sub, o.series);
    return el;
  };

  /* Voucher number cell content. "Cash Received" entries have no number, so they show a label instead. */
  V.vno = (v) => (v.number ? h('span', { class: 'vno' }, v.number) : h('span', { class: 'vno vno-none' }, 'Cash Received'));

  /* ---------- audit review: mark a payment voucher Valid / Not valid (admins only) ----------
   * "Not valid" keeps the voucher on record but stops its amount counting as an expense, so it goes back into the
   * user's cash. The change is reversible and every decision is written to the audit log with who / when / why. */
  V.reviewDialog = function (v, status, onDone) {
    const bad = status === 'INVALID', undo = status === 'PENDING';
    const t = h('textarea', { rows: 3, maxlength: 500, placeholder: bad ? 'Why is this voucher not valid? (required — saved in the audit log)' : 'Optional note' });
    const f = UI.field(bad ? 'Reason' : 'Note (optional)', t);
    const lines = bad
      ? ['The voucher stays on record, but ' + RW.fmtINR(v.amountPaise) + ' is NOT counted as an expense. It goes back into ' + v.userName.split(' ')[0] + "'s cash balance.", 'You can mark it valid again later.']
      : undo ? ['The voucher goes back to "To review". It counts as an expense until you decide.'] : ['The voucher is confirmed as a genuine expense and keeps counting in the cash totals.'];
    UI.modal({
      title: (bad ? 'Mark not valid · ' : undo ? 'Undo review · ' : 'Mark valid · ') + v.label, size: 'sm',
      body: h('div', { class: 'stack', style: { gap: '12px' } },
        h('div', { class: 'confirm-body' }, h('div', { class: 'confirm-ic ' + (bad ? 'danger' : '') }, UI.icon(bad ? 'ban' : 'check', 22)), h('div', null, h('p', null, h('b', null, v.partyName), ' · ', RW.fmtINR2(v.amountPaise)), lines.map((l) => h('p', null, l)))),
        undo ? null : f),
      actions: [{ label: 'Cancel' }, {
        label: bad ? 'Mark not valid' : undo ? 'Undo review' : 'Mark valid', kind: bad ? 'danger' : 'primary', keepOpen: true,
        onClick: async (m) => {
          if (bad && t.value.trim().length < 5) { UI.fieldError(f, 'Please enter a reason (at least 5 characters)'); t.focus(); return false; }
          await RW.api.call('vouchers.review', { id: v.id, status, reason: t.value.trim() });
          UI.toast(bad ? v.label + ' marked not valid — not counted as expense.' : undo ? 'Review undone.' : v.label + ' marked valid.', 'success');
          m.close(); if (onDone) onDone();
        },
      }],
    });
  };

  /* Box shown on the voucher page: current review state + (for the main / Super admin only) the buttons. Returns null when not applicable. */
  V.reviewBox = function (v, canReview, onDone) {
    if (v.type !== 'PAYMENT' || v.status !== 'ACTIVE') return null;
    const cls = { VALID: 'is-valid', INVALID: 'is-invalid', PENDING: 'is-pending' }[v.review];
    const title = v.review === 'VALID' ? 'Valid — counted as expense' : v.review === 'INVALID' ? 'Not valid — NOT counted as expense' : 'Waiting for audit review';
    const sub = v.review === 'PENDING' ? 'Counted as an expense until the main admin marks it not valid.'
      : (v.reviewedBy ? 'Reviewed by ' + v.reviewedBy + (v.reviewedAt ? ' · ' + RW.fmtDateTime(v.reviewedAt) : '') : '') + (v.reviewReason ? ' — ' + v.reviewReason : '') + (v.review === 'INVALID' ? ' · ' + RW.fmtINR(v.amountPaise) + ' is back in ' + v.userName.split(' ')[0] + "'s cash." : '');
    const btn = (label, icon, status, tone) => h('button', { class: 'btn ' + (tone || 'btn-ghost'), type: 'button', onclick: () => V.reviewDialog(v, status, onDone) }, UI.icon(icon, 16), label);
    const acts = !canReview ? [] : v.review === 'PENDING' ? [btn('Valid', 'check', 'VALID', 'btn-primary'), btn('Not valid', 'ban', 'INVALID')]
      : v.review === 'VALID' ? [btn('Not valid', 'ban', 'INVALID'), btn('Undo', 'refresh', 'PENDING')] : [btn('Mark valid', 'check', 'VALID', 'btn-primary'), btn('Undo', 'refresh', 'PENDING')];
    return h('div', { class: 'review-box ' + cls }, h('div', { class: 'rb-main' }, h('small', { style: { fontWeight: 700, letterSpacing: '.06em', textTransform: 'uppercase', color: 'var(--ink-3)' } }, 'Audit review'), h('b', null, title), h('span', null, sub)), h('div', { class: 'rb-acts' }, acts));
  };

  /* Table of vouchers (works for user / branch / all scopes). */
  V.voucherTable = function (rows, o) {
    o = o || {};
    const open = (v) => (o.onOpen ? o.onOpen(v) : (location.hash = '#/vouchers/' + v.id));
    const body = h('tbody');
    // o.select = { map: Map(id -> row), onChange() } adds a tick-box column (Super Admin bulk delete)
    const sel = o.select || null;
    const headBox = sel ? h('input', { type: 'checkbox', 'aria-label': 'Select all vouchers on this page' }) : null;
    const rowBoxes = [];
    const syncBoxes = () => {
      const n = rows.filter((v) => sel.map.has(v.id)).length;
      headBox.checked = n > 0 && n === rows.length; headBox.indeterminate = n > 0 && n < rows.length;
      rowBoxes.forEach(([cb, tr, v]) => { cb.checked = sel.map.has(v.id); tr.classList.toggle('picked', cb.checked); });
    };
    if (sel) headBox.addEventListener('change', () => { rows.forEach((v) => { if (headBox.checked) sel.map.set(v.id, v); else sel.map.delete(v.id); }); syncBoxes(); sel.onChange(); });
    rows.forEach((v) => {
      const inn = v.type === 'RECEIPT', cls = v.status === 'VOID' ? 'void click' : 'click';
      const who = [o.showUser ? v.userName : null, o.showBranch ? V.branchShort(v) : null].filter(Boolean).join(' · ');
      const notCounted = v.status === 'ACTIVE' && v.counted === false; // marked "Not valid" in the audit review
      const amt = h('td', { class: 'num keep' }, h('span', { class: (inn ? 'amt-in' : 'amt-out') + (notCounted ? ' amt-struck' : '') }, (inn ? '+ ' : '− ') + RW.fmtINR(v.amountPaise)),
        o.compact && v.status === 'VOID' ? h('span', { class: 'sub' }, 'VOID') : null, notCounted ? h('span', { class: 'sub bad' }, 'Not valid') : null);
      const tr = h('tr', { class: cls, tabindex: 0, onclick: () => open(v), onkeydown: (e) => { if (e.key === 'Enter') open(v); } });
      if (sel) {
        const cb = h('input', { type: 'checkbox', 'aria-label': 'Select ' + v.label });
        cb.addEventListener('change', () => { if (cb.checked) sel.map.set(v.id, v); else sel.map.delete(v.id); syncBoxes(); sel.onChange(); });
        tr.appendChild(h('td', { class: 'sel-col keep', onclick: (e) => e.stopPropagation(), onkeydown: (e) => e.stopPropagation() }, cb));
        rowBoxes.push([cb, tr, v]);
      }
      if (o.compact) {
        tr.appendChild(h('td', { class: 'keep' }, V.vno(v), h('span', { class: 'sub' }, RW.fmtDate(v.date))));
        tr.appendChild(h('td', { class: 'trunc full', 'data-label': inn ? 'Received from' : 'Paid to' }, v.partyName, h('span', { class: 'sub' }, v.particulars), who ? h('span', { class: 'sub who' }, who) : null));
        tr.appendChild(amt);
      } else {
        tr.appendChild(h('td', { class: 'keep' }, V.vno(v), h('span', { class: 'sub' }, RW.fmtDate(v.date))));
        tr.appendChild(h('td', { class: 'hide-m' }, UI.typeBadge(v.type, v.kind)));
        tr.appendChild(h('td', { class: 'trunc full', 'data-label': inn ? 'Received from' : 'Paid to' }, v.partyName, h('span', { class: 'sub' }, v.particulars)));
        if (o.showUser) tr.appendChild(h('td', { class: 'hide-m nowrap' }, v.userName));
        if (o.showBranch) tr.appendChild(h('td', { class: 'hide-m nowrap' }, V.branchShort(v)));
        tr.appendChild(amt);
        tr.appendChild(h('td', { class: 'keep hide-m' }, UI.statusBadge(v.status), v.status === 'ACTIVE' && v.review !== 'NA' ? h('span', { class: 'sub', style: { marginTop: '4px' } }, UI.reviewBadge(v.review)) : null, v.attachmentCount ? h('span', { class: 'sub', style: { marginTop: '4px' } }, UI.icon('clip', 11), ' ' + v.attachmentCount) : null));
      }
      body.appendChild(tr);
    });
    const head = o.compact
      ? h('tr', null, h('th', null, 'Voucher'), h('th', null, 'Party / Particulars'), h('th', { class: 'num' }, 'Amount'))
      : h('tr', null, sel ? h('th', { class: 'sel-col' }, headBox) : null, h('th', null, 'Voucher'), h('th', { class: 'hide-m' }, 'Type'), h('th', null, 'Party / Particulars'), o.showUser ? h('th', { class: 'hide-m' }, 'User') : null, o.showBranch ? h('th', { class: 'hide-m' }, 'Branch') : null, h('th', { class: 'num' }, 'Amount'), h('th', { class: 'hide-m' }, 'Status'));
    if (sel) syncBoxes();
    return h('div', { class: 'tbl-wrap' }, h('table', { class: 'tbl rt' }, h('thead', null, head), body));
  };

  V.loading = (rows) => h('div', { class: 'card' }, UI.skeleton(rows || 6));
  V.errorCard = (e, retry) => h('div', { class: 'card' }, UI.empty('Could not load this page', UI.errMsg(e), 'alert', retry ? h('button', { class: 'btn btn-ghost btn-sm', style: { marginTop: '14px' }, onclick: retry }, UI.icon('refresh', 14), 'Try again') : null));

  V.dateInput = (value, attrs) => h('input', Object.assign({ type: 'date', value: value || '' }, attrs || {}));

  // preset chips ("Today / This Week / ...") returning {el, get(), set()}
  V.presetChips = function (presets, value, onChange) {
    const wrap = h('div', { class: 'chips', role: 'group' });
    let cur = value;
    const set = (v, fire) => { cur = v; UI.$$('.chip', wrap).forEach((c) => c.classList.toggle('active', c.dataset.v === v)); if (fire && onChange) onChange(v); };
    presets.forEach((p) => wrap.appendChild(h('button', { class: 'chip', type: 'button', dataset: { v: p.value }, onclick: () => set(p.value, true) }, p.label)));
    set(value, false);
    return { el: wrap, get: () => cur, set: (v) => set(v, false) };
  };
  V.PRESETS = [{ value: 'today', label: 'Today' }, { value: 'yesterday', label: 'Yesterday' }, { value: 'week', label: 'This Week' }, { value: 'month', label: 'This Month' }, { value: 'year', label: 'This Year' }, { value: 'custom', label: 'Custom' }];

  // Pull branches + users for filter dropdowns (admin screens)
  V.branchOptions = async (app, all) => {
    const r = await RW.api.call('branches.list', {});
    return (all === false ? [] : [{ value: '', label: 'All branches' }]).concat(r.rows.map((b) => ({ value: b.id, label: V.branchShort(b) })));
  };
  V.userOptions = async (branchId) => {
    const r = await RW.api.call('users.list', { filters: { branchId: branchId || undefined } });
    return r.rows.filter((u) => u.registerId);
  };

  /* A voucher scene -> SVG node (always white paper) */
  V.voucherSvg = function (voucher, company) {
    const scene = RW.voucherScene(voucher, company);
    const wrap = h('div', { class: 'paper' });
    wrap.innerHTML = RW.sceneToSvg(scene, { label: voucher.kind === 'RECEIVED' ? 'Cash received entry' : 'Voucher ' + voucher.number }); // trusted: all text passed through RW.esc in sceneToSvg
    return wrap;
  };

  /* Download helpers used by several screens */
  V.voucherPdf = async function (voucherId, opts) {
    opts = opts || {};
    const d = await RW.api.call('vouchers.get', { id: voucherId });
    const images = [];
    for (const a of d.attachments) {
      try {
        const blob = await RW.api.call('attachments.get', { id: a.id });
        images.push({ name: a.name, mime: a.mime, jpeg: await RW.img.toJpegBytes(blob.dataUrl) });
      } catch (e) { images.push({ name: a.name, mime: a.mime, jpeg: null }); }
    }
    await RW.loadFonts();
    const bytes = await RW.buildVoucherPdf({ voucher: d.voucher, company: d.company }, { images });
    try { await RW.api.call('vouchers.logPdf', { id: voucherId }); } catch (e) { /* non-fatal */ }
    if (opts.open) UI.openBlob(bytes, 'application/pdf');
    else UI.download(bytes, (d.voucher.number || 'Cash-Received-' + d.voucher.date) + '.pdf', 'application/pdf');
    return d;
  };
})(typeof window !== 'undefined' ? window : globalThis);
