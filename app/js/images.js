/* Ravi Cash — receipt photos: in-app camera (Preview / Retake / Use Photo), automatic compression,
 * and JPEG conversion for the PDF engine. */
(function (g) {
  'use strict';
  const RW = (g.RW = g.RW || {});
  const UI = RW.ui;
  const { h } = UI;
  const IMG = (RW.img = {});

  const MAX_PDF_BYTES = 5 * 1024 * 1024;

  const readAsDataUrl = (blob) => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = () => rej(r.error); r.readAsDataURL(blob); });
  const toBlob = (canvas, type, q) => new Promise((res) => canvas.toBlob(res, type, q));

  async function decode(blob) {
    if (g.createImageBitmap) {
      try { return await g.createImageBitmap(blob, { imageOrientation: 'from-image' }); } catch (e) { /* fall back to <img> */ }
    }
    const url = URL.createObjectURL(blob);
    try {
      return await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => rej(new Error('This image cannot be read')); i.src = url; });
    } finally { setTimeout(() => URL.revokeObjectURL(url), 5000); }
  }

  /* Resize to <= maxDim and lower JPEG quality until it is small, but never below a level where
   * receipt text becomes unreadable (min 1280px long edge, quality 0.6). */
  IMG.compress = async function (blob, o) {
    o = o || {};
    const target = o.target || 380 * 1024;
    let dim = o.maxDim || 1600, q = o.quality || 0.8;
    const bmp = await decode(blob);
    const sw = bmp.width, sh = bmp.height;
    let best = null;
    for (let i = 0; i < 6; i++) {
      const k = Math.min(1, dim / Math.max(sw, sh));
      const w = Math.max(1, Math.round(sw * k)), hgt = Math.max(1, Math.round(sh * k));
      const c = document.createElement('canvas');
      c.width = w; c.height = hgt;
      const ctx = c.getContext('2d');
      ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, w, hgt);
      ctx.drawImage(bmp, 0, 0, w, hgt);
      const out = await toBlob(c, 'image/jpeg', q);
      if (!out) throw new Error('Could not process this image');
      best = { blob: out, width: w, height: hgt };
      if (out.size <= target) break;
      if (q > 0.62) q -= 0.08; else if (dim > 1280) dim = Math.max(1280, dim - 160); else break;
    }
    if (bmp.close) bmp.close();
    return { dataUrl: await readAsDataUrl(best.blob), size: best.blob.size, width: best.width, height: best.height, mime: 'image/jpeg' };
  };

  // File -> { name, mime, size, dataUrl } ready for the API
  IMG.fromFile = async function (file) {
    const base = String(file.name || 'receipt').replace(/\.[^.]+$/, '');
    if (file.type === 'application/pdf') {
      if (file.size > MAX_PDF_BYTES) throw new Error('PDF is too large (max 5 MB): ' + file.name);
      return { name: file.name || base + '.pdf', mime: 'application/pdf', size: file.size, dataUrl: await readAsDataUrl(file) };
    }
    if (!/^image\//.test(file.type)) throw new Error('Only photos and PDF files can be attached: ' + (file.name || 'file'));
    const c = await IMG.compress(file);
    return { name: base + '.jpg', mime: 'image/jpeg', size: c.size, dataUrl: c.dataUrl };
  };

  // dataUrl (any supported image) -> JPEG bytes for embedding in a PDF. PDFs return null.
  IMG.toJpegBytes = async function (dataUrl) {
    if (/^data:application\/pdf/.test(dataUrl)) return null;
    if (/^data:image\/jpe?g/.test(dataUrl)) return RW.dataUrlBytes(dataUrl);
    const blob = await (await fetch(dataUrl)).blob();
    const bmp = await decode(blob);
    const c = document.createElement('canvas');
    c.width = bmp.width; c.height = bmp.height;
    const ctx = c.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height); ctx.drawImage(bmp, 0, 0);
    const out = await toBlob(c, 'image/jpeg', 0.85);
    return new Uint8Array(await out.arrayBuffer());
  };

  /* --------------------------------------------------------------- camera */
  /* Opens the device camera. Resolves with an attachment ({name,mime,size,dataUrl}) or null.
   * Flow: live view -> shutter -> Preview with Retake / Use Photo.
   * If the browser cannot open a live camera (permission denied, no camera, insecure origin) we fall back to the
   * phone's native camera through <input capture>, then show the same Preview / Retake / Use Photo step. */
  IMG.camera = function (opts) {
    opts = opts || {};
    return new Promise((resolve) => {
      let stream = null, stage = 'live', shot = null, finished = false, fallbackInput = null;
      const stop = () => { if (stream) { stream.getTracks().forEach((t) => t.stop()); stream = null; } };
      const done = (v) => { if (finished) return; finished = true; stop(); resolve(v); };
      const holder = h('div', { class: 'cam-holder' });
      const msg = h('div', { class: 'callout info', style: { marginBottom: '12px' } }, UI.icon('info', 16), h('span', null, opts.hint || 'Hold the phone steady and keep the whole receipt inside the frame.'));
      const body = h('div', null, msg, holder);
      const m = UI.modal({ title: opts.title || 'Take photo of receipt', body, size: 'md', persistent: true, noFocus: true, onClose: () => done(null) });

      const nativeInput = () => {
        if (!fallbackInput) {
          fallbackInput = h('input', { type: 'file', accept: 'image/*', capture: 'environment', onchange: async () => { const f = fallbackInput.files[0]; fallbackInput.value = ''; if (f) await gotFile(f); } });
          body.appendChild(fallbackInput);
        }
        fallbackInput.click();
      };
      const gotFile = async (f) => {
        try { const att = await IMG.fromFile(f); showPreview(att); } catch (e) { UI.toast(UI.errMsg(e), 'error'); }
      };
      const showPreview = (att) => {
        stop(); stage = 'preview'; shot = att;
        UI.mount(holder,
          h('div', { class: 'cam' }, h('img', { src: att.dataUrl, alt: opts.alt || 'Receipt preview' })),
          h('div', { class: 'cam-bar' },
            h('button', { class: 'btn btn-ghost btn-lg', type: 'button', onclick: () => retake() }, UI.icon('refresh', 18), 'Retake'),
            h('button', { class: 'btn btn-accent btn-lg', type: 'button', onclick: () => { done(shot); m.close(); } }, UI.icon('check', 18), 'Use Photo')),
          h('p', { class: 'muted', style: { textAlign: 'center', marginTop: '10px', fontSize: '12px' } }, 'Photo compressed to ' + Math.round(att.size / 1024) + ' KB · text stays readable'));
      };
      const retake = () => { shot = null; stage = 'live'; startLive(); };
      const startLive = async () => {
        UI.mount(holder, h('div', { class: 'cam' }, h('span', { class: 'muted' }, 'Opening camera…')));
        if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia || !g.isSecureContext) return fallbackUI('Live camera is not available in this browser.');
        try {
          stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' }, width: { ideal: 2560 }, height: { ideal: 1440 } }, audio: false });
        } catch (e) {
          return fallbackUI(e && e.name === 'NotAllowedError' ? 'Camera permission was denied. Allow camera access in your browser settings, or use the phone camera below.' : 'No camera could be opened.');
        }
        if (finished) return stop();
        const video = h('video', { autoplay: true, playsinline: true, muted: true });
        video.srcObject = stream;
        UI.mount(holder,
          h('div', { class: 'cam' }, video),
          h('div', { class: 'cam-bar' },
            h('button', { class: 'btn btn-ghost', type: 'button', onclick: () => { m.close(); } }, 'Cancel'),
            h('button', { class: 'shutter', type: 'button', 'aria-label': 'Take photo', onclick: async () => {
              if (!video.videoWidth) return;
              const c = document.createElement('canvas'); c.width = video.videoWidth; c.height = video.videoHeight;
              c.getContext('2d').drawImage(video, 0, 0);
              const blob = await toBlob(c, 'image/jpeg', 0.92);
              try { showPreview(await IMG.fromFile(new File([blob], (opts.prefix || 'receipt') + '-' + Date.now() + '.jpg', { type: 'image/jpeg' }))); } catch (e) { UI.toast(UI.errMsg(e), 'error'); }
            } }),
            h('button', { class: 'btn btn-ghost', type: 'button', onclick: () => nativeInput() }, UI.icon('image', 16), 'Gallery')));
      };
      const fallbackUI = (why) => {
        UI.mount(holder,
          h('div', { class: 'callout warn' }, UI.icon('alert', 16), h('span', null, why)),
          h('div', { class: 'cam-bar', style: { flexDirection: 'column', gap: '10px' } },
            h('button', { class: 'btn btn-accent btn-lg btn-block', type: 'button', onclick: () => nativeInput() }, UI.icon('camera', 18), 'Open phone camera'),
            h('button', { class: 'btn btn-ghost btn-block', type: 'button', onclick: () => m.close() }, 'Cancel')));
      };
      startLive();
    });
  };

  /* ---------------------------------------------------- demo receipt photos */
  RW.makeDemoReceipt = async function (v, branchName) {
    const W = 560, H = 760, rnd = RW.prng(v.seq * 7919);
    const c = document.createElement('canvas'); c.width = W; c.height = H;
    const x = c.getContext('2d');
    x.fillStyle = '#d9d4c8'; x.fillRect(0, 0, W, H);
    // paper
    x.save(); x.translate(W / 2, H / 2); x.rotate((rnd() - 0.5) * 0.03); x.translate(-W / 2, -H / 2);
    x.shadowColor = 'rgba(0,0,0,.25)'; x.shadowBlur = 24; x.shadowOffsetY = 8; x.fillStyle = '#fbfaf5'; x.fillRect(46, 38, W - 92, H - 84); x.shadowColor = 'transparent';
    x.fillStyle = '#1d2733'; x.textAlign = 'center';
    x.font = 'bold 27px "Courier New", monospace'; x.fillText(String(v.partyName).slice(0, 26).toUpperCase(), W / 2, 96);
    x.font = '15px "Courier New", monospace'; x.fillStyle = '#4b5666';
    x.fillText('Cash Memo / Bill', W / 2, 124); x.fillText('Bill No: ' + (1000 + Math.floor(rnd() * 8999)) + '    Date: ' + RW.fmtDate(v.date), W / 2, 148);
    x.textAlign = 'left'; x.fillStyle = '#1d2733'; x.font = '16px "Courier New", monospace';
    const words = String(v.particulars).replace(/[–—]/g, '-').split(/\s+/); const lines = []; let cur = '';
    for (const w of words) { if ((cur + ' ' + w).length > 34) { lines.push(cur); cur = w; } else cur = cur ? cur + ' ' + w : w; }
    if (cur) lines.push(cur);
    let y = 200;
    x.fillText('-'.repeat(38), 76, y - 18);
    lines.slice(0, 4).forEach((l) => { x.fillText(l, 76, y); y += 26; });
    const total = v.amountPaise, n = 3 + Math.floor(rnd() * 2);
    let left = total;
    for (let i = 0; i < n; i++) { const part = i === n - 1 ? left : Math.round((left * (0.3 + rnd() * 0.3)) / 100) * 100; left -= part; y += 30; x.fillText('Item ' + (i + 1), 76, y); x.textAlign = 'right'; x.fillText((part / 100).toLocaleString('en-IN', { minimumFractionDigits: 2 }), W - 76, y); x.textAlign = 'left'; }
    y += 28; x.fillText('-'.repeat(38), 76, y);
    y += 40; x.font = 'bold 22px "Courier New", monospace'; x.fillText('TOTAL', 76, y); x.textAlign = 'right'; x.fillText('Rs ' + (total / 100).toLocaleString('en-IN', { minimumFractionDigits: 2 }), W - 76, y);
    x.textAlign = 'center'; x.font = '14px "Courier New", monospace'; x.fillStyle = '#6b7686'; x.fillText('Thank you - visit again', W / 2, H - 110);
    x.strokeStyle = 'rgba(31,95,181,.55)'; x.lineWidth = 3; x.beginPath(); x.ellipse(W - 150, H - 190, 58, 34, -0.3, 0, Math.PI * 2); x.stroke(); x.fillStyle = 'rgba(31,95,181,.6)'; x.font = 'bold 13px Arial'; x.fillText('PAID', W - 150, H - 186);
    x.restore();
    void branchName;
    const blob = await toBlob(c, 'image/jpeg', 0.7);
    return readAsDataUrl(blob);
  };
})(typeof window !== 'undefined' ? window : globalThis);
