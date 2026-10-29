/* Ravi Cash — the OFFICIAL cash voucher template.
 * One layout definition (a list of drawing primitives in millimetres) is rendered both as SVG (on-screen
 * preview) and as PDF vector graphics, so what you see is exactly what prints.
 *
 * NOTE: rebuilt from the written description in the project brief (navy + orange, fields, footer
 * signatures, stamp box). When the original voucher image is supplied, only this file needs adjusting. */
(function (g) {
  'use strict';
  const RW = (g.RW = g.RW || {});

  RW.COLORS = { navy: '#0B2A4A', navy2: '#12365C', orange: '#F26B1D', ink: '#17283B', gray: '#667587', line: '#C9D2DE', light: '#EEF2F7', green: '#17794A', red: '#C0392B', inflow: '#1F5FB5', outflow: '#D9480F' };
  const C = RW.COLORS;
  const WEIGHTS = { regular: 400, medium: 500, semibold: 600, bold: 700 };

  /* ----------------------------------------------------------------- fonts / assets */
  RW.fonts = RW.fonts || {};
  RW.loadAsset = async function (path) {
    if (RW.assets && RW.assets[path]) return RW.dataUrlBytes('data:;base64,' + RW.assets[path]);
    if (RW.assetLoader) return RW.assetLoader(path);
    const r = await fetch(path);
    if (!r.ok) throw new Error('Cannot load ' + path);
    return new Uint8Array(await r.arrayBuffer());
  };
  RW.loadFonts = async function () {
    if (RW.fonts.regular && RW.fonts.bold) { await RW.loadLogos(); return RW.fonts; }
    const names = { regular: 'Regular', medium: 'Medium', semibold: 'SemiBold', bold: 'Bold' };
    for (const k of Object.keys(names)) RW.fonts[k] = new RW.TTFont(await RW.loadAsset('fonts/Inter-' + names[k] + '.ttf'), 'Inter-' + names[k]);
    await RW.loadLogos();
    return RW.fonts;
  };

  /* ----------------------------------------------------------------- the company logo (a picture supplied by the owner)
   * "full" = whole logo with the ISO line and PUMP caption; "mark" = only the framed RAVI letters (small spaces).
   * Both are JPEG on pure white: the voucher and the PDFs are white, and in the app the logo sits on a white tile. */
  RW.LOGO = { full: { file: 'img/logo.jpg', w: 345, h: 208 }, mark: { file: 'img/logo-mark.jpg', w: 325, h: 168 } };
  RW.logoJpg = {};   // name -> bytes (set by loadLogos); the voucher falls back to the drawn mark while a logo is missing
  RW.bytesToDataUrl = function (bytes, mime) {
    let bin = '';
    for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    return 'data:' + mime + ';base64,' + (typeof btoa === 'function' ? btoa(bin) : Buffer.from(bin, 'binary').toString('base64'));
  };
  RW.loadLogos = async function () {
    for (const k of Object.keys(RW.LOGO)) {
      if (RW.logoJpg[k]) continue;
      try { RW.logoJpg[k] = await RW.loadAsset(RW.LOGO[k].file); } catch (e) { /* no picture: the drawn mark is used */ }
    }
  };
  // src for an <img> in the app (an embedded copy in the single-file demo, the normal file otherwise)
  RW.logoSrc = (k) => (RW.assets && RW.assets[RW.LOGO[k].file] ? 'data:image/jpeg;base64,' + RW.assets[RW.LOGO[k].file] : RW.LOGO[k].file);
  // the logo as a drawing primitive of height h at (x, y); width follows the picture. Falls back to the drawn mark + word-mark.
  RW.logoPrims = function (k, x, y, h) {
    const L = RW.LOGO[k], w = h * L.w / L.h;
    if (RW.logoJpg[k]) return { prims: [{ t: 'image', name: k, x, y, w, h }], w };
    const r = h * 0.36;
    return { prims: RW.logoMark(x + r, y + h / 2, r).concat(RW.fonts.bold ? RW.wordmark(x + r * 2 + 3, y + h / 2 - 0.4, h / 23) : []), w: r * 2 + 3 + 26 * h / 23 };
  };

  /* ----------------------------------------------------------------- logo mark */
  // Water-drop in a circle. `variant: 'light'` is for dark backgrounds.
  RW.logoMark = function (cx, cy, r, variant) {
    const p = [];
    const m = (x, y) => (cx + x * r).toFixed(3) + ' ' + (cy + y * r).toFixed(3);
    const dark = variant !== 'light';
    p.push({ t: 'circle', cx, cy, r, fill: dark ? C.navy : '#FFFFFF' });
    p.push({ t: 'circle', cx, cy, r: r * 0.88, stroke: C.orange, lw: Math.max(0.2, r * 0.05) });
    const drop = 'M ' + m(0, -0.62) + ' C ' + m(0.2, -0.36) + ' ' + m(0.44, -0.12) + ' ' + m(0.44, 0.14) + ' C ' + m(0.44, 0.4) + ' ' + m(0.24, 0.58) + ' ' + m(0, 0.58)
      + ' C ' + m(-0.24, 0.58) + ' ' + m(-0.44, 0.4) + ' ' + m(-0.44, 0.14) + ' C ' + m(-0.44, -0.12) + ' ' + m(-0.2, -0.36) + ' ' + m(0, -0.62) + ' Z';
    p.push({ t: 'path', d: drop, fill: C.orange });
    const wave = 'M ' + m(-0.3, 0.2) + ' C ' + m(-0.16, 0.08) + ' ' + m(-0.06, 0.3) + ' ' + m(0.08, 0.18) + ' C ' + m(0.17, 0.11) + ' ' + m(0.24, 0.14) + ' ' + m(0.3, 0.2);
    p.push({ t: 'path', d: wave, stroke: dark ? '#FFFFFF' : C.navy, lw: Math.max(0.25, r * 0.07), cap: 'round' });
    return p;
  };

  // "RAVI  water flow PUMPS" word-mark. Returns primitives; x,y = left / baseline of the big word.
  RW.wordmark = function (x, y, scale, variant) {
    const dark = variant !== 'light';
    const F = RW.fonts;
    const big = 25 * scale, small = 10.5 * scale;
    const ravi = { t: 'text', s: 'RAVI', x, y, size: big, weight: 'bold', color: dark ? C.navy : '#FFFFFF', cs: 1.2 * scale };
    const y2 = y + 6.3 * scale;
    const wf = { t: 'text', s: 'water flow', x, y: y2, size: small, weight: 'semibold', color: C.orange };
    const w1 = F.semibold ? F.semibold.width('water flow ', small) : 22 * scale;
    const pm = { t: 'text', s: 'PUMPS', x: x + w1 + 0.6, y: y2, size: small, weight: 'bold', color: dark ? C.navy : '#FFFFFF', cs: 1.4 * scale };
    return [ravi, wf, pm];
  };

  /* ----------------------------------------------------------------- the voucher */
  // Returns { prims, width, height, overflow } — drawing area is the voucher block only.
  RW.voucherScene = function (v, company, opts) {
    opts = opts || {};
    const F = RW.fonts;
    const P = [];
    const X0 = 12, Y0 = 12, W = 186, H = 176;
    const isPay = v.type === 'PAYMENT';
    const isRcvd = v.kind === 'RECEIVED'; // money handed to a user: same layout, but it has no voucher number
    const rect = (x, y, w, h, o) => P.push(Object.assign({ t: 'rect', x, y, w, h }, o));
    const line = (x1, y1, x2, y2, o) => P.push(Object.assign({ t: 'line', x1, y1, x2, y2 }, o));
    const text = (s, x, y, size, weight, color, o) => P.push(Object.assign({ t: 'text', s, x, y, size, weight: weight || 'regular', color: color || C.ink }, o));
    const font = (w) => F[w || 'regular'];

    // frame: navy outer, orange inner hairline
    rect(X0, Y0, W, H, { stroke: C.navy, lw: 0.7, r: 1.5 });
    rect(X0 + 1.6, Y0 + 1.6, W - 3.2, H - 3.2, { stroke: C.orange, lw: 0.25, r: 1 });

    // header: logo + word-mark (left), branch + address (right)
    RW.logoPrims('full', X0 + 6, Y0 + 4.2, 23).prims.forEach((p) => P.push(p));
    const rx = X0 + W - 7;
    const branchName = v.branchName || company.name;
    text(font('bold').ellipsize(branchName, 8.5, 80), rx, Y0 + 11.5, 8.5, 'bold', C.navy, { align: 'right' });
    let ty = Y0 + 15.8;
    const addr = [company.tagline, company.address, [company.phone, company.email].filter(Boolean).join('  •  ')].filter(Boolean);
    for (const a of addr) {
      for (const ln of font('regular').wrap(a, 6.8, 78).slice(0, 2)) { text(ln, rx, ty, 6.8, 'regular', C.gray, { align: 'right' }); ty += 3.3; }
    }

    // title bar
    const ty0 = Y0 + 29;
    rect(X0 + 6, ty0, W - 12, 9.5, { fill: C.navy, r: 0.8 });
    rect(X0 + 6, ty0, 4.5, 9.5, { fill: C.orange, r: 0.8 });
    rect(X0 + W - 6 - 4.5, ty0, 4.5, 9.5, { fill: C.orange, r: 0.8 });
    text(isRcvd ? 'CASH RECEIVED' : isPay ? 'CASH PAYMENT VOUCHER' : 'CASH RECEIPT VOUCHER', X0 + W / 2, ty0 + 6.5, 13.5, 'bold', '#FFFFFF', { align: 'center', cs: 1.1 });

    // voucher no + date
    const my = Y0 + 43;
    rect(X0 + 6, my, 70, 11, { stroke: C.line, lw: 0.3, r: 1.2 });
    text(isRcvd ? 'ENTRY' : 'VOUCHER NO.', X0 + 9, my + 4, 6.3, 'semibold', C.gray, { cs: 0.5 });
    text(isRcvd ? 'No voucher number' : v.number || '— — —', X0 + 9, my + 9, isRcvd ? 9 : 11.5, 'bold', C.navy, { cs: isRcvd ? 0 : 0.4 });
    rect(X0 + W - 6 - 56, my, 56, 11, { stroke: C.line, lw: 0.3, r: 1.2 });
    text('DATE', X0 + W - 6 - 53, my + 4, 6.3, 'semibold', C.gray, { cs: 0.5 });
    text(RW.fmtDate(v.date), X0 + W - 6 - 53, my + 9, 11, 'bold', C.navy);

    // party
    const lx = X0 + 6, rxx = X0 + W - 6;
    let y = Y0 + 63.5;
    text(isPay ? 'Paid To' : 'Received From', lx, y, 9.2, 'semibold', C.navy);
    text(':', lx + 31, y, 9.2, 'semibold', C.navy);
    const pw = rxx - (lx + 35);
    const party = font('semibold').ellipsize(v.partyName || '', font('semibold').fit(v.partyName || '', 11, pw, 8), pw);
    text(party, lx + 35, y, font('semibold').fit(v.partyName || '', 11, pw, 8), 'semibold', C.ink);
    line(lx + 34, y + 1.6, rxx, y + 1.6, { stroke: C.gray, lw: 0.2, dash: [0.5, 0.8] });

    // particulars (up to 5 ruled lines; shrinks first, then continues on a second page)
    y = Y0 + 72;
    const pl = isPay ? 'Particulars / Payment For' : 'Particulars';
    text(pl, lx, y, 9.2, 'semibold', C.navy);
    text(':', lx + font('semibold').width(pl, 9.2) + 1.5, y, 9.2, 'semibold', C.navy);
    const cap = 5, regionW = rxx - lx - 1;
    const body = String(v.particulars || '');
    let size = 10.5, lines = font('regular').wrap(body, size, regionW);
    while (lines.length > cap && size > 7.5) { size -= 0.5; lines = font('regular').wrap(body, size, regionW); }
    let overflow = '';
    if (lines.length > cap) {
      overflow = body;
      lines = lines.slice(0, cap);
      lines[cap - 1] = font('regular').ellipsize(lines[cap - 1] + ' …', size, regionW - 1);
    }
    for (let i = 0; i < cap; i++) {
      const ly = Y0 + 79 + i * 6.2;
      if (lines[i]) text(lines[i], lx, ly - 1.3, size, 'regular', C.ink);
      line(lx, ly, rxx, ly, { stroke: C.gray, lw: 0.2, dash: [0.5, 0.8] });
    }

    // amount + words
    const ay = Y0 + 112;
    text('Amount (₹)', lx, ay + 2.5, 9.2, 'semibold', C.navy);
    rect(lx, ay + 4.2, 52, 12.5, { stroke: C.orange, lw: 0.6, r: 1.4, fill: '#FFF7F1' });
    const amtStr = RW.fmtINR2(v.amountPaise || 0, { symbol: false });
    text('₹', lx + 3.2, ay + 12.7, 11, 'bold', C.orange);
    text(amtStr, lx + 49, ay + 12.8, font('bold').fit(amtStr, 15, 41, 9), 'bold', C.navy, { align: 'right' });
    const wx = lx + 58, ww = rxx - wx;
    text('Amount in Words', wx, ay + 2.5, 9.2, 'semibold', C.navy);
    let words = v.amountInWords || '';
    let ws = 9.5, wl = font('semibold').wrap(words, ws, ww);
    while (wl.length > 2 && ws > 7) { ws -= 0.5; wl = font('semibold').wrap(words, ws, ww); }
    wl.slice(0, 2).forEach((l, i) => text(l, wx, ay + 9.2 + i * 6, ws, 'semibold', C.ink));
    for (let i = 0; i < 2; i++) line(wx, ay + 10.6 + i * 6, rxx, ay + 10.6 + i * 6, { stroke: C.gray, lw: 0.2, dash: [0.5, 0.8] });

    // note
    text('Note:', lx, Y0 + 136, 7.8, 'bold', C.navy);
    text(isRcvd ? 'Cash received by the user named in Prepared By, from the person named above.' : isPay ? 'Received the above amount in cash.' : 'Received the above amount in cash from the party named above.', lx + 9, Y0 + 136, 7.8, 'regular', C.gray);

    // signatures + stamp
    const sigY = Y0 + 160, colW = 30, gap = 4;
    const labels = ['Prepared By', 'Checked By', 'Approved By', isPay ? "Receiver's Signature" : isRcvd ? "Giver's Signature" : "Payer's Signature"];
    labels.forEach((lb, i) => {
      const sx = lx + i * (colW + gap);
      line(sx, sigY, sx + colW, sigY, { stroke: C.navy, lw: 0.3 });
      text(lb, sx + colW / 2, sigY + 3.6, 6.8, 'semibold', C.navy, { align: 'center' });
      if (i === 0 && v.userName) text(font('regular').ellipsize(v.userName, 6.5, colW), sx + colW / 2, sigY - 1.4, 6.5, 'regular', C.gray, { align: 'center' });
    });
    const stW = 38, stX = rxx - stW;
    rect(stX, Y0 + 140, stW, 26, { stroke: C.gray, lw: 0.3, dash: [1.2, 1], r: 2 });
    text('Company Stamp', stX + stW / 2, Y0 + 163.4, 6.5, 'medium', C.gray, { align: 'center' });

    // footer line (ties the printout to the system record)
    const foot = [v.branchName, v.userName ? 'Prepared by ' + v.userName : '', v.createdAt ? RW.fmtDateTime(v.createdAt) : '', 'Computer generated voucher'].filter(Boolean).join('  •  ');
    text(font('regular').ellipsize(foot, 6, W - 14), X0 + W / 2, Y0 + H - 4.2, 6, 'regular', C.gray, { align: 'center' });

    if (v.review === 'INVALID' && v.status !== 'VOID') {
      // audit review: the voucher is kept for the record but its amount is not counted as expense
      P.push({ t: 'text', s: 'NOT VALID', x: X0 + W / 2, y: Y0 + 104, size: 56, weight: 'bold', color: C.red, align: 'center', rotate: 24, opacity: 0.14, cs: 3 });
    }
    if (v.status === 'VOID') {
      P.push({ t: 'text', s: 'VOID', x: X0 + W / 2, y: Y0 + 108, size: 82, weight: 'bold', color: C.red, align: 'center', rotate: 24, opacity: 0.16, cs: 6 });
      rect(X0 + W / 2 - 22, Y0 + 66, 44, 9, { stroke: C.red, lw: 0.6, r: 1, opacity: 0.5 });
    }
    return { prims: P, x: X0, y: Y0, width: W, height: H, overflow };
  };

  /* ----------------------------------------------------------------- SVG renderer */
  const logoUrls = {};   // data: URLs of the logo pictures, built once
  RW.sceneToSvg = function (scene, o) {
    o = o || {};
    const pad = 2;
    const esc = RW.esc;
    const PT = 25.4 / 72;
    const out = [];
    const style = (p) => {
      const a = [];
      a.push('fill="' + (p.fill || 'none') + '"');
      if (p.stroke) { a.push('stroke="' + p.stroke + '" stroke-width="' + (p.lw === undefined ? 0.2 : p.lw) + '"'); if (p.dash) a.push('stroke-dasharray="' + p.dash.join(' ') + '"'); if (p.cap === 'round') a.push('stroke-linecap="round"'); }
      if (p.opacity !== undefined && p.opacity < 1) a.push('opacity="' + p.opacity + '"');
      return a.join(' ');
    };
    for (const p of scene.prims) {
      if (p.t === 'rect') out.push('<rect x="' + p.x + '" y="' + p.y + '" width="' + p.w + '" height="' + p.h + '"' + (p.r ? ' rx="' + p.r + '"' : '') + ' ' + style(p) + '/>');
      else if (p.t === 'line') out.push('<line x1="' + p.x1 + '" y1="' + p.y1 + '" x2="' + p.x2 + '" y2="' + p.y2 + '" ' + style(Object.assign({}, p, { fill: null })) + '/>');
      else if (p.t === 'circle') out.push('<circle cx="' + p.cx + '" cy="' + p.cy + '" r="' + p.r + '" ' + style(p) + '/>');
      else if (p.t === 'path') out.push('<path d="' + p.d + '" ' + style(p) + '/>');
      else if (p.t === 'image') {
        const bytes = RW.logoJpg[p.name];
        if (bytes) out.push('<image x="' + p.x + '" y="' + p.y + '" width="' + p.w + '" height="' + p.h + '" preserveAspectRatio="xMidYMid meet" href="' + (logoUrls[p.name] || (logoUrls[p.name] = RW.bytesToDataUrl(bytes, 'image/jpeg'))) + '"/>');
      }
      else if (p.t === 'text') {
        const anchor = p.align === 'center' ? 'middle' : p.align === 'right' ? 'end' : 'start';
        const tr = p.rotate ? ' transform="rotate(' + -p.rotate + ' ' + p.x + ' ' + p.y + ')"' : '';
        out.push('<text x="' + p.x + '" y="' + p.y + '" font-size="' + (p.size * PT).toFixed(3) + '" font-weight="' + WEIGHTS[p.weight || 'regular'] + '" fill="' + p.color + '" text-anchor="' + anchor + '"'
          + (p.cs ? ' letter-spacing="' + (p.cs * PT).toFixed(3) + '"' : '') + (p.opacity !== undefined && p.opacity < 1 ? ' opacity="' + p.opacity + '"' : '') + tr + ' xml:space="preserve">' + esc(p.s) + '</text>');
      }
    }
    const vb = [scene.x - pad, scene.y - pad, scene.width + pad * 2, scene.height + pad * 2];
    return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="' + vb.join(' ') + '" font-family="Inter, system-ui, sans-serif" role="img" aria-label="' + esc(o.label || 'Voucher') + '"><rect x="' + vb[0] + '" y="' + vb[1] + '" width="' + vb[2] + '" height="' + vb[3] + '" fill="#FFFFFF"/>' + out.join('') + '</svg>';
  };

  /* ----------------------------------------------------------------- PDF renderer */
  // the logo is stored once per PDF file, however many pages use it
  RW.pdfLogo = function (pdf, name) {
    pdf._logos = pdf._logos || {};
    return pdf._logos[name] || (pdf._logos[name] = pdf.addJpeg(RW.logoJpg[name]));
  };
  RW.sceneToPdf = function (page, scene, dx, dy) {
    dx = dx || 0; dy = dy || 0;
    for (const p of scene.prims) {
      if (p.t === 'rect') page.rect(p.x + dx, p.y + dy, p.w, p.h, p);
      else if (p.t === 'line') page.line(p.x1 + dx, p.y1 + dy, p.x2 + dx, p.y2 + dy, p);
      else if (p.t === 'circle') page.circle(p.cx + dx, p.cy + dy, p.r, p);
      else if (p.t === 'path') page.path(p.d, p, dx, dy);
      else if (p.t === 'image') { if (RW.logoJpg[p.name]) page.image(RW.pdfLogo(page.doc, p.name), p.x + dx, p.y + dy, p.w, p.h); }
      else if (p.t === 'text') page.text(p.s, p.x + dx, p.y + dy, Object.assign({}, p, { font: p.weight || 'regular' }));
    }
  };
})(typeof window !== 'undefined' ? window : globalThis);
