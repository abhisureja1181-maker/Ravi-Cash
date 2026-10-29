/* Ravi Cash — chart library (plain SVG). Follows the dataviz spec: thin marks, 4px rounded data-ends,
 * 2px surface gaps, hairline recessive grid, legend for >=2 series, hover tooltips (textContent only),
 * keyboard access, and a "table view" for every chart. Colours come from CSS tokens (--c1..--c3) so
 * light/dark are separately validated palettes. */
(function (g) {
  'use strict';
  const RW = (g.RW = g.RW || {});
  const UI = RW.ui;
  const { h, svg } = UI;
  const CH = (RW.charts = {});
  const registry = new Set();

  const cssVar = (el, name, fallback) => {
    const v = g.getComputedStyle(el).getPropertyValue(name).trim();
    return v || fallback;
  };

  function niceStep(raw) {
    const p = Math.pow(10, Math.floor(Math.log10(raw || 1)));
    const f = raw / p;
    return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10) * p;
  }
  function scale(min, max, ticks) {
    if (max === min) { max = max + 1; min = Math.min(min, 0); }
    const lo = Math.min(0, min);
    const step = niceStep((max - lo) / (ticks || 4));
    const top = Math.ceil(max / step) * step;
    const bot = lo < 0 ? Math.floor(lo / step) * step : 0;
    const out = [];
    for (let v = bot; v <= top + step / 1000; v += step) out.push(Math.round(v * 1000) / 1000);
    return { min: bot, max: top, ticks: out };
  }

  /* ------------------------------------------------------------------ shell */
  function shell(host, o) {
    UI.clear(host);
    host.classList.add('chart');
    const hasLegend = o.series && o.series.length > 1;
    const legend = hasLegend ? h('div', { class: 'chart-legend' }, o.series.map((s, i) => h('span', { class: 'lg' }, h('i', { class: 'lg-key ' + (o.kind === 'line' ? 'line' : 'box'), style: { background: 'var(--c' + (s.slot || i + 1) + ')' } }), s.name))) : null;
    const plot = h('div', { class: 'chart-plot', style: { height: (o.height || 220) + 'px' } });
    const tip = h('div', { class: 'chart-tip', role: 'status' });
    plot.appendChild(tip);
    const table = h('div', { class: 'chart-table', hidden: true });
    const toggle = h('button', { class: 'chart-toggle', type: 'button', 'aria-pressed': 'false', title: 'Show data as a table', onclick: () => {
      const on = table.hidden;
      table.hidden = !on; plot.hidden = on; if (legend) legend.hidden = on;
      toggle.setAttribute('aria-pressed', String(on));
      toggle.textContent = on ? 'Chart' : 'Table';
    } }, 'Table');
    host.appendChild(h('div', { class: 'chart-top' }, legend || h('span'), toggle));
    host.appendChild(plot); host.appendChild(table);
    return { plot, tip, table };
  }
  function dataTable(el, o, fmt) {
    UI.clear(el);
    const head = h('tr', null, h('th', null, o.xTitle || ''), o.series.map((s) => h('th', { class: 'num' }, s.name)));
    const body = o.labels.map((l, i) => h('tr', null, h('td', null, l), o.series.map((s) => h('td', { class: 'num' }, fmt(s.values[i])))));
    el.appendChild(h('table', { class: 'tbl tbl-sm' }, h('thead', null, head), h('tbody', null, body)));
  }
  function showTip(st, x, y, title, rows) {
    const t = st.tip;
    UI.clear(t);
    t.appendChild(h('div', { class: 'tip-title' }, title));
    rows.forEach((r) => t.appendChild(h('div', { class: 'tip-row' }, h('i', { class: 'lg-key ' + (r.line ? 'line' : 'box'), style: { background: r.color } }), h('b', null, r.value), h('span', null, r.name))));
    t.classList.add('on');
    const pw = st.plot.clientWidth, tw = t.offsetWidth, th = t.offsetHeight;
    let left = x + 14;
    if (left + tw > pw - 4) left = x - tw - 14;
    t.style.left = Math.max(4, left) + 'px';
    t.style.top = Math.max(2, Math.min(y - th / 2, st.plot.clientHeight - th - 2)) + 'px';
  }
  const hideTip = (st) => st.tip.classList.remove('on');

  function axes(S, o, W, H, M, sc, n, band, xAt) {
    const gridC = 'var(--chart-grid)';
    // gridlines + y labels
    sc.ticks.forEach((v) => {
      const y = M.t + (1 - (v - sc.min) / (sc.max - sc.min)) * (H - M.t - M.b);
      S.appendChild(svg('line', { x1: M.l, x2: W - M.r, y1: y, y2: y, stroke: v === 0 ? 'var(--chart-axis)' : gridC, 'stroke-width': 1 }));
      const t = svg('text', { x: M.l - 8, y: y + 3.5, 'text-anchor': 'end', class: 'ax' });
      t.textContent = (o.axisFormat || RW.compactINR)(v);
      S.appendChild(t);
    });
    // x labels, thinned to fit
    const labW = o.labelWidth || 44;
    const every = Math.max(1, Math.ceil(n / Math.max(1, Math.floor((W - M.l - M.r) / labW))));
    for (let i = 0; i < n; i += every) {
      const t = svg('text', { x: xAt(i), y: H - 6, 'text-anchor': 'middle', class: 'ax' });
      t.textContent = o.labels[i];
      S.appendChild(t);
    }
  }

  /* ------------------------------------------------------------------- bars */
  CH.bars = function (host, o) {
    const st = shell(host, Object.assign({ kind: 'bar' }, o));
    const fmt = o.valueFormat || RW.fmtINR;
    const draw = (animate) => {
      const W = st.plot.clientWidth || 600, H = o.height || 220;
      const M = { l: o.marginLeft || 52, r: 6, t: 8, b: 24 };
      const n = o.labels.length, k = o.series.length;
      const all = o.series.flatMap((s) => s.values);
      const sc = scale(Math.min(0, ...all), Math.max(...all, 1), 4);
      const innerW = W - M.l - M.r, innerH = H - M.t - M.b;
      const band = innerW / n;
      const gap = 2;
      const bw = Math.max(2, Math.min(24, (band * 0.72 - gap * (k - 1)) / k));
      const gw = bw * k + gap * (k - 1);
      const xAt = (i) => M.l + band * i + band / 2;
      const yAt = (v) => M.t + (1 - (v - sc.min) / (sc.max - sc.min)) * innerH;
      const S = svg('svg', { width: W, height: H, viewBox: '0 0 ' + W + ' ' + H, role: 'img', 'aria-label': o.ariaLabel || o.title || 'Bar chart', tabindex: 0, class: 'chart-svg' });
      axes(S, o, W, H, M, sc, n, band, xAt);
      const hl = svg('rect', { class: 'hl', y: M.t, height: innerH, width: band, rx: 4, fill: 'var(--chart-hover)', opacity: 0 });
      S.appendChild(hl);
      const y0 = yAt(0);
      const bars = [];
      o.series.forEach((s, si) => {
        s.values.forEach((v, i) => {
          if (!v) return;
          const x = xAt(i) - gw / 2 + si * (bw + gap);
          const top = v >= 0 ? yAt(v) : y0, hgt = Math.max(1, Math.abs(yAt(v) - y0));
          const r = Math.min(4, bw / 2, hgt);
          const d = v >= 0
            ? 'M' + x + ' ' + (top + hgt) + 'V' + (top + r) + 'Q' + x + ' ' + top + ' ' + (x + r) + ' ' + top + 'H' + (x + bw - r) + 'Q' + (x + bw) + ' ' + top + ' ' + (x + bw) + ' ' + (top + r) + 'V' + (top + hgt) + 'Z'
            : 'M' + x + ' ' + top + 'V' + (top + hgt - r) + 'Q' + x + ' ' + (top + hgt) + ' ' + (x + r) + ' ' + (top + hgt) + 'H' + (x + bw - r) + 'Q' + (x + bw) + ' ' + (top + hgt) + ' ' + (x + bw) + ' ' + (top + hgt - r) + 'V' + top + 'Z';
          const p = svg('path', { d, fill: 'var(--c' + (s.slot || si + 1) + ')', class: 'bar' });
          p.dataset.i = i;
          if (animate && !UI.reduceMotion()) {
            p.style.transformOrigin = x + 'px ' + y0 + 'px';
            p.style.transform = 'scaleY(0)';
            p.style.transition = 'transform .75s cubic-bezier(.2,.8,.2,1) ' + Math.min(i * 22, 500) + 'ms';
            requestAnimationFrame(() => requestAnimationFrame(() => { p.style.transform = 'scaleY(1)'; }));
          }
          S.appendChild(p); bars.push(p);
        });
      });
      const hit = svg('rect', { x: M.l, y: M.t, width: innerW, height: innerH, fill: 'transparent', style: 'touch-action:pan-y' });
      S.appendChild(hit);
      let cur = -1;
      const focus = (i) => {
        if (i < 0 || i >= n) return;
        cur = i;
        hl.setAttribute('x', xAt(i) - band / 2); hl.setAttribute('opacity', 1);
        bars.forEach((b) => b.classList.toggle('dim', +b.dataset.i !== i));
        showTip(st, xAt(i), M.t + innerH / 2, o.fullLabels ? o.fullLabels[i] : o.labels[i], o.series.map((s, si) => ({ name: s.name, value: fmt(s.values[i]), color: 'var(--c' + (s.slot || si + 1) + ')' })));
      };
      const leave = () => { cur = -1; hl.setAttribute('opacity', 0); bars.forEach((b) => b.classList.remove('dim')); hideTip(st); };
      const idxAt = (e) => { const r = hit.getBoundingClientRect(); return Math.max(0, Math.min(n - 1, Math.floor(((e.clientX - r.left) / r.width) * n))); };
      hit.addEventListener('pointermove', (e) => focus(idxAt(e)));
      hit.addEventListener('pointerdown', (e) => focus(idxAt(e)));
      hit.addEventListener('pointerleave', leave);
      S.addEventListener('keydown', (e) => { if (e.key === 'ArrowRight') { focus(Math.min(n - 1, cur + 1)); e.preventDefault(); } else if (e.key === 'ArrowLeft') { focus(Math.max(0, cur < 0 ? 0 : cur - 1)); e.preventDefault(); } else if (e.key === 'Escape') leave(); });
      S.addEventListener('blur', leave);
      st.plot.querySelectorAll('svg').forEach((x) => x.remove());
      st.plot.insertBefore(S, st.tip);
    };
    dataTable(st.table, o, fmt);
    return mountRedraw(host, st, draw, o);
  };

  /* ------------------------------------------------------------------ lines */
  CH.line = function (host, o) {
    const st = shell(host, Object.assign({ kind: 'line' }, o));
    const fmt = o.valueFormat || RW.fmtINR;
    const draw = (animate) => {
      const W = st.plot.clientWidth || 600, H = o.height || 220;
      const M = { l: o.marginLeft || 52, r: 14, t: 10, b: 24 };
      const n = o.labels.length;
      const all = o.series.flatMap((s) => s.values);
      const sc = scale(Math.min(...all, 0), Math.max(...all, 1), 4);
      const innerW = W - M.l - M.r, innerH = H - M.t - M.b;
      const xAt = (i) => (n === 1 ? M.l + innerW / 2 : M.l + (innerW * i) / (n - 1));
      const yAt = (v) => M.t + (1 - (v - sc.min) / (sc.max - sc.min)) * innerH;
      const S = svg('svg', { width: W, height: H, viewBox: '0 0 ' + W + ' ' + H, role: 'img', 'aria-label': o.ariaLabel || o.title || 'Line chart', tabindex: 0, class: 'chart-svg' });
      axes(S, o, W, H, M, sc, n, 0, xAt);
      const cross = svg('line', { y1: M.t, y2: M.t + innerH, stroke: 'var(--chart-axis)', 'stroke-width': 1, opacity: 0 });
      S.appendChild(cross);
      const dots = [];
      o.series.forEach((s, si) => {
        const slot = s.slot || si + 1, col = 'var(--c' + slot + ')';
        const pts = s.values.map((v, i) => [xAt(i), yAt(v)]);
        const d = pts.map((p, i) => (i ? 'L' : 'M') + p[0].toFixed(1) + ' ' + p[1].toFixed(1)).join('');
        if (o.area !== false && (o.area || o.series.length === 1)) S.appendChild(svg('path', { d: d + 'L' + pts[n - 1][0] + ' ' + yAt(Math.max(sc.min, 0)) + 'L' + pts[0][0] + ' ' + yAt(Math.max(sc.min, 0)) + 'Z', fill: col, opacity: 0.1 }));
        const line = svg('path', { d, fill: 'none', stroke: col, 'stroke-width': 2, 'stroke-linejoin': 'round', 'stroke-linecap': 'round' });
        S.appendChild(line);
        if (animate && !UI.reduceMotion()) {
          requestAnimationFrame(() => {
            const len = line.getTotalLength ? line.getTotalLength() : 1200;
            line.style.strokeDasharray = len; line.style.strokeDashoffset = len;
            line.getBoundingClientRect();
            line.style.transition = 'stroke-dashoffset 1.1s cubic-bezier(.3,.7,.2,1)';
            line.style.strokeDashoffset = 0;
          });
        }
        const last = pts[n - 1];
        S.appendChild(svg('circle', { cx: last[0], cy: last[1], r: 4, fill: col, stroke: 'var(--surface)', 'stroke-width': 2 }));
        dots.push(svg('circle', { r: 4.5, fill: col, stroke: 'var(--surface)', 'stroke-width': 2, opacity: 0 }));
      });
      dots.forEach((d) => S.appendChild(d));
      const hit = svg('rect', { x: M.l - 6, y: M.t, width: innerW + 12, height: innerH, fill: 'transparent', style: 'touch-action:pan-y' });
      S.appendChild(hit);
      let cur = -1;
      const focus = (i) => {
        if (i < 0 || i >= n) return;
        cur = i;
        cross.setAttribute('x1', xAt(i)); cross.setAttribute('x2', xAt(i)); cross.setAttribute('opacity', 1);
        dots.forEach((d, si) => { d.setAttribute('cx', xAt(i)); d.setAttribute('cy', yAt(o.series[si].values[i])); d.setAttribute('opacity', 1); });
        showTip(st, xAt(i), M.t + innerH / 2, o.fullLabels ? o.fullLabels[i] : o.labels[i], o.series.map((s, si) => ({ name: s.name, value: fmt(s.values[i]), color: 'var(--c' + (s.slot || si + 1) + ')', line: true })));
      };
      const leave = () => { cur = -1; cross.setAttribute('opacity', 0); dots.forEach((d) => d.setAttribute('opacity', 0)); hideTip(st); };
      const idxAt = (e) => { const r = hit.getBoundingClientRect(); const f = (e.clientX - r.left - 6) / (r.width - 12); return Math.max(0, Math.min(n - 1, Math.round(f * (n - 1)))); };
      hit.addEventListener('pointermove', (e) => focus(idxAt(e)));
      hit.addEventListener('pointerdown', (e) => focus(idxAt(e)));
      hit.addEventListener('pointerleave', leave);
      S.addEventListener('keydown', (e) => { if (e.key === 'ArrowRight') { focus(Math.min(n - 1, cur + 1)); e.preventDefault(); } else if (e.key === 'ArrowLeft') { focus(Math.max(0, cur < 0 ? 0 : cur - 1)); e.preventDefault(); } else if (e.key === 'Escape') leave(); });
      S.addEventListener('blur', leave);
      st.plot.querySelectorAll('svg').forEach((x) => x.remove());
      st.plot.insertBefore(S, st.tip);
    };
    dataTable(st.table, o, fmt);
    return mountRedraw(host, st, draw, o);
  };

  /* ------------------------------------------------------------------ donut */
  // items: [{ label, value, slot }]  (<= 6 segments; part-to-whole only)
  CH.donut = function (host, o) {
    UI.clear(host);
    host.classList.add('chart', 'chart-donut');
    const fmt = o.valueFormat || RW.fmtINR;
    const total = o.items.reduce((a, i) => a + Math.max(0, i.value), 0);
    const size = o.size || 176, r = size / 2 - 16, sw = 18, C = 2 * Math.PI * r;
    const S = svg('svg', { width: size, height: size, viewBox: '0 0 ' + size + ' ' + size, role: 'img', 'aria-label': o.ariaLabel || 'Donut chart' });
    S.appendChild(svg('circle', { cx: size / 2, cy: size / 2, r, fill: 'none', stroke: 'var(--chart-grid)', 'stroke-width': sw }));
    const tip = h('div', { class: 'chart-tip' });
    const wrapSvg = h('div', { class: 'donut-svg' }, S, tip);
    let acc = 0;
    const gap = total > 0 && o.items.filter((i) => i.value > 0).length > 1 ? 2.5 : 0;
    const segs = [];
    o.items.forEach((it, i) => {
      if (it.value <= 0 || !total) return;
      const len = (it.value / total) * C;
      const c = svg('circle', { cx: size / 2, cy: size / 2, r, fill: 'none', stroke: 'var(--c' + (it.slot || i + 1) + ')', 'stroke-width': sw, 'stroke-dasharray': Math.max(0.5, len - gap) + ' ' + (C - Math.max(0.5, len - gap)), 'stroke-dashoffset': -acc, transform: 'rotate(-90 ' + size / 2 + ' ' + size / 2 + ')', class: 'seg', tabindex: 0, 'aria-label': it.label + ' ' + fmt(it.value) });
      acc += len;
      const on = () => { segs.forEach((s) => s.classList.toggle('dim', s !== c)); UI.clear(tip); tip.appendChild(h('div', { class: 'tip-title' }, it.label)); tip.appendChild(h('div', { class: 'tip-row' }, h('i', { class: 'lg-key box', style: { background: 'var(--c' + (it.slot || i + 1) + ')' } }), h('b', null, fmt(it.value)), h('span', null, Math.round((it.value / total) * 100) + '%'))); tip.classList.add('on'); tip.style.left = size / 2 - tip.offsetWidth / 2 + 'px'; tip.style.top = size / 2 - 18 + 'px'; };
      const off = () => { segs.forEach((s) => s.classList.remove('dim')); tip.classList.remove('on'); };
      c.addEventListener('pointerenter', on); c.addEventListener('pointerleave', off); c.addEventListener('focus', on); c.addEventListener('blur', off);
      if (!UI.reduceMotion()) { c.style.opacity = 0; c.style.transition = 'opacity .5s ease ' + i * 120 + 'ms'; requestAnimationFrame(() => requestAnimationFrame(() => { c.style.opacity = 1; })); }
      segs.push(c); S.appendChild(c);
    });
    if (o.center) {
      const t1 = svg('text', { x: size / 2, y: size / 2 - 1, 'text-anchor': 'middle', class: 'donut-val' }); t1.textContent = o.center.value;
      const t2 = svg('text', { x: size / 2, y: size / 2 + 15, 'text-anchor': 'middle', class: 'ax' }); t2.textContent = o.center.label;
      S.appendChild(t1); S.appendChild(t2);
    }
    const legend = h('ul', { class: 'donut-legend' }, o.items.map((it, i) => h('li', null, h('i', { class: 'lg-key box', style: { background: 'var(--c' + (it.slot || i + 1) + ')' } }), h('span', { class: 'dl-name' }, it.label), h('b', null, fmt(it.value)), h('em', null, total ? Math.round((it.value / total) * 100) + '%' : '0%'))));
    host.appendChild(h('div', { class: 'donut-wrap' }, wrapSvg, legend));
    return { redraw() {}, destroy() {} };
  };

  /* -------------------------------------------------------------- sparkline */
  CH.spark = function (host, values, o) {
    o = o || {};
    UI.clear(host);
    const W = o.width || 96, H = o.height || 28;
    const min = Math.min(...values), max = Math.max(...values);
    const rng = max - min || 1;
    const pts = values.map((v, i) => [(W * i) / Math.max(1, values.length - 1), H - 3 - ((v - min) / rng) * (H - 8)]);
    const d = pts.map((p, i) => (i ? 'L' : 'M') + p[0].toFixed(1) + ' ' + p[1].toFixed(1)).join('');
    const S = svg('svg', { width: W, height: H, viewBox: '0 0 ' + W + ' ' + H, 'aria-hidden': 'true', class: 'spark' });
    S.appendChild(svg('path', { d, fill: 'none', stroke: 'var(--c' + (o.slot || 1) + ')', 'stroke-width': 1.8, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }));
    const l = pts[pts.length - 1];
    S.appendChild(svg('circle', { cx: l[0], cy: l[1], r: 2.6, fill: 'var(--c' + (o.slot || 1) + ')', stroke: 'var(--surface)', 'stroke-width': 1.5 }));
    host.appendChild(S);
  };

  /* ------------------------------------------------- horizontal ranked bars */
  // items: [{ label, sub, value, slot }] — one colour; thin bars that grow in
  CH.hbars = function (host, items, o) {
    o = o || {};
    UI.clear(host);
    const fmt = o.valueFormat || RW.fmtINR;
    const max = Math.max(1, ...items.map((i) => i.value));
    host.classList.add('hbars');
    items.forEach((it, i) => {
      const bar = h('i', { style: { width: '0%', background: 'var(--c' + (it.slot || o.slot || 1) + ')' } });
      host.appendChild(h('div', { class: 'hb-row' }, h('div', { class: 'hb-top' }, h('span', { class: 'hb-label' }, it.label, it.sub ? h('small', null, it.sub) : null), h('b', null, fmt(it.value))), h('div', { class: 'hb-track' }, bar)));
      setTimeout(() => { bar.style.width = Math.max(1.5, (it.value / max) * 100) + '%'; }, UI.reduceMotion() ? 0 : 60 + i * 60);
    });
  };

  /* ---------------------------------------------------- redraw & theme hooks */
  function mountRedraw(host, st, draw, o) {
    let first = !(o && o.animate === false), w = 0;
    const run = () => { const cw = st.plot.clientWidth; if (!cw) return; w = cw; draw(first); first = false; };
    const inst = { redraw: run, destroy() { registry.delete(inst); if (ro) ro.disconnect(); } };
    let ro = null;
    if (typeof ResizeObserver !== 'undefined') {
      ro = new ResizeObserver(UI.debounce(() => { if (st.plot.clientWidth !== w) run(); }, 80));
      ro.observe(st.plot);
    }
    registry.add(inst);
    // draw as soon as the element is laid out
    requestAnimationFrame(() => { if (host.isConnected) run(); else setTimeout(run, 50); });
    return inst;
  }
  CH.redrawAll = () => registry.forEach((c) => { try { c.redraw(); } catch (e) { /* ignore */ } });
})(typeof window !== 'undefined' ? window : globalThis);
