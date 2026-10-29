/* Ravi Cash — dependency-free PDF writer with embedded TrueType fonts (so the ₹ symbol prints
 * correctly), vector drawing, JPEG images and Flate compression. All coordinates are in millimetres
 * measured from the TOP-LEFT of the page. */
(function (g) {
  'use strict';
  const RW = (g.RW = g.RW || {});
  const MM = 72 / 25.4;
  const enc = new TextEncoder();

  /* ======================================================================== TrueType */
  class TTFont {
    constructor(bytes, name) {
      this.name = name || 'font';
      this.bytes = bytes;
      const dv = (this.dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength));
      const n = dv.getUint16(4);
      this.tables = {};
      for (let i = 0; i < n; i++) {
        const o = 12 + i * 16;
        const tag = String.fromCharCode(dv.getUint8(o), dv.getUint8(o + 1), dv.getUint8(o + 2), dv.getUint8(o + 3));
        this.tables[tag] = { offset: dv.getUint32(o + 8), length: dv.getUint32(o + 12) };
      }
      const head = this.tables.head.offset;
      this.upem = dv.getUint16(head + 18);
      this.bbox = [dv.getInt16(head + 36), dv.getInt16(head + 38), dv.getInt16(head + 40), dv.getInt16(head + 42)];
      const hhea = this.tables.hhea.offset;
      this.ascent = dv.getInt16(hhea + 4);
      this.descent = dv.getInt16(hhea + 6);
      this.numHM = dv.getUint16(hhea + 34);
      this.hmtx = this.tables.hmtx.offset;
      this.capHeight = Math.round(this.upem * 0.73);
      if (this.tables['OS/2'] && dv.getUint16(this.tables['OS/2'].offset) >= 2) this.capHeight = dv.getInt16(this.tables['OS/2'].offset + 88) || this.capHeight;
      this.cmap = this.parseCmap();
      this.q = this.cmap.get(63) || 0; // '?'
    }
    parseCmap() {
      const dv = this.dv, base = this.tables.cmap.offset;
      const num = dv.getUint16(base + 2);
      let best = null;
      for (let i = 0; i < num; i++) {
        const pid = dv.getUint16(base + 4 + i * 8), eid = dv.getUint16(base + 6 + i * 8), off = dv.getUint32(base + 8 + i * 8);
        const score = pid === 3 && eid === 10 ? 4 : pid === 3 && eid === 1 ? 3 : pid === 0 ? 2 : 0;
        if (score && (!best || score > best.score)) best = { score, off: base + off };
      }
      if (!best) throw new Error('Font has no usable cmap');
      const map = new Map();
      const o = best.off, fmt = dv.getUint16(o);
      if (fmt === 4) {
        const segX2 = dv.getUint16(o + 6), seg = segX2 / 2;
        const endO = o + 14, startO = endO + segX2 + 2, deltaO = startO + segX2, rangeO = deltaO + segX2;
        for (let s = 0; s < seg; s++) {
          const end = dv.getUint16(endO + s * 2), start = dv.getUint16(startO + s * 2), delta = dv.getInt16(deltaO + s * 2), ro = dv.getUint16(rangeO + s * 2);
          for (let c = start; c <= end && c !== 0xffff; c++) {
            let gid;
            if (ro === 0) gid = (c + delta) & 0xffff;
            else {
              const a = rangeO + s * 2 + ro + (c - start) * 2;
              gid = dv.getUint16(a);
              if (gid !== 0) gid = (gid + delta) & 0xffff;
            }
            if (gid) map.set(c, gid);
          }
        }
      } else if (fmt === 12) {
        const ng = dv.getUint32(o + 12);
        for (let i = 0; i < ng; i++) {
          const a = o + 16 + i * 12, s = dv.getUint32(a), e = dv.getUint32(a + 4), sg = dv.getUint32(a + 8);
          for (let c = s; c <= e; c++) map.set(c, sg + (c - s));
        }
      } else throw new Error('Unsupported cmap format ' + fmt);
      return map;
    }
    adv(gid) { return this.dv.getUint16(this.hmtx + Math.min(gid, this.numHM - 1) * 4); }
    // Normalise text to what the font can print. Unsupported characters become '?'.
    clean(str) {
      let out = '';
      for (const ch of String(str === null || str === undefined ? '' : str)) {
        const cp = ch.codePointAt(0);
        if (cp === 0xa0 || cp === 9) out += ' ';
        else if (cp < 32 || cp === 0x200b || cp === 0xfeff) continue;
        else out += this.cmap.has(cp) ? ch : '?';
      }
      return out;
    }
    gids(str) { return Array.from(str, (ch) => this.cmap.get(ch.codePointAt(0)) || this.q); }
    // Width in millimetres of `str` set at `sizePt`, with optional letter spacing in points.
    width(str, sizePt, cs) {
      let w = 0, n = 0;
      for (const ch of this.clean(str)) { w += this.adv(this.cmap.get(ch.codePointAt(0)) || this.q); n++; }
      return ((w / this.upem) * sizePt + (cs || 0) * n) / MM;
    }
    // Greedy word wrap (breaks very long words by character).
    wrap(str, sizePt, maxMm, cs) {
      const lines = [];
      for (const para of this.clean(str).replace(/\r/g, '').split('\n')) {
        const words = para.split(/ +/).filter(Boolean);
        if (!words.length) { lines.push(''); continue; }
        let cur = '';
        for (let w of words) {
          while (this.width(w, sizePt, cs) > maxMm && w.length > 1) {
            let k = w.length;
            while (k > 1 && this.width(w.slice(0, k), sizePt, cs) > maxMm) k--;
            if (cur) { lines.push(cur); cur = ''; }
            lines.push(w.slice(0, k));
            w = w.slice(k);
          }
          if (!w) continue;
          const t = cur ? cur + ' ' + w : w;
          if (cur && this.width(t, sizePt, cs) > maxMm) { lines.push(cur); cur = w; } else cur = t;
        }
        if (cur) lines.push(cur);
      }
      return lines;
    }
    fit(str, sizePt, maxMm, minPt, cs) {
      let s = sizePt;
      while (s > minPt && this.width(str, s, cs) > maxMm) s -= 0.25;
      return s;
    }
    ellipsize(str, sizePt, maxMm, cs) {
      str = this.clean(str);
      if (this.width(str, sizePt, cs) <= maxMm) return str;
      let k = str.length;
      while (k > 1 && this.width(str.slice(0, k) + '…', sizePt, cs) > maxMm) k--;
      return str.slice(0, k).trimEnd() + (this.cmap.has(0x2026) ? '…' : '...');
    }
  }
  RW.TTFont = TTFont;

  /* ===================================================================== helpers */
  const hexColor = (c) => {
    if (!c) return null;
    let h = String(c).replace('#', '');
    if (h.length === 3) h = h.split('').map((x) => x + x).join('');
    return [parseInt(h.slice(0, 2), 16) / 255, parseInt(h.slice(2, 4), 16) / 255, parseInt(h.slice(4, 6), 16) / 255];
  };
  const f = (n) => (Math.round(n * 1000) / 1000).toString();
  const pdfStr = (s) => '(' + String(s).replace(/[^\x20-\x7e]/g, '?').replace(/([\\()])/g, '\\$1') + ')';

  async function deflate(u8) {
    if (typeof CompressionStream === 'undefined') return null;
    const cs = new CompressionStream('deflate');
    const w = cs.writable.getWriter();
    w.write(u8); w.close();
    return new Uint8Array(await new Response(cs.readable).arrayBuffer());
  }

  RW.jpegInfo = function (b) {
    if (b[0] !== 0xff || b[1] !== 0xd8) throw new Error('Not a JPEG');
    let i = 2;
    while (i < b.length) {
      if (b[i] !== 0xff) { i++; continue; }
      const m = b[i + 1];
      if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) {
        return { height: (b[i + 5] << 8) | b[i + 6], width: (b[i + 7] << 8) | b[i + 8], comps: b[i + 9], bits: b[i + 4] };
      }
      if (m === 0xd8 || (m >= 0xd0 && m <= 0xd7) || m === 0x01) { i += 2; continue; }
      i += 2 + ((b[i + 2] << 8) | b[i + 3]);
    }
    throw new Error('JPEG size not found');
  };
  RW.dataUrlBytes = function (dataUrl) {
    const b64 = dataUrl.slice(dataUrl.indexOf(',') + 1);
    const bin = atob(b64);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  };

  /* ========================================================================= page */
  class Page {
    constructor(doc, wMm, hMm) {
      this.doc = doc; this.w = wMm; this.h = hMm; this.ops = []; this.fonts = new Set(); this.imgs = new Set(); this.gss = new Set();
    }
    X(x) { return f(x * MM); }
    Y(y) { return f((this.h - y) * MM); }
    _style(o, def) {
      const ops = [];
      if (o.lw !== undefined || def) ops.push(f((o.lw === undefined ? 0.2 : o.lw) * MM) + ' w');
      if (o.dash) ops.push('[' + o.dash.map((d) => f(d * MM)).join(' ') + '] 0 d'); else ops.push('[] 0 d');
      ops.push((o.cap === 'round' ? 1 : 0) + ' J');
      const s = hexColor(o.stroke), fl = hexColor(o.fill);
      if (s) ops.push(s.map(f).join(' ') + ' RG');
      if (fl) ops.push(fl.map(f).join(' ') + ' rg');
      return { ops, s: !!s, f: !!fl };
    }
    _paint(o) { const st = this._style(o, true); this.ops.push('q', ...st.ops); return st; }
    _end(st, evenOdd) { this.ops.push(st.f && st.s ? (evenOdd ? 'B*' : 'B') : st.f ? (evenOdd ? 'f*' : 'f') : st.s ? 'S' : 'n', 'Q'); }
    alpha(a, fn) {
      const k = this.doc._gs(a);
      this.gss.add(k);
      this.ops.push('q /' + k + ' gs');
      fn();
      this.ops.push('Q');
    }
    rect(x, y, w, h, o) {
      o = o || {};
      if (o.opacity !== undefined && o.opacity < 1) return this.alpha(o.opacity, () => this.rect(x, y, w, h, Object.assign({}, o, { opacity: 1 })));
      const st = this._paint(o);
      const r = Math.min(o.r || 0, w / 2, h / 2);
      if (r > 0) this._rr(x, y, w, h, r);
      else this.ops.push(this.X(x) + ' ' + this.Y(y + h) + ' ' + f(w * MM) + ' ' + f(h * MM) + ' re');
      this._end(st);
    }
    _rr(x, y, w, h, r) {
      const k = 0.5523 * r, P = (px, py) => this.X(px) + ' ' + this.Y(py);
      this.ops.push(P(x + r, y) + ' m', P(x + w - r, y) + ' l', P(x + w - r + k, y) + ' ' + P(x + w, y + r - k) + ' ' + P(x + w, y + r) + ' c',
        P(x + w, y + h - r) + ' l', P(x + w, y + h - r + k) + ' ' + P(x + w - r + k, y + h) + ' ' + P(x + w - r, y + h) + ' c',
        P(x + r, y + h) + ' l', P(x + r - k, y + h) + ' ' + P(x, y + h - r + k) + ' ' + P(x, y + h - r) + ' c',
        P(x, y + r) + ' l', P(x, y + r - k) + ' ' + P(x + r - k, y) + ' ' + P(x + r, y) + ' c', 'h');
    }
    line(x1, y1, x2, y2, o) {
      o = o || {};
      const st = this._paint(Object.assign({ stroke: '#000' }, o, { fill: null }));
      this.ops.push(this.X(x1) + ' ' + this.Y(y1) + ' m ' + this.X(x2) + ' ' + this.Y(y2) + ' l');
      this._end(st);
    }
    circle(cx, cy, r, o) {
      o = o || {};
      const st = this._paint(o), k = 0.5523 * r, P = (px, py) => this.X(px) + ' ' + this.Y(py);
      this.ops.push(P(cx + r, cy) + ' m', P(cx + r, cy + k) + ' ' + P(cx + k, cy + r) + ' ' + P(cx, cy + r) + ' c', P(cx - k, cy + r) + ' ' + P(cx - r, cy + k) + ' ' + P(cx - r, cy) + ' c',
        P(cx - r, cy - k) + ' ' + P(cx - k, cy - r) + ' ' + P(cx, cy - r) + ' c', P(cx + k, cy - r) + ' ' + P(cx + r, cy - k) + ' ' + P(cx + r, cy) + ' c', 'h');
      this._end(st);
    }
    // SVG-style path in mm: M L C Z (absolute), optionally translated by (dx,dy).
    path(d, o, dx, dy) {
      o = o || {};
      if (o.opacity !== undefined && o.opacity < 1) return this.alpha(o.opacity, () => this.path(d, Object.assign({}, o, { opacity: 1 }), dx, dy));
      const st = this._paint(o);
      const t = d.match(/[MLCZ]|-?\d*\.?\d+(?:e-?\d+)?/gi);
      let i = 0;
      const num = () => parseFloat(t[i++]);
      const pt = () => { const x = num() + (dx || 0), y = num() + (dy || 0); return this.X(x) + ' ' + this.Y(y); };
      while (i < t.length) {
        const c = t[i++].toUpperCase();
        if (c === 'M') this.ops.push(pt() + ' m');
        else if (c === 'L') this.ops.push(pt() + ' l');
        else if (c === 'C') this.ops.push(pt() + ' ' + pt() + ' ' + pt() + ' c');
        else if (c === 'Z') this.ops.push('h');
      }
      this._end(st);
    }
    // Text: y is the BASELINE. font = 'regular'|'medium'|'semibold'|'bold'.
    text(str, x, y, o) {
      o = o || {};
      const fnt = this.doc.fonts[o.font || 'regular'];
      const size = o.size || 10;
      const cs = o.cs || 0;
      const s = fnt.ttf.clean(str);
      if (!s) return;
      if (o.opacity !== undefined && o.opacity < 1) return this.alpha(o.opacity, () => this.text(str, x, y, Object.assign({}, o, { opacity: 1 })));
      const w = fnt.ttf.width(s, size, cs);
      let tx = x;
      if (o.align === 'center') tx = x - w / 2; else if (o.align === 'right') tx = x - w;
      const gids = fnt.ttf.gids(s);
      const chars = Array.from(s);
      gids.forEach((gid, i) => { if (!fnt.used.has(gid)) fnt.used.set(gid, chars[i].codePointAt(0)); });
      this.fonts.add(fnt.key);
      const col = hexColor(o.color || '#000000');
      const hex = '<' + gids.map((gid) => gid.toString(16).padStart(4, '0')).join('') + '>';
      this.ops.push('q');
      if (o.rotate) {
        const a = (-o.rotate * Math.PI) / 180;
        this.ops.push([f(Math.cos(a)), f(Math.sin(a)), f(-Math.sin(a)), f(Math.cos(a)), this.X(x), this.Y(y)].join(' ') + ' cm');
        const off = o.align === 'center' ? -w / 2 : o.align === 'right' ? -w : 0;
        this.ops.push('BT /' + fnt.key + ' ' + f(size) + ' Tf ' + col.map(f).join(' ') + ' rg ' + (cs ? f(cs) + ' Tc ' : '') + f(off * MM) + ' 0 Td ' + hex + ' Tj ET');
      } else {
        this.ops.push('BT /' + fnt.key + ' ' + f(size) + ' Tf ' + col.map(f).join(' ') + ' rg ' + (cs ? f(cs) + ' Tc ' : '') + this.X(tx) + ' ' + this.Y(y) + ' Td ' + hex + ' Tj ET');
      }
      this.ops.push('Q');
      return w;
    }
    image(img, x, y, w, h) {
      this.imgs.add(img.key);
      this.ops.push('q ' + f(w * MM) + ' 0 0 ' + f(h * MM) + ' ' + this.X(x) + ' ' + this.Y(y + h) + ' cm /' + img.key + ' Do Q');
    }
  }

  /* ===================================================================== document */
  class Pdf {
    constructor(opts) {
      opts = opts || {};
      this.info = opts.info || {};
      this.pages = []; this.fonts = {}; this.images = []; this.gsMap = new Map();
    }
    addFont(name, ttf) { this.fonts[name] = { ttf, used: new Map(), key: 'F' + (Object.keys(this.fonts).length + 1) }; }
    addPage(w, h) { const p = new Page(this, w, h); this.pages.push(p); return p; }
    _gs(a) {
      const k = 'GS' + Math.round(a * 100);
      this.gsMap.set(k, a);
      return k;
    }
    addJpeg(bytes) {
      const inf = RW.jpegInfo(bytes);
      const img = { key: 'Im' + (this.images.length + 1), bytes, w: inf.width, h: inf.height, comps: inf.comps };
      this.images.push(img);
      return img;
    }
    async save() {
      const objs = []; // index = id-1; each is Uint8Array or string
      const alloc = () => { objs.push(null); return objs.length; };
      const put = (id, v) => { objs[id - 1] = v; };
      const stream = async (dict, bytes, compress) => {
        let data = bytes, extra = '';
        if (compress !== false) { const z = await deflate(bytes); if (z && z.length < bytes.length) { data = z; extra = ' /Filter /FlateDecode'; } }
        const head = enc.encode('<< ' + dict + extra + ' /Length ' + data.length + ' >>\nstream\n');
        const tail = enc.encode('\nendstream');
        const out = new Uint8Array(head.length + data.length + tail.length);
        out.set(head, 0); out.set(data, head.length); out.set(tail, head.length + data.length);
        return out;
      };
      const catalog = alloc(), pagesId = alloc(), infoId = alloc();

      // fonts
      const fontIds = {};
      for (const name of Object.keys(this.fonts)) {
        const F = this.fonts[name], t = F.ttf;
        const ff = alloc(), fd = alloc(), cid = alloc(), tu = alloc(), t0 = alloc();
        put(ff, await stream('/Length1 ' + t.bytes.length, t.bytes));
        const psName = 'RAVI+' + (t.name || name).replace(/[^A-Za-z0-9-]/g, '');
        const sc = 1000 / t.upem;
        put(fd, '<< /Type /FontDescriptor /FontName /' + psName + ' /Flags 32 /FontBBox [' + t.bbox.map((v) => Math.round(v * sc)).join(' ') + '] /ItalicAngle 0 /Ascent ' + Math.round(t.ascent * sc) + ' /Descent ' + Math.round(t.descent * sc) + ' /CapHeight ' + Math.round(t.capHeight * sc) + ' /StemV 80 /FontFile2 ' + ff + ' 0 R >>');
        const gids = [...F.used.keys()].sort((a, b) => a - b);
        put(cid, '<< /Type /Font /Subtype /CIDFontType2 /BaseFont /' + psName + ' /CIDSystemInfo << /Registry (Adobe) /Ordering (Identity) /Supplement 0 >> /FontDescriptor ' + fd + ' 0 R /CIDToGIDMap /Identity /DW 600 /W [' + gids.map((gid) => gid + ' [' + Math.round(t.adv(gid) * sc) + ']').join(' ') + '] >>');
        let cm = '/CIDInit /ProcSet findresource begin 12 dict begin begincmap /CIDSystemInfo << /Registry (Adobe) /Ordering (UCS) /Supplement 0 >> def /CMapName /Adobe-Identity-UCS def /CMapType 2 def 1 begincodespacerange <0000> <FFFF> endcodespacerange\n';
        for (let i = 0; i < gids.length; i += 90) {
          const chunk = gids.slice(i, i + 90);
          cm += chunk.length + ' beginbfchar\n' + chunk.map((gid) => '<' + gid.toString(16).padStart(4, '0') + '> <' + F.used.get(gid).toString(16).padStart(4, '0') + '>').join('\n') + '\nendbfchar\n';
        }
        cm += 'endcmap CMapName currentdict /CMap defineresource pop end end';
        put(tu, await stream('', enc.encode(cm)));
        put(t0, '<< /Type /Font /Subtype /Type0 /BaseFont /' + psName + ' /Encoding /Identity-H /DescendantFonts [' + cid + ' 0 R] /ToUnicode ' + tu + ' 0 R >>');
        fontIds[F.key] = t0;
      }
      // images
      const imgIds = {};
      for (const im of this.images) {
        const id = alloc();
        put(id, await stream('/Type /XObject /Subtype /Image /Width ' + im.w + ' /Height ' + im.h + ' /ColorSpace /' + (im.comps === 1 ? 'DeviceGray' : 'DeviceRGB') + ' /BitsPerComponent 8 /Filter /DCTDecode', im.bytes, false));
        imgIds[im.key] = id;
      }
      // graphics states
      const gsIds = {};
      for (const [k, a] of this.gsMap) { const id = alloc(); put(id, '<< /Type /ExtGState /ca ' + a + ' /CA ' + a + ' >>'); gsIds[k] = id; }
      // pages
      const pageIds = [];
      for (const p of this.pages) {
        const cs = alloc(), pg = alloc();
        put(cs, await stream('', enc.encode(p.ops.join('\n'))));
        const res = '/Font << ' + [...p.fonts].map((k) => '/' + k + ' ' + fontIds[k] + ' 0 R').join(' ') + ' >>'
          + (p.imgs.size ? ' /XObject << ' + [...p.imgs].map((k) => '/' + k + ' ' + imgIds[k] + ' 0 R').join(' ') + ' >>' : '')
          + (p.gss.size ? ' /ExtGState << ' + [...p.gss].map((k) => '/' + k + ' ' + gsIds[k] + ' 0 R').join(' ') + ' >>' : '');
        put(pg, '<< /Type /Page /Parent ' + pagesId + ' 0 R /MediaBox [0 0 ' + f(p.w * MM) + ' ' + f(p.h * MM) + '] /Resources << ' + res + ' >> /Contents ' + cs + ' 0 R >>');
        pageIds.push(pg);
      }
      put(pagesId, '<< /Type /Pages /Kids [' + pageIds.map((i) => i + ' 0 R').join(' ') + '] /Count ' + pageIds.length + ' >>');
      put(catalog, '<< /Type /Catalog /Pages ' + pagesId + ' 0 R /PageLayout /SinglePage >>');
      const d = new Date();
      const pad = (n) => String(n).padStart(2, '0');
      const date = "D:" + d.getUTCFullYear() + pad(d.getUTCMonth() + 1) + pad(d.getUTCDate()) + pad(d.getUTCHours()) + pad(d.getUTCMinutes()) + pad(d.getUTCSeconds()) + "Z";
      put(infoId, '<< /Title ' + pdfStr(this.info.title || 'Document') + ' /Author ' + pdfStr(this.info.author || 'Ravi Water Flow Pump') + ' /Subject ' + pdfStr(this.info.subject || '') + ' /Creator (Ravi Cash Management System) /Producer (Ravi Cash PDF engine) /CreationDate (' + date + ') >>');

      // serialise
      const parts = [];
      let off = 0;
      const push = (u8) => { parts.push(u8); off += u8.length; };
      push(new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34, 0x0a, 0x25, 0xe2, 0xe3, 0xcf, 0xd3, 0x0a])); // %PDF-1.4 + binary marker
      const offsets = [];
      for (let i = 0; i < objs.length; i++) {
        offsets.push(off);
        push(enc.encode(i + 1 + ' 0 obj\n'));
        const o = objs[i];
        push(typeof o === 'string' ? enc.encode(o) : o);
        push(enc.encode('\nendobj\n'));
      }
      const xref = off;
      let x = 'xref\n0 ' + (objs.length + 1) + '\n0000000000 65535 f \n';
      for (const o of offsets) x += String(o).padStart(10, '0') + ' 00000 n \n';
      x += 'trailer\n<< /Size ' + (objs.length + 1) + ' /Root ' + catalog + ' 0 R /Info ' + infoId + ' 0 R >>\nstartxref\n' + xref + '\n%%EOF\n';
      push(enc.encode(x));
      const out = new Uint8Array(off);
      let p = 0;
      for (const part of parts) { out.set(part, p); p += part.length; }
      return out;
    }
  }
  RW.Pdf = Pdf;
})(typeof window !== 'undefined' ? window : globalThis);
