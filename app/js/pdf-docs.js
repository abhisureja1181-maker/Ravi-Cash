/* Ravi Cash — PDF documents: voucher (+ attachment pages), statements and tabular reports. */
(function (g) {
  'use strict';
  const RW = (g.RW = g.RW || {});
  const C = () => RW.COLORS;

  async function newDoc(title, subject) {
    await RW.loadFonts();
    const pdf = new RW.Pdf({ info: { title, subject: subject || '', author: 'Ravi Water Flow Pump' } });
    for (const k of ['regular', 'medium', 'semibold', 'bold']) pdf.addFont(k, RW.fonts[k]);
    return pdf;
  }

  /* ============================================================ voucher (A4) */
  // d = { voucher, company }, o.images = [{ name, mime, jpeg: Uint8Array|null }]
  RW.buildVoucherPdf = async function (d, o) {
    o = o || {};
    const v = d.voucher, c = C();
    const rcvd = v.kind === 'RECEIVED';
    const pdf = await newDoc(rcvd ? 'Cash Received' : 'Voucher ' + v.number, (rcvd ? 'Cash Received' : v.type === 'PAYMENT' ? 'Cash Payment Voucher' : 'Cash Receipt Voucher') + ' – ' + v.partyName);
    const F = RW.fonts;
    const images = o.images || [];
    const page = pdf.addPage(210, 297);
    const scene = RW.voucherScene(v, d.company);
    RW.sceneToPdf(page, scene);

    // fold line + notes under the voucher
    page.line(10, 196, 200, 196, { stroke: c.line, lw: 0.2, dash: [1.5, 1.5] });
    page.text('Fold / cut along this line', 105, 199.5, { size: 6, color: c.gray, align: 'center' });
    let y = 210;
    if (scene.overflow) {
      page.text('Particulars (continued)', 12, y, { font: 'semibold', size: 9, color: c.navy });
      y += 5;
      for (const ln of F.regular.wrap(scene.overflow, 9, 184)) { if (y > 280) break; page.text(ln, 12, y, { size: 9, color: c.ink }); y += 4.6; }
      y += 4;
    }
    if (v.notes) {
      page.text('Notes', 12, y, { font: 'semibold', size: 9, color: c.navy }); y += 5;
      for (const ln of F.regular.wrap(v.notes, 9, 184)) { if (y > 280) break; page.text(ln, 12, y, { size: 9, color: c.ink }); y += 4.6; }
      y += 4;
    }
    if (images.length) {
      page.text(images.length + ' receipt attachment' + (images.length > 1 ? 's' : '') + ' follow on the next page' + (images.length > 1 ? 's' : '') + '.', 12, y, { size: 8.5, color: c.gray });
    }
    page.text((rcvd ? 'Cash Received entry' : 'Voucher ' + v.number) + (v.status === 'VOID' ? ' — VOID' : v.review === 'INVALID' ? ' — NOT VALID (not counted as expense)' : ''), 105, 290, { size: 6.5, color: c.gray, align: 'center' });

    images.forEach((im, i) => {
      const p = pdf.addPage(210, 297);
      p.rect(0, 0, 210, 20, { fill: c.navy });
      p.rect(0, 20, 210, 0.9, { fill: c.orange });
      p.text('Attached receipt ' + (i + 1) + ' of ' + images.length, 12, 10, { font: 'bold', size: 11, color: '#FFFFFF' });
      p.text((rcvd ? 'Cash Received' : v.number) + '  •  ' + v.partyName + '  •  ' + RW.fmtINR2(v.amountPaise), 12, 16, { size: 8, color: '#D6E0EC' });
      p.text(im.name || '', 198, 16, { size: 7.5, color: '#D6E0EC', align: 'right' });
      if (im.jpeg) {
        const inf = RW.jpegInfo(im.jpeg);
        const bw = 186, bh = 255;
        const k = Math.min(bw / inf.width, bh / inf.height);
        const w = inf.width * k, h = inf.height * k;
        const img = pdf.addJpeg(im.jpeg);
        const x = 12 + (bw - w) / 2, yy = 28;
        p.rect(x - 0.6, yy - 0.6, w + 1.2, h + 1.2, { stroke: c.line, lw: 0.3 });
        p.image(img, x, yy, w, h);
      } else {
        p.rect(12, 40, 186, 40, { stroke: c.line, lw: 0.3, dash: [1.5, 1.5], r: 2 });
        p.text('This attachment is a PDF file and cannot be embedded here.', 105, 58, { size: 10, color: c.ink, align: 'center', font: 'semibold' });
        p.text('Download it separately from the voucher screen: ' + (im.name || ''), 105, 65, { size: 8.5, color: c.gray, align: 'center' });
      }
      p.text('Page ' + (i + 2) + ' of ' + (images.length + 1), 105, 291, { size: 6.5, color: c.gray, align: 'center' });
    });
    return pdf.save();
  };

  /* ====================================================== table documents (A4) */
  /* spec = {
   *   title, subtitle, number, landscape, company, identity:[{label,value}], cards:[{label,value,tone}],
   *   columns:[{label, w, align, wrap, key}], rows:[{cells:[...], bold, fill, color}], note,
   *   generatedBy, generatedAt, branchName }
   */
  RW.buildTableDoc = async function (spec) {
    const c = C(), F = RW.fonts;
    const pdf = await newDoc(spec.title + (spec.number ? ' ' + spec.number : ''), spec.subtitle || '');
    const W = spec.landscape === false ? 210 : 297, H = spec.landscape === false ? 297 : 210;
    const M = 10, cw = W - M * 2;
    const total = spec.columns.reduce((a, k) => a + k.w, 0);
    const cols = spec.columns.map((k) => Object.assign({}, k, { w: (k.w / total) * cw }));
    const xs = []; { let x = M; for (const k of cols) { xs.push(x); x += k.w; } }
    const PADX = 1.6, SZ = spec.fontSize || 7.2, LH = SZ * 0.4 + 0.9, MAXL = spec.maxLines || 3;

    // ---- measure rows
    const meas = (row) => {
      let lines = 1;
      const cells = row.cells.map((t, i) => {
        const k = cols[i];
        const w = k.w - PADX * 2;
        const f = F[row.bold ? 'semibold' : 'regular'];
        const ls = k.wrap ? f.wrap(String(t === null || t === undefined ? '' : t), SZ, w).slice(0, MAXL) : [f.ellipsize(String(t === null || t === undefined ? '' : t), SZ, w)];
        if (k.wrap && f.wrap(String(t || ''), SZ, w).length > MAXL) ls[MAXL - 1] = f.ellipsize(ls[MAXL - 1] + ' …', SZ, w);
        lines = Math.max(lines, ls.length);
        return ls;
      });
      return { row, cells, h: lines * LH + 2.6 };
    };
    const rows = spec.rows.map(meas);
    const headH = 7;

    // ---- first-page header height
    const firstTop = spec.cards && spec.cards.length ? 74 : spec.identity ? 56 : 36;
    const nextTop = 22;
    const bottom = H - 15;
    const pages = [];
    let cur = { rows: [], top: firstTop }, yy = firstTop + headH;
    for (const r of rows) {
      if (yy + r.h > bottom && cur.rows.length) { pages.push(cur); cur = { rows: [], top: nextTop }; yy = nextTop + headH; }
      cur.rows.push(r); yy += r.h;
    }
    pages.push(cur);
    const nPages = pages.length;

    const drawFooter = (p, n) => {
      p.line(M, H - 11.5, W - M, H - 11.5, { stroke: c.line, lw: 0.25 });
      const left = ['Generated By: ' + (spec.generatedBy || ''), 'Generated: ' + RW.fmtDateTime(spec.generatedAt || new Date().toISOString()), 'Branch: ' + (spec.branchName || '')].join('   •   ');
      p.text(F.regular.ellipsize(left, 6.8, cw - 40), M, H - 7.2, { size: 6.8, color: c.gray });
      p.text('Page ' + n + ' of ' + nPages, W - M, H - 7.2, { size: 6.8, color: c.gray, align: 'right', font: 'medium' });
      p.text('Computer generated document — Ravi Water Flow Pump Cash Management System', W / 2, H - 3.8, { size: 5.8, color: '#98A4B3', align: 'center' });
    };
    const drawTableHead = (p, y) => {
      p.rect(M, y, cw, headH, { fill: c.navy });
      cols.forEach((k, i) => {
        const tx = k.align === 'right' ? xs[i] + k.w - PADX : k.align === 'center' ? xs[i] + k.w / 2 : xs[i] + PADX;
        p.text(k.label.toUpperCase(), tx, y + 4.6, { font: 'semibold', size: 6.4, color: '#FFFFFF', align: k.align || 'left', cs: 0.3 });
      });
    };

    pages.forEach((pg, pi) => {
      const p = pdf.addPage(W, H);
      if (pi === 0) {
        // brand band
        p.rect(0, 0, W, 24, { fill: c.navy });
        p.rect(0, 24, W, 1, { fill: c.orange });
        // the company logo on a white tile (the logo picture has a white background)
        const lg = RW.logoPrims('full', M + 2, 3.6, 16.8);
        if (RW.logoJpg.full) p.rect(M, 2.6, lg.w + 4, 18.8, { fill: '#FFFFFF', r: 1.6 });
        lg.prims.forEach((pr) => {
          if (pr.t === 'image') p.image(RW.pdfLogo(pdf, pr.name), pr.x, pr.y, pr.w, pr.h);
          else if (pr.t === 'circle') p.circle(pr.cx, pr.cy, pr.r, Object.assign({}, pr, pr.fill ? { fill: '#FFFFFF' } : {}));
          else if (pr.t === 'path') p.path(pr.d, pr);
          else if (pr.t === 'text') p.text(pr.s, pr.x, pr.y, { font: pr.weight, size: pr.size, color: '#FFFFFF', cs: pr.cs });
        });
        p.text(spec.title.toUpperCase(), W - M, 11, { font: 'bold', size: 12.5, color: '#FFFFFF', align: 'right', cs: 0.8 });
        p.text([spec.subtitle, spec.number].filter(Boolean).join('   •   '), W - M, 17, { size: 7.5, color: '#D6E0EC', align: 'right' });
        let y = 31;
        if (spec.identity && spec.identity.length) {
          const n = spec.identity.length, gw = cw / n;
          spec.identity.forEach((it, i) => {
            const x = M + i * gw;
            if (i) p.line(x - 3, y - 2, x - 3, y + 14, { stroke: c.line, lw: 0.25 });
            p.text(it.label.toUpperCase(), x, y + 1.6, { font: 'semibold', size: 6.2, color: c.gray, cs: 0.5 });
            const val = String(it.value || '');
            const s = F.bold.fit(val, 11, gw - 6, 7.5);
            p.text(F.bold.ellipsize(val, s, gw - 6), x, y + 8, { font: 'bold', size: s, color: c.navy });
            if (it.sub) p.text(F.regular.ellipsize(it.sub, 6.8, gw - 6), x, y + 12.6, { size: 6.8, color: c.gray });
          });
          y += 20;
        }
        if (spec.cards && spec.cards.length) {
          const n = spec.cards.length, gap = 3, cwd = (cw - gap * (n - 1)) / n;
          spec.cards.forEach((cd, i) => {
            const x = M + i * (cwd + gap);
            const tone = cd.tone === 'in' ? c.inflow : cd.tone === 'out' ? c.outflow : cd.tone === 'accent' ? c.orange : c.navy;
            p.rect(x, y, cwd, 15.5, { stroke: c.line, lw: 0.3, r: 1.4, fill: cd.tone === 'accent' ? '#FFF7F1' : '#F7F9FC' });
            p.rect(x, y + 2, 0.9, 11.5, { fill: tone });
            p.text(cd.label.toUpperCase(), x + 3.4, y + 5, { font: 'semibold', size: 6, color: c.gray, cs: 0.4 });
            const s = F.bold.fit(cd.value, 12.5, cwd - 6, 8);
            p.text(cd.value, x + 3.4, y + 12, { font: 'bold', size: s, color: tone });
          });
          y += 20;
        }
        drawTableHead(p, firstTop);
      } else {
        p.rect(0, 0, W, 12, { fill: c.navy });
        p.rect(0, 12, W, 0.6, { fill: c.orange });
        p.text('RAVI WATER FLOW PUMPS', M, 7.6, { font: 'bold', size: 9, color: '#FFFFFF', cs: 0.8 });
        p.text([spec.title, spec.number].filter(Boolean).join('  •  '), W - M, 7.6, { size: 7.5, color: '#D6E0EC', align: 'right' });
        drawTableHead(p, nextTop - 2);
      }
      let y = pg.top + headH - (pi === 0 ? 0 : 2);
      pg.rows.forEach((r, ri) => {
        const fill = r.row.fill || (ri % 2 ? '#F6F8FB' : null);
        if (fill) p.rect(M, y, cw, r.h, { fill });
        r.cells.forEach((ls, i) => {
          const k = cols[i];
          const tx = k.align === 'right' ? xs[i] + k.w - PADX : k.align === 'center' ? xs[i] + k.w / 2 : xs[i] + PADX;
          ls.forEach((ln, li) => p.text(ln, tx, y + 1.3 + SZ * 0.36 + 0.5 + li * LH + 0.6, { font: r.row.bold ? 'semibold' : (k.bold ? 'medium' : 'regular'), size: SZ, color: (r.row.colors && r.row.colors[i]) || r.row.color || c.ink, align: k.align || 'left' }));
        });
        p.line(M, y + r.h, M + cw, y + r.h, { stroke: '#E3E9F0', lw: 0.15 });
        y += r.h;
      });
      if (pi === nPages - 1 && spec.note) {
        y += 4;
        for (const ln of F.regular.wrap(spec.note, 7, cw)) { p.text(ln, M, y, { size: 7, color: c.gray }); y += 3.6; }
      }
      drawFooter(p, pi + 1);
    });
    return pdf.save();
  };

  /* ============================================================== statements */
  RW.buildStatementPdf = async function (st) {
    const m = (p) => RW.fmtINR2(p, { symbol: false });
    const money = (p) => (p ? m(p) : '');
    const typeName = (t, kind) => (kind === 'RECEIVED' ? 'Cash Received' : t === 'PAYMENT' ? 'Cash Payment' : 'Cash Receipt');
    const rows = [{ cells: [RW.fmtDate(st.from), '', '', '', 'Opening Balance — cash brought forward', '', '', m(st.openingPaise)], bold: true, fill: '#EAF0F7' }];
    for (const r of st.rows) rows.push({
      // a payment marked "Not valid" in the audit review is listed but not counted
      cells: [RW.fmtDate(r.date), r.number || '—', typeName(r.type, r.kind), r.partyName, r.particulars, money(r.inPaise), r.notValid ? 'Not valid' : money(r.outPaise), m(r.balancePaise)],
      colors: [null, null, null, null, null, RW.COLORS.inflow, r.notValid ? RW.COLORS.gray || null : RW.COLORS.outflow, null],
    });
    rows.push({ cells: [RW.fmtDate(st.to), '', '', '', 'Closing Balance — total ' + st.count + ' entr' + (st.count === 1 ? 'y' : 'ies') + (st.notValidCount ? ' (+' + st.notValidCount + ' not valid, not counted)' : ''), m(st.inPaise), m(st.outPaise), m(st.closingPaise)], bold: true, fill: '#EAF0F7' });
    const spec = {
      title: 'Cash Statement', subtitle: st.period.name + ' Statement', number: st.number, landscape: true, company: st.company,
      identity: [
        { label: 'Statement of', value: st.user.fullName, sub: st.user.designation || '' },
        { label: 'Branch', value: st.branch ? st.branch.name : '' },
        { label: 'Period', value: st.period.label },
        { label: 'Cash Register', value: st.register.id, sub: st.user.username },
      ],
      cards: [
        { label: 'Opening Balance', value: '₹' + m(st.openingPaise) },
        { label: 'Cash Inflow', value: '₹' + m(st.inPaise), tone: 'in' },
        { label: 'Cash Outflow', value: '₹' + m(st.outPaise), tone: 'out' },
        { label: 'Closing Balance', value: '₹' + m(st.closingPaise), tone: 'accent' },
        { label: 'Total Entries', value: String(st.count) },
      ],
      columns: [
        { label: 'Date', w: 19 }, { label: 'Voucher No.', w: 22 }, { label: 'Type', w: 25 }, { label: 'Party', w: 50, wrap: true }, { label: 'Particulars', w: 83, wrap: true },
        { label: 'Cash In (₹)', w: 26, align: 'right' }, { label: 'Cash Out (₹)', w: 26, align: 'right' }, { label: 'Balance (₹)', w: 28, align: 'right' },
      ],
      rows,
      note: st.voidedCount ? st.voidedCount + ' voided voucher' + (st.voidedCount > 1 ? 's' : '') + ' in this period are excluded from the totals.' : '',
      generatedBy: st.generatedBy.fullName, generatedAt: st.generatedAt, branchName: st.generatedByBranch,
    };
    return RW.buildTableDoc(spec);
  };
})(typeof window !== 'undefined' ? window : globalThis);
