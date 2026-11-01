/* Ravi Cash — UI toolkit: DOM builder, icons, toasts, modals, count-up, pager, helpers. */
(function (g) {
  'use strict';
  const RW = (g.RW = g.RW || {});
  const UI = (RW.ui = RW.ui || {});
  const doc = g.document;

  /* ----------------------------------------------------------------- DOM builder */
  const SVGNS = 'http://www.w3.org/2000/svg';
  function h(tag, attrs) {
    const el = doc.createElement(tag);
    apply(el, attrs);
    for (let i = 2; i < arguments.length; i++) add(el, arguments[i]);
    return el;
  }
  function apply(el, attrs) {
    if (!attrs) return;
    for (const k of Object.keys(attrs)) {
      const v = attrs[k];
      if (v === null || v === undefined || v === false) continue;
      if (k === 'class') el.className = v;
      else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
      else if (k === 'dataset') Object.assign(el.dataset, v);
      else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
      else if (k === 'value') el.value = v;
      else if (k === 'checked' || k === 'disabled' || k === 'selected' || k === 'hidden' || k === 'required' || k === 'multiple' || k === 'readOnly') el[k] = !!v;
      else if (v === true) el.setAttribute(k, '');
      else el.setAttribute(k, v);
    }
  }
  function add(el, c) {
    if (c === null || c === undefined || c === false) return;
    if (Array.isArray(c)) c.forEach((x) => add(el, x));
    else if (c.nodeType) el.appendChild(c);
    else el.appendChild(doc.createTextNode(String(c)));
  }
  function svg(tag, attrs) {
    const el = doc.createElementNS(SVGNS, tag);
    if (attrs) for (const k of Object.keys(attrs)) if (attrs[k] !== null && attrs[k] !== undefined) el.setAttribute(k, attrs[k]);
    for (let i = 2; i < arguments.length; i++) add(el, arguments[i]);
    return el;
  }
  UI.h = h; UI.svg = svg;
  UI.clear = (el) => { while (el.firstChild) el.removeChild(el.firstChild); return el; };
  UI.mount = (el, ...kids) => { UI.clear(el); kids.forEach((k) => add(el, k)); return el; };
  UI.$ = (sel, root) => (root || doc).querySelector(sel);
  UI.$$ = (sel, root) => Array.from((root || doc).querySelectorAll(sel));

  /* ----------------------------------------------------------------------- icons */
  const P = {
    home: 'M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z',
    file: 'M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8zM14 3v5h5M9 13h6M9 17h6',
    plus: 'M12 5v14M5 12h14',
    wallet: 'M3 7a2 2 0 0 1 2-2h13v4M3 7v11a2 2 0 0 0 2 2h14a1 1 0 0 0 1-1v-9a1 1 0 0 0-1-1H5a2 2 0 0 1-2-2zM16 14.5h.01',
    chart: 'M4 20V10M10 20V4M16 20v-8M22 20H2',
    user: 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM4 21a8 8 0 0 1 16 0',
    users: 'M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM2 21a7 7 0 0 1 14 0M17 3.2a4 4 0 0 1 0 7.6M22 21a7 7 0 0 0-4.5-6.5',
    building: 'M4 21V5a1 1 0 0 1 1-1h8a1 1 0 0 1 1 1v16M14 9h5a1 1 0 0 1 1 1v11M2 21h20M8 8h2M8 12h2M8 16h2M16.5 13h.01M16.5 17h.01',
    shield: 'M12 3 4 6v6c0 4.5 3.2 8 8 9 4.8-1 8-4.5 8-9V6zM9 12l2 2 4-4',
    bell: 'M6 8a6 6 0 1 1 12 0c0 7 3 8 3 8H3s3-1 3-8M10.3 21a2 2 0 0 0 3.4 0',
    search: 'M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16zM21 21l-4.3-4.3',
    settings: 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z',
    camera: 'M4 8a2 2 0 0 1 2-2h1.5l1.2-2h6.6l1.2 2H18a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2zM12 17a4 4 0 1 0 0-8 4 4 0 0 0 0 8z',
    image: 'M5 3h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2zM9 10a2 2 0 1 0 0-4 2 2 0 0 0 0 4zM21 16l-5-5L5 21',
    clip: 'M21 11.5 12.5 20a5.5 5.5 0 0 1-7.8-7.8L13 4a3.7 3.7 0 0 1 5.2 5.2L9.9 17.5a1.8 1.8 0 0 1-2.6-2.6L15 7.2',
    download: 'M12 3v12M7 10l5 5 5-5M4 21h16',
    printer: 'M6 9V3h12v6M6 18H4a1 1 0 0 1-1-1v-6a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v6a1 1 0 0 1-1 1h-2M6 14h12v7H6z',
    lock: 'M6 11h12a1 1 0 0 1 1 1v8a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1v-8a1 1 0 0 1 1-1zM8 11V7a4 4 0 0 1 8 0v4',
    edit: 'M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z',
    trash: 'M4 7h16M10 11v6M14 11v6M5 7l1 13a1 1 0 0 0 1 1h10a1 1 0 0 0 1-1l1-13M9 7V4h6v3',
    x: 'M18 6 6 18M6 6l12 12',
    check: 'M20 6 9 17l-5-5',
    alert: 'M12 9v4M12 17h.01M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z',
    info: 'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20zM12 16v-4M12 8h.01',
    right: 'M9 6l6 6-6 6',
    left: 'M15 6l-6 6 6 6',
    down: 'M6 9l6 6 6-6',
    up: 'M6 15l6-6 6 6',
    moon: 'M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z',
    sun: 'M12 16a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4',
    logout: 'M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9',
    eye: 'M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12zM12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z',
    eyeoff: 'M17.9 17.9A10.1 10.1 0 0 1 12 19c-6.4 0-10-7-10-7a18 18 0 0 1 5.1-5.9M9.9 4.2A9 9 0 0 1 12 4c6.4 0 10 7 10 7a18 18 0 0 1-2.2 3.2M1 1l22 22M14.1 14.1a3 3 0 1 1-4.2-4.2',
    refresh: 'M21 12a9 9 0 0 1-15.5 6.2L3 16M3 12a9 9 0 0 1 15.5-6.2L21 8M21 3v5h-5M3 21v-5h5',
    clock: 'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20zM12 6v6l4 2',
    wifioff: 'M1 1l22 22M16.7 11.1A11 11 0 0 1 21 13.5M5 13.5a11 11 0 0 1 5.2-2.9M8.5 16.4a6 6 0 0 1 7 0M2 8.8a15 15 0 0 1 4.2-2.7M10.7 5.1A15 15 0 0 1 22 8.8M12 20h.01',
    cloudup: 'M16 16l-4-4-4 4M12 12v9M20.4 18.9A5 5 0 0 0 18 9.6h-1.3A8 8 0 1 0 3 16.3',
    menu: 'M3 6h18M3 12h18M3 18h18',
    filter: 'M22 3H2l8 9.5V19l4 2v-8.5z',
    calendar: 'M5 4h14a2 2 0 0 1 2 2v13a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2zM16 2v4M8 2v4M3 10h18',
    inflow: 'M17 7 7 17M7 8v9h9',
    outflow: 'M7 17 17 7M8 7h9v9',
    swap: 'M7 4 3 8l4 4M3 8h15M17 20l4-4-4-4M21 16H6',
    rupee: 'M6 3h12M6 8h12M9 13h-3 3a5 5 0 0 0 0-10M6 13l8.5 8',
    key: 'M21 2l-2 2m-7.6 7.6a5.5 5.5 0 1 1-7.8 7.8 5.5 5.5 0 0 1 7.8-7.8zm0 0L15.5 7.5m0 0 3 3L22 7l-3-3m-3.5 3.5L19 4',
    history: 'M3 12a9 9 0 1 0 3-6.7L3 8M3 3v5h5M12 7v5l4 2',
    ban: 'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20zM4.9 4.9l14.2 14.2',
    copy: 'M9 9h10a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2V11a2 2 0 0 1 2-2zM5 15H4a2 2 0 0 1-2-2V3a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v1',
    more: 'M12 12h.01M19 12h.01M5 12h.01',
    scale: 'M12 3v18M5 7l7-3 7 3M3 15l2-8 2 8a3.5 3.5 0 0 1-4 0zM17 15l2-8 2 8a3.5 3.5 0 0 1-4 0z',
    layers: 'M12 2 2 7l10 5 10-5zM2 17l10 5 10-5M2 12l10 5 10-5',
    pie: 'M21 12A9 9 0 1 1 12 3v9zM15 3.5A9 9 0 0 1 20.5 9H15z',
    install: 'M12 3v12M7 10l5 5 5-5M5 21h14',
    drop: 'M12 3s7 7 7 12a7 7 0 0 1-14 0c0-5 7-12 7-12z',
    map: 'M9 4 3 6.5v13L9 17l6 3 6-2.5v-13L15 7zM9 4v13M15 7v13',
    pin: 'M12 22s7-6.3 7-12a7 7 0 1 0-14 0c0 5.7 7 12 7 12zM12 12.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5z',
    route: 'M6 21a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5zM18 8a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5zM8.5 18.5H15a3.5 3.5 0 0 0 0-7H9a3.5 3.5 0 0 1 0-7h6.5',
    phone: 'M5 4h3.5l1.7 4.3-2.2 1.4a11 11 0 0 0 5.3 5.3l1.4-2.2L19 14.5V18a2 2 0 0 1-2 2A14 14 0 0 1 3 6a2 2 0 0 1 2-2z',
  };
  UI.icon = function (name, size, cls) {
    const s = svg('svg', { viewBox: '0 0 24 24', width: size || 18, height: size || 18, fill: 'none', stroke: 'currentColor', 'stroke-width': 1.9, 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'aria-hidden': 'true', class: 'ico' + (cls ? ' ' + cls : '') });
    s.appendChild(svg('path', { d: P[name] || P.info }));
    return s;
  };

  /* -------------------------------------------------------------- reduced motion */
  UI.reduceMotion = () => { try { return g.matchMedia && g.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (e) { return false; } };

  /* ---------------------------------------------------------------------- toasts */
  let toastBox = null;
  UI.toast = function (msg, kind, opts) {
    opts = opts || {};
    if (!toastBox) { toastBox = h('div', { class: 'toasts', role: 'status', 'aria-live': 'polite' }); doc.body.appendChild(toastBox); }
    const ic = { success: 'check', error: 'alert', info: 'info', live: 'bell', warn: 'alert' }[kind || 'info'];
    const t = h('div', { class: 'toast toast-' + (kind || 'info') },
      h('span', { class: 'toast-ic' }, UI.icon(ic, 16)),
      h('div', { class: 'toast-body' }, opts.title ? h('b', null, opts.title) : null, h('span', null, msg)),
      h('button', { class: 'toast-x', 'aria-label': 'Dismiss', onclick: () => kill() }, UI.icon('x', 14)));
    let timer;
    const kill = () => { clearTimeout(timer); t.classList.add('out'); setTimeout(() => t.remove(), 220); };
    if (opts.onClick) { t.classList.add('clickable'); t.querySelector('.toast-body').addEventListener('click', () => { opts.onClick(); kill(); }); }
    toastBox.appendChild(t);
    while (toastBox.children.length > 4) toastBox.firstChild.remove();
    timer = setTimeout(kill, opts.ms || (kind === 'error' ? 6500 : 4200));
    return kill;
  };

  /* ---------------------------------------------------------------------- modals */
  const openModals = [];
  UI.modal = function (o) {
    const back = h('div', { class: 'modal-back' });
    const box = h('div', { class: 'modal ' + (o.size ? 'modal-' + o.size : ''), role: 'dialog', 'aria-modal': 'true', 'aria-label': o.title || 'Dialog' });
    const head = h('div', { class: 'modal-head' }, h('h3', null, o.title || ''), h('button', { class: 'icon-btn', 'aria-label': 'Close', onclick: () => api.close() }, UI.icon('x', 18)));
    const body = h('div', { class: 'modal-body' }, o.body);
    box.appendChild(head); box.appendChild(body);
    let foot = null;
    if (o.actions && o.actions.length) {
      foot = h('div', { class: 'modal-foot' });
      o.actions.forEach((a) => {
        const b = h('button', { class: 'btn ' + (a.kind ? 'btn-' + a.kind : 'btn-ghost'), type: 'button' }, a.icon ? UI.icon(a.icon, 16) : null, a.label);
        b.addEventListener('click', async () => {
          if (b.disabled) return;
          if (!a.onClick) return api.close();
          b.disabled = true; b.classList.add('busy');
          try { const r = await a.onClick(api); if (r !== false && !a.keepOpen) api.close(); } catch (e) { UI.toast(e.message || 'Something went wrong', 'error'); } finally { b.disabled = false; b.classList.remove('busy'); }
        });
        foot.appendChild(b);
      });
      box.appendChild(foot);
    }
    back.appendChild(box);
    const prevFocus = doc.activeElement;
    const api = {
      el: box, body, foot,
      close(res) {
        if (api.closed) return; api.closed = true;
        back.classList.add('out'); setTimeout(() => back.remove(), 180);
        const i = openModals.indexOf(api); if (i >= 0) openModals.splice(i, 1);
        if (!openModals.length) doc.body.classList.remove('modal-open');
        if (prevFocus && prevFocus.focus) try { prevFocus.focus(); } catch (e) { /* ignore */ }
        if (o.onClose) o.onClose(res);
      },
      setBusy(on) { UI.$$('button', foot || box).forEach((b) => { b.disabled = !!on; }); },
    };
    back.addEventListener('mousedown', (e) => { if (e.target === back && !o.persistent) api.close(); });
    doc.body.appendChild(back);
    doc.body.classList.add('modal-open');
    openModals.push(api);
    requestAnimationFrame(() => { back.classList.add('in'); const f = box.querySelector('[autofocus],input:not([type=hidden]),textarea,select'); if (f && !o.noFocus) try { f.focus({ preventScroll: true }); } catch (e) { /* ignore */ } });
    return api;
  };
  doc.addEventListener('keydown', (e) => { if (e.key === 'Escape' && openModals.length) { const m = openModals[openModals.length - 1]; m.close(); } });
  UI.closeAllModals = () => openModals.slice().forEach((m) => m.close());

  UI.confirm = function (o) {
    return new Promise((res) => {
      let done = false;
      const fin = (v) => { if (!done) { done = true; res(v); } };
      UI.modal({
        title: o.title || 'Are you sure?', size: 'sm', onClose: () => fin(false),
        body: h('div', { class: 'confirm-body' }, o.icon ? h('div', { class: 'confirm-ic ' + (o.tone || '') }, UI.icon(o.icon, 22)) : null, h('div', null, typeof o.message === 'string' ? h('p', null, o.message) : o.message)),
        actions: [{ label: o.cancel || 'Cancel' }, { label: o.ok || 'Confirm', kind: o.tone === 'danger' ? 'danger' : 'primary', onClick: () => { fin(true); } }],
      });
    });
  };

  /* ------------------------------------------------------------------ count-up */
  UI.animateValue = function (el, to, fmt, opts) {
    opts = opts || {};
    fmt = fmt || ((v) => String(Math.round(v)));
    const from = typeof el._v === 'number' ? el._v : opts.from === undefined ? 0 : opts.from;
    el._v = to;
    el.dataset.value = String(to);
    if (UI.reduceMotion() || from === to) { el.textContent = fmt(to); return; }
    const dur = opts.duration || (typeof el._played === 'undefined' ? 1100 : 650);
    el._played = true;
    const t0 = performance.now();
    cancelAnimationFrame(el._raf);
    const ease = (t) => 1 - Math.pow(1 - t, 4);
    const step = (now) => {
      const t = Math.min(1, (now - t0) / dur);
      el.textContent = fmt(from + (to - from) * ease(t));
      if (t < 1) el._raf = requestAnimationFrame(step); else el.textContent = fmt(to);
    };
    el._raf = requestAnimationFrame(step);
  };
  // whole rupees while counting, exact paise at the end
  UI.money = (el, paise, o) => UI.animateValue(el, paise, (v) => RW.fmtINR(v === paise ? paise : Math.round(v / 100) * 100, { decimals: o && o.decimals }), o);

  /* ------------------------------------------------------------------- helpers */
  UI.badge = (text, tone, icon) => h('span', { class: 'badge badge-' + (tone || 'gray') }, icon ? UI.icon(icon, 12) : null, text);
  UI.statusBadge = function (st) {
    if (st === 'VOID') return UI.badge('VOID', 'red', 'ban');
    if (st === 'DELETED') return UI.badge('DELETED', 'gray', 'trash');
    return UI.badge('LOCKED', 'navy', 'lock');
  };
  UI.userStatusBadge = (s) => UI.badge(s, s === 'ACTIVE' ? 'green' : s === 'SUSPENDED' ? 'red' : 'gray');
  UI.roleName = (r) => ({ SUPER_ADMIN: 'Super Admin', CEO: 'CEO', BRANCH_ADMIN: 'Branch Admin', USER: 'Branch User', VIEWER: 'Viewer' }[r] || r);
  // kind === 'RECEIVED' is "Cash Received": money handed to a user, stored as a receipt but without a voucher number
  // `tr` (the voucher's transfer info) turns a payment / receipt into "Transfer out / in": money moved between branches or people, not expense or income
  UI.typeLabel = (t, kind, tr) => (tr ? (t === 'PAYMENT' ? 'Transfer Out' : 'Transfer In') : kind === 'RECEIVED' ? 'Cash Received' : t === 'PAYMENT' ? 'Cash Payment' : 'Cash Receipt');
  UI.typeBadge = (t, kind, tr) => (tr
    ? h('span', { class: 'type-pill xfer' }, UI.icon('swap', 12), t === 'PAYMENT' ? 'Transfer out' : 'Transfer in')
    : h('span', { class: 'type-pill ' + (t === 'PAYMENT' ? 'out' : 'in') }, UI.icon(kind === 'RECEIVED' ? 'wallet' : t === 'PAYMENT' ? 'outflow' : 'inflow', 12), kind === 'RECEIVED' ? 'Received' : t === 'PAYMENT' ? 'Payment' : 'Receipt'));
  // "to Indore · Rahul" / "from Main · Suresh" for a transfer
  UI.transferWho = (tr) => (tr ? (tr.dir === 'OUT' ? 'to ' : 'from ') + (tr.branchName || 'a branch') + (tr.userName ? ' · ' + tr.userName : '') : '');
  // audit review of a payment: VALID counts as expense, INVALID ("Not valid") does not, PENDING is not reviewed yet
  UI.reviewLabel = (r) => ({ VALID: 'Valid', INVALID: 'Not valid', PENDING: 'To review' }[r] || '');
  UI.reviewBadge = (r) => (r === 'VALID' ? UI.badge('VALID', 'green', 'check') : r === 'INVALID' ? UI.badge('NOT VALID', 'red', 'ban') : r === 'PENDING' ? UI.badge('TO REVIEW', 'amber', 'clock') : null);

  UI.empty = (title, text, icon, action) => h('div', { class: 'empty' }, h('div', { class: 'empty-ic' }, UI.icon(icon || 'file', 26)), h('h4', null, title), text ? h('p', null, text) : null, action || null);
  UI.skeleton = (rows, cls) => h('div', { class: 'skeleton-wrap ' + (cls || '') }, Array.from({ length: rows || 4 }, (_, i) => h('div', { class: 'skeleton', style: { width: 100 - (i % 3) * 14 + '%' } })));

  UI.pager = function (st, onPage) {
    if (!st || st.pages <= 1) return h('div', { class: 'pager' }, h('span', { class: 'pager-info' }, st ? st.total + ' record' + (st.total === 1 ? '' : 's') : ''));
    const from = (st.page - 1) * st.pageSize + 1, to = Math.min(st.total, st.page * st.pageSize);
    const mk = (n, label, dis, active) => h('button', { class: 'pager-btn' + (active ? ' active' : ''), disabled: dis, 'aria-label': 'Page ' + n, onclick: () => onPage(n) }, label);
    const nums = [];
    const set = new Set([1, st.pages, st.page - 1, st.page, st.page + 1]);
    let last = 0;
    [...set].filter((n) => n >= 1 && n <= st.pages).sort((a, b) => a - b).forEach((n) => { if (n - last > 1) nums.push(h('span', { class: 'pager-gap' }, '…')); nums.push(mk(n, String(n), false, n === st.page)); last = n; });
    return h('div', { class: 'pager' }, h('span', { class: 'pager-info' }, from + '–' + to + ' of ' + st.total),
      h('div', { class: 'pager-btns' }, mk(st.page - 1, UI.icon('left', 16), st.page <= 1), nums, mk(st.page + 1, UI.icon('right', 16), st.page >= st.pages)));
  };

  // label + control wrapper
  UI.field = function (label, control, o) {
    o = o || {};
    const id = control.id || (control.id = 'f_' + Math.random().toString(36).slice(2, 8));
    return h('div', { class: 'field' + (o.class ? ' ' + o.class : '') }, h('label', { for: id }, label, o.optional ? h('i', null, ' (optional)') : null), control, o.hint ? h('small', null, o.hint) : null, h('em', { class: 'field-err', role: 'alert' }));
  };
  UI.fieldError = (field, msg) => { const e = field.querySelector('.field-err'); if (e) e.textContent = msg || ''; field.classList.toggle('has-err', !!msg); };
  UI.select = (options, value, attrs) => {
    const s = h('select', attrs || {});
    options.forEach((o) => { const op = h('option', { value: o.value }, o.label); if (String(o.value) === String(value)) op.selected = true; s.appendChild(op); });
    return s;
  };
  UI.segmented = function (options, value, onChange, cls) {
    const wrap = h('div', { class: 'seg ' + (cls || ''), role: 'tablist' });
    const set = (v, fire) => { wrap.dataset.value = v; UI.$$('button', wrap).forEach((b) => { b.classList.toggle('active', b.dataset.v === v); b.setAttribute('aria-selected', b.dataset.v === v); }); if (fire && onChange) onChange(v); };
    options.forEach((o) => wrap.appendChild(h('button', { type: 'button', role: 'tab', dataset: { v: o.value }, class: o.tone ? 'tone-' + o.tone : '', onclick: () => set(o.value, true) }, o.icon ? UI.icon(o.icon, 15) : null, o.label)));
    set(value, false);
    wrap.set = (v) => set(v, false);
    wrap.get = () => wrap.dataset.value;
    return wrap;
  };
  UI.copy = async (text) => { try { await navigator.clipboard.writeText(text); UI.toast('Copied to clipboard', 'success', { ms: 1800 }); } catch (e) { UI.toast('Copy failed — select and copy manually', 'warn'); } };
  UI.debounce = (fn, ms) => { let t; const d = (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; d.cancel = () => clearTimeout(t); return d; };
  UI.errMsg = (e) => (e && e.message) || 'Something went wrong';

  // stagger-reveal children (CSS handles the animation)
  UI.stagger = (root, sel, step) => { if (UI.reduceMotion()) return; UI.$$(sel || ':scope > *', root).forEach((el, i) => { el.style.setProperty('--d', Math.min(i, 14) * (step || 35) + 'ms'); el.classList.add('reveal'); }); };

  // file saving
  UI.download = function (bytes, filename, mime) {
    const blob = bytes instanceof Blob ? bytes : new Blob([bytes], { type: mime || 'application/octet-stream' });
    const url = URL.createObjectURL(blob);
    const a = h('a', { href: url, download: filename, style: { display: 'none' } });
    doc.body.appendChild(a); a.click();
    setTimeout(() => { a.remove(); URL.revokeObjectURL(url); }, 4000);
  };
  UI.openBlob = function (bytes, mime) {
    const url = URL.createObjectURL(new Blob([bytes], { type: mime }));
    const w = g.open(url, '_blank');
    setTimeout(() => URL.revokeObjectURL(url), 60000);
    return w;
  };
  UI.safeName = (s) => String(s).replace(/[^A-Za-z0-9._-]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 80);
})(typeof window !== 'undefined' ? window : globalThis);
