/* Ravi Cash — shared utilities (money, Indian number words, IST dates, hashing).
 * Plain script (no modules) so the same file runs in the browser and in Node tests. */
(function (g) {
  'use strict';
  const RW = (g.RW = g.RW || {});

  /* ------------------------------------------------------------------ errors */
  class ApiError extends Error {
    constructor(code, message, extra) {
      super(message);
      this.name = 'ApiError';
      this.code = code;
      if (extra) Object.assign(this, extra);
    }
  }
  RW.ApiError = ApiError;

  /* ------------------------------------------------------------------- money */
  // All money is stored as integer paise. Rupees never touch floating point.
  RW.toPaise = function (input) {
    if (input === null || input === undefined) throw new ApiError('VALIDATION', 'Amount is required');
    let s = typeof input === 'number' ? String(input) : String(input);
    s = s.replace(/[₹,\s]/g, '').replace(/^Rs\.?/i, '');
    if (/e/i.test(s)) throw new ApiError('VALIDATION', 'Enter the amount as a plain number');
    if (!/^\d+(\.\d{1,2})?$/.test(s)) throw new ApiError('VALIDATION', 'Amount must be a number with at most 2 decimals');
    const [r, p = ''] = s.split('.');
    if (r.length > 12) throw new ApiError('VALIDATION', 'Amount is too large');
    return Number(r) * 100 + Number((p + '00').slice(0, 2));
  };
  RW.fromPaise = (p) => p / 100;

  function groupIndian(intStr) {
    if (intStr.length <= 3) return intStr;
    const last3 = intStr.slice(-3);
    let rest = intStr.slice(0, -3);
    rest = rest.replace(/\B(?=(\d{2})+(?!\d))/g, ',');
    return rest + ',' + last3;
  }
  RW.groupIndian = groupIndian;

  // fmtINR(12550000) -> "₹1,25,500"   fmtINR(12550050) -> "₹1,25,500.50"
  RW.fmtINR = function (paise, opts) {
    opts = opts || {};
    const symbol = opts.symbol === false ? '' : '₹';
    const neg = paise < 0;
    const abs = Math.abs(Math.round(paise));
    const r = Math.floor(abs / 100);
    const p = abs % 100;
    const dec = opts.decimals === 2 || (opts.decimals !== 0 && p !== 0);
    let out = groupIndian(String(r));
    if (dec) out += '.' + String(p).padStart(2, '0');
    return (neg ? '-' : '') + symbol + out;
  };
  RW.fmtINR2 = (paise, o) => RW.fmtINR(paise, Object.assign({ decimals: 2 }, o || {}));

  // compact for chart axes: ₹1.2 L, ₹3.4 Cr, ₹45 K
  RW.compactINR = function (paise) {
    const a = Math.abs(paise);
    const sign = paise < 0 ? '-' : '';
    const t = (x) => String(x).replace(/\.0+$/, '').replace(/(\.\d)0$/, '$1');
    // integer maths on paise so rounding is exact (no float drift)
    if (a >= 1e9) return sign + '₹' + t(Math.round(a / 1e7) / 100) + ' Cr';
    if (a >= 1e7) return sign + '₹' + t(Math.round(a / 1e5) / 100) + ' L';
    if (a >= 1e5) return sign + '₹' + t(Math.round(a / 1e3) / 100) + ' K';
    return sign + '₹' + t(Math.round(a) / 100);
  };

  /* ---------------------------------------------------- amount in words (Indian) */
  const ONES = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];
  const TENS = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];
  function below100(n) {
    return n < 20 ? ONES[n] : TENS[Math.floor(n / 10)] + (n % 10 ? '-' + ONES[n % 10] : '');
  }
  function below1000(n) {
    const h = Math.floor(n / 100);
    const r = n % 100;
    return (h ? ONES[h] + ' Hundred' + (r ? ' ' : '') : '') + (r ? below100(r) : '');
  }
  function wordsInt(n) {
    if (n === 0) return 'Zero';
    const parts = [];
    const crore = Math.floor(n / 1e7); n %= 1e7;
    const lakh = Math.floor(n / 1e5); n %= 1e5;
    const thousand = Math.floor(n / 1e3); n %= 1e3;
    if (crore) parts.push(wordsInt(crore) + ' Crore');
    if (lakh) parts.push(below100(lakh) + ' Lakh');
    if (thousand) parts.push(below100(thousand) + ' Thousand');
    if (n) parts.push(below1000(n));
    return parts.join(' ');
  }
  RW.amountInWords = function (paise) {
    paise = Math.round(paise);
    const r = Math.floor(paise / 100);
    const p = paise % 100;
    if (r === 0 && p > 0) return below100(p) + ' Paise Only';
    let s = 'Rupees ' + wordsInt(r);
    if (p) s += ' and ' + below100(p) + ' Paise';
    return s + ' Only';
  };

  /* ------------------------------------------------------------------- dates */
  // Business dates are plain 'YYYY-MM-DD' strings in India Standard Time.
  const IST_MS = 5.5 * 3600 * 1000;
  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const MONTHS_LONG = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  const pad = (n, w) => String(n).padStart(w || 2, '0');
  const D = (s) => { const a = s.split('-'); return Date.UTC(+a[0], +a[1] - 1, +a[2]); };
  const S = (ms) => new Date(ms).toISOString().slice(0, 10);
  RW.pad = pad;
  RW.MONTHS = MONTHS;
  RW.MONTHS_LONG = MONTHS_LONG;
  RW.istDate = (ms) => S((typeof ms === 'string' ? Date.parse(ms) : ms) + IST_MS);
  RW.today = (nowMs) => RW.istDate(nowMs === undefined ? Date.now() : nowMs);
  RW.isValidDate = (s) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && S(D(s)) === s;
  RW.addDays = (s, n) => S(D(s) + n * 864e5);
  RW.diffDays = (a, b) => Math.round((D(a) - D(b)) / 864e5);
  RW.dow = (s) => new Date(D(s)).getUTCDay();
  RW.startOfWeek = (s) => RW.addDays(s, -((RW.dow(s) + 6) % 7)); // Monday
  RW.endOfWeek = (s) => RW.addDays(RW.startOfWeek(s), 6);
  RW.startOfMonth = (s) => s.slice(0, 8) + '01';
  RW.endOfMonth = (s) => S(Date.UTC(+s.slice(0, 4), +s.slice(5, 7), 0));
  RW.addMonths = (s, n) => { const y = +s.slice(0, 4), m = +s.slice(5, 7) - 1 + n; return S(Date.UTC(y + Math.floor(m / 12), ((m % 12) + 12) % 12, 1)); };
  RW.fiscalStart = (s, startMonth) => {
    startMonth = startMonth || 4;
    const y = +s.slice(0, 4), m = +s.slice(5, 7);
    return pad(m >= startMonth ? y : y - 1, 4) + '-' + pad(startMonth) + '-01';
  };
  RW.fiscalEnd = (s, startMonth) => RW.addDays(RW.addMonths(RW.fiscalStart(s, startMonth), 12), -1);
  RW.fiscalLabel = (s, startMonth) => {
    const y = +RW.fiscalStart(s, startMonth).slice(0, 4);
    return (startMonth || 4) === 1 ? String(y) : y + '-' + pad((y + 1) % 100);
  };
  RW.fmtDate = (s) => (s ? +s.slice(8, 10) + ' ' + MONTHS[+s.slice(5, 7) - 1] + ' ' + s.slice(0, 4) : '');
  RW.fmtDateShort = (s) => (s ? +s.slice(8, 10) + ' ' + MONTHS[+s.slice(5, 7) - 1] : '');
  RW.fmtDateTime = (iso) => {
    if (!iso) return '';
    const d = new Date(Date.parse(iso) + IST_MS);
    let h = d.getUTCHours();
    const ap = h >= 12 ? 'PM' : 'AM';
    h = h % 12 || 12;
    return d.getUTCDate() + ' ' + MONTHS[d.getUTCMonth()] + ' ' + d.getUTCFullYear() + ', ' + h + ':' + pad(d.getUTCMinutes()) + ' ' + ap;
  };
  RW.fmtTime = (iso) => RW.fmtDateTime(iso).split(', ')[1] || '';
  RW.timeAgo = (iso, nowMs) => {
    const s = Math.max(0, Math.round(((nowMs || Date.now()) - Date.parse(iso)) / 1000));
    if (s < 45) return 'just now';
    if (s < 3600) return Math.round(s / 60) + ' min ago';
    if (s < 86400) return Math.round(s / 3600) + ' h ago';
    if (s < 86400 * 7) return Math.round(s / 86400) + ' d ago';
    return RW.fmtDate(RW.istDate(Date.parse(iso)));
  };

  // Named ranges used by dashboards and reports.
  RW.rangeFor = function (preset, today, fiscalStartMonth) {
    const t = today || RW.today();
    switch (preset) {
      case 'today': return { from: t, to: t, label: 'Today' };
      case 'yesterday': { const y = RW.addDays(t, -1); return { from: y, to: y, label: 'Yesterday' }; }
      case 'week': return { from: RW.startOfWeek(t), to: t, label: 'This Week' };
      case 'lastweek': { const s = RW.addDays(RW.startOfWeek(t), -7); return { from: s, to: RW.addDays(s, 6), label: 'Last Week' }; }
      case 'month': return { from: RW.startOfMonth(t), to: t, label: 'This Month' };
      case 'lastmonth': { const s = RW.addMonths(RW.startOfMonth(t), -1); return { from: s, to: RW.endOfMonth(s), label: 'Last Month' }; }
      case 'year': return { from: RW.fiscalStart(t, fiscalStartMonth), to: t, label: 'This Year' };
      case 'all': return { from: '2000-01-01', to: t, label: 'All Time' };
      default: throw new ApiError('VALIDATION', 'Unknown date range');
    }
  };

  /* ------------------------------------------------------------ ids & hashing */
  const hex = (buf) => Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, '0')).join('');
  RW.randomHex = (bytes) => hex(g.crypto.getRandomValues(new Uint8Array(bytes || 8)));
  RW.uid = (prefix) => (prefix ? prefix + '_' : '') + RW.randomHex(8);
  RW.sha256Hex = async (str) => hex(await g.crypto.subtle.digest('SHA-256', new TextEncoder().encode(str)));
  RW.hashPassword = async (password, saltHex, iterations) => {
    const key = await g.crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits']);
    const salt = new Uint8Array(saltHex.match(/../g).map((h) => parseInt(h, 16)));
    const bits = await g.crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: iterations || 60000 }, key, 256);
    return hex(bits);
  };
  RW.timingSafeEqualHex = (a, b) => {
    if (a.length !== b.length) return false;
    let r = 0;
    for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
    return r === 0;
  };
  RW.randomPassword = () => {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
    const a = g.crypto.getRandomValues(new Uint8Array(10));
    let s = Array.from(a, (b) => chars[b % chars.length]).join('');
    return s.slice(0, 8) + '@' + (a[0] % 10) + (a[1] % 10);
  };

  // Deterministic PRNG for repeatable demo data.
  RW.prng = (seed) => {
    let a = seed >>> 0;
    return () => {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  };

  /* --------------------------------------------------------------- misc helpers */
  RW.canonical = (v) => {
    if (v === null || typeof v !== 'object') return JSON.stringify(v === undefined ? null : v);
    if (Array.isArray(v)) return '[' + v.map(RW.canonical).join(',') + ']';
    return '{' + Object.keys(v).sort().map((k) => JSON.stringify(k) + ':' + RW.canonical(v[k])).join(',') + '}';
  };
  RW.csvCell = (v) => {
    let s = v === null || v === undefined ? '' : String(v);
    // neutralise spreadsheet formula injection
    if (/^[=+\-@\t\r]/.test(s) && !/^-?\d+(\.\d+)?$/.test(s)) s = "'" + s;
    return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  };
  RW.initials = (name) => {
    const w = String(name || '').trim().split(/\s+/).filter(Boolean);
    if (!w.length) return 'XX';
    return ((w[0][0] || '') + (w.length > 1 ? w[w.length - 1][0] : w[0][1] || w[0][0])).toUpperCase();
  };
  RW.esc = (s) => String(s === null || s === undefined ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
})(typeof window !== 'undefined' ? window : globalThis);
