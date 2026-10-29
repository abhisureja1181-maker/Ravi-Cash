/* Ravi Cash — CSV and real .xlsx export (hand-written ZIP + SpreadsheetML, no libraries). */
(function (g) {
  'use strict';
  const RW = (g.RW = g.RW || {});
  const enc = new TextEncoder();

  /* ------------------------------------------------------------------ CSV */
  RW.buildCsv = function (columns, rows) {
    const head = columns.map((c) => RW.csvCell(c.label)).join(',');
    const body = rows.map((r) => columns.map((c) => RW.csvCell(r[c.key])).join(','));
    return '﻿' + [head].concat(body).join('\r\n') + '\r\n'; // BOM so Excel reads ₹ and accents correctly
  };

  /* ------------------------------------------------------------------ ZIP */
  const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
  RW.crc32 = (u8) => { let c = 0xffffffff; for (let i = 0; i < u8.length; i++) c = CRC[(c ^ u8[i]) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };

  async function rawDeflate(u8) {
    if (typeof CompressionStream === 'undefined') return null;
    try {
      const cs = new CompressionStream('deflate-raw');
      const w = cs.writable.getWriter(); w.write(u8); w.close();
      return new Uint8Array(await new Response(cs.readable).arrayBuffer());
    } catch (e) { return null; }
  }

  // files: [{ name, data: Uint8Array|string }]
  RW.zip = async function (files) {
    const parts = [], central = [];
    let off = 0;
    const u16 = (n) => [n & 255, (n >> 8) & 255];
    const u32 = (n) => [n & 255, (n >> 8) & 255, (n >> 16) & 255, (n >>> 24) & 255];
    for (const f of files) {
      const name = enc.encode(f.name);
      const data = typeof f.data === 'string' ? enc.encode(f.data) : f.data;
      const crc = RW.crc32(data);
      let comp = await rawDeflate(data), method = 8;
      if (!comp || comp.length >= data.length) { comp = data; method = 0; }
      const hdr = new Uint8Array([0x50, 0x4b, 3, 4, ...u16(20), ...u16(0x0800), ...u16(method), ...u16(0), ...u16(0x21), ...u32(crc), ...u32(comp.length), ...u32(data.length), ...u16(name.length), ...u16(0)]);
      parts.push(hdr, name, comp);
      central.push({ name, crc, csize: comp.length, size: data.length, method, off });
      off += hdr.length + name.length + comp.length;
    }
    const cdStart = off;
    for (const c of central) {
      const h = new Uint8Array([0x50, 0x4b, 1, 2, ...u16(20), ...u16(20), ...u16(0x0800), ...u16(c.method), ...u16(0), ...u16(0x21), ...u32(c.crc), ...u32(c.csize), ...u32(c.size), ...u16(c.name.length), ...u16(0), ...u16(0), ...u16(0), ...u16(0), ...u32(0), ...u32(c.off)]);
      parts.push(h, c.name); off += h.length + c.name.length;
    }
    const end = new Uint8Array([0x50, 0x4b, 5, 6, ...u16(0), ...u16(0), ...u16(central.length), ...u16(central.length), ...u32(off - cdStart), ...u32(cdStart), ...u16(0)]);
    parts.push(end);
    const total = parts.reduce((a, p) => a + p.length, 0);
    const out = new Uint8Array(total);
    let p = 0;
    for (const x of parts) { out.set(x, p); p += x.length; }
    return out;
  };

  /* ----------------------------------------------------------------- XLSX */
  const xe = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '');
  const colName = (i) => { let s = ''; i++; while (i > 0) { const m = (i - 1) % 26; s = String.fromCharCode(65 + m) + s; i = Math.floor((i - m) / 26); } return s; };

  /* sheet = { name, title?, subtitle?, columns:[{key,label,width,type:'text'|'money'|'date'|'int'}], rows:[{...}], totals?:{key:value} }
   * money values are RUPEES (numbers) so Excel can sum them. */
  RW.buildXlsx = async function (sheets) {
    const files = [];
    const styles = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'
      + '<numFmts count="2"><numFmt numFmtId="164" formatCode="#,##0.00"/><numFmt numFmtId="165" formatCode="dd\\-mmm\\-yyyy"/></numFmts>'
      + '<fonts count="5"><font><sz val="10"/><name val="Calibri"/></font><font><b/><sz val="10"/><color rgb="FFFFFFFF"/><name val="Calibri"/></font><font><b/><sz val="14"/><color rgb="FF0B2A4A"/><name val="Calibri"/></font><font><sz val="9"/><color rgb="FF667587"/><name val="Calibri"/></font><font><b/><sz val="10"/><name val="Calibri"/></font></fonts>'
      + '<fills count="4"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF0B2A4A"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FFEAF0F7"/></patternFill></fill></fills>'
      + '<borders count="2"><border><left/><right/><top/><bottom/><diagonal/></border><border><left/><right/><top/><bottom style="thin"><color rgb="FFD5DDE7"/></bottom><diagonal/></border></borders>'
      + '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>'
      + '<cellXfs count="11">'
      + '<xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1"/>' // 0 text
      + '<xf numFmtId="164" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyBorder="1"/>' // 1 money
      + '<xf numFmtId="165" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyBorder="1"><alignment horizontal="left"/></xf>' // 2 date
      + '<xf numFmtId="1" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyBorder="1"/>' // 3 int
      + '<xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1"><alignment vertical="center" wrapText="1"/></xf>' // 4 header
      + '<xf numFmtId="0" fontId="2" fillId="0" borderId="0" xfId="0" applyFont="1"/>' // 5 title
      + '<xf numFmtId="0" fontId="3" fillId="0" borderId="0" xfId="0" applyFont="1"/>' // 6 subtitle
      + '<xf numFmtId="0" fontId="4" fillId="3" borderId="0" xfId="0" applyFont="1" applyFill="1"/>' // 7 total text
      + '<xf numFmtId="164" fontId="4" fillId="3" borderId="0" xfId="0" applyNumberFormat="1" applyFont="1" applyFill="1"/>' // 8 total money
      + '<xf numFmtId="3" fontId="4" fillId="3" borderId="0" xfId="0" applyNumberFormat="1" applyFont="1" applyFill="1"/>' // 9 total int
      + '<xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1"><alignment wrapText="1" vertical="top"/></xf>' // 10 wrapped text
      + '</cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>';

    const serial = (s) => Math.round((Date.UTC(+s.slice(0, 4), +s.slice(5, 7) - 1, +s.slice(8, 10)) - Date.UTC(1899, 11, 30)) / 864e5);

    sheets.forEach((sh, si) => {
      const rowsXml = [];
      let r = 1;
      const merges = [];
      const nc = sh.columns.length;
      if (sh.title) { rowsXml.push('<row r="' + r + '" ht="22" customHeight="1"><c r="A' + r + '" s="5" t="inlineStr"><is><t>' + xe(sh.title) + '</t></is></c></row>'); r++; }
      for (const line of sh.subtitle || []) { rowsXml.push('<row r="' + r + '"><c r="A' + r + '" s="6" t="inlineStr"><is><t xml:space="preserve">' + xe(line) + '</t></is></c></row>'); r++; }
      if (sh.title || (sh.subtitle && sh.subtitle.length)) r++;
      const headRow = r;
      rowsXml.push('<row r="' + r + '" ht="26" customHeight="1">' + sh.columns.map((c, i) => '<c r="' + colName(i) + r + '" s="4" t="inlineStr"><is><t>' + xe(c.label) + '</t></is></c>').join('') + '</row>');
      r++;
      const first = r;
      for (const row of sh.rows) {
        const cells = sh.columns.map((c, i) => {
          const v = row[c.key], ref = colName(i) + r;
          if (v === null || v === undefined || v === '') return '<c r="' + ref + '" s="' + (c.type === 'money' ? 1 : c.type === 'date' ? 2 : c.type === 'int' ? 3 : 0) + '"/>';
          if (c.type === 'money') return '<c r="' + ref + '" s="1"><v>' + Number(v) + '</v></c>';
          if (c.type === 'int') return '<c r="' + ref + '" s="3"><v>' + Number(v) + '</v></c>';
          if (c.type === 'date' && /^\d{4}-\d{2}-\d{2}$/.test(v)) return '<c r="' + ref + '" s="2"><v>' + serial(v) + '</v></c>';
          return '<c r="' + ref + '" s="' + (c.wrap ? 10 : 0) + '" t="inlineStr"><is><t xml:space="preserve">' + xe(v) + '</t></is></c>';
        }).join('');
        rowsXml.push('<row r="' + r + '">' + cells + '</row>');
        r++;
      }
      const last = r - 1;
      if (sh.totals) {
        const cells = sh.columns.map((c, i) => {
          const ref = colName(i) + r;
          if (i === 0) return '<c r="' + ref + '" s="7" t="inlineStr"><is><t>' + xe(sh.totals.label || 'TOTAL') + '</t></is></c>';
          if (c.type === 'money' || c.type === 'int') {
            if (sh.totals.sum && sh.totals.sum.includes(c.key) && sh.rows.length) return '<c r="' + ref + '" s="' + (c.type === 'money' ? 8 : 9) + '"><f>SUM(' + colName(i) + first + ':' + colName(i) + last + ')</f></c>';
            if (sh.totals.values && sh.totals.values[c.key] !== undefined) return '<c r="' + ref + '" s="' + (c.type === 'money' ? 8 : 9) + '"><v>' + sh.totals.values[c.key] + '</v></c>';
          }
          return '<c r="' + ref + '" s="7"/>';
        }).join('');
        rowsXml.push('<row r="' + r + '">' + cells + '</row>');
        r++;
      }
      void merges;
      const cols = '<cols>' + sh.columns.map((c, i) => '<col min="' + (i + 1) + '" max="' + (i + 1) + '" width="' + (c.width || 16) + '" customWidth="1"/>').join('') + '</cols>';
      const xml = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'
        + '<sheetViews><sheetView workbookViewId="0" showGridLines="0"' + (si === 0 ? ' tabSelected="1"' : '') + '><pane ySplit="' + headRow + '" topLeftCell="A' + (headRow + 1) + '" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>'
        + '<sheetFormatPr defaultRowHeight="15"/>' + cols + '<sheetData>' + rowsXml.join('') + '</sheetData>'
        + (sh.rows.length ? '<autoFilter ref="A' + headRow + ':' + colName(nc - 1) + last + '"/>' : '')
        + '<pageMargins left="0.4" right="0.4" top="0.5" bottom="0.5" header="0.3" footer="0.3"/><pageSetup paperSize="9" orientation="landscape" fitToWidth="1" fitToHeight="0"/></worksheet>';
      sh._xml = xml; sh._head = headRow; sh._last = last;
    });
    const used = (n) => n.replace(/[\\/?*\[\]:]/g, ' ').slice(0, 31);
    files.push({ name: '[Content_Types].xml', data: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' + sheets.map((s, i) => '<Override PartName="/xl/worksheets/sheet' + (i + 1) + '.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>').join('') + '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>' });
    files.push({ name: '_rels/.rels', data: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>' });
    files.push({ name: 'xl/workbook.xml', data: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>' + sheets.map((s, i) => '<sheet name="' + xe(used(s.name)) + '" sheetId="' + (i + 1) + '" r:id="rId' + (i + 1) + '"/>').join('') + '</sheets><definedNames>' + sheets.map((s, i) => s.rows.length ? '<definedName name="_xlnm._FilterDatabase" localSheetId="' + i + '" hidden="1">\'' + xe(used(s.name)) + '\'!$A$' + s._head + ':$' + colName(s.columns.length - 1) + '$' + s._last + '</definedName>' : '').join('') + '</definedNames></workbook>' });
    files.push({ name: 'xl/_rels/workbook.xml.rels', data: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' + sheets.map((s, i) => '<Relationship Id="rId' + (i + 1) + '" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet' + (i + 1) + '.xml"/>').join('') + '<Relationship Id="rId' + (sheets.length + 1) + '" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>' });
    files.push({ name: 'xl/styles.xml', data: styles });
    sheets.forEach((s, i) => files.push({ name: 'xl/worksheets/sheet' + (i + 1) + '.xml', data: s._xml }));
    return RW.zip(files);
  };

  /* Columns shared by voucher exports (CSV / Excel / PDF). */
  RW.VOUCHER_COLUMNS = [
    { key: 'number', label: 'Voucher No.', width: 14 }, { key: 'type', label: 'Type', width: 14 }, { key: 'date', label: 'Date', width: 13, type: 'date' },
    { key: 'branch', label: 'Branch', width: 30 }, { key: 'user', label: 'User', width: 20 }, { key: 'party', label: 'Party', width: 28 },
    { key: 'particulars', label: 'Particulars', width: 48, wrap: true }, { key: 'cashIn', label: 'Cash In (₹)', width: 14, type: 'money' }, { key: 'cashOut', label: 'Cash Out (₹)', width: 14, type: 'money' }, { key: 'amount', label: 'Voucher Amount (₹)', width: 18, type: 'money' },
    { key: 'amountInWords', label: 'Amount in Words', width: 44 }, { key: 'status', label: 'Status', width: 10 }, { key: 'review', label: 'Audit Review', width: 14 }, { key: 'reviewReason', label: 'Review Reason', width: 30 }, { key: 'createdAt', label: 'Created At', width: 22 }, { key: 'createdBy', label: 'Created By', width: 18 }, { key: 'attachments', label: 'Attachments', width: 12, type: 'int' },
  ];
})(typeof window !== 'undefined' ? window : globalThis);
