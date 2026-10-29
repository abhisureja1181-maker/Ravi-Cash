/* Ravi Cash — Create Voucher (Cash Payment / Cash Receipt): live preview, camera + gallery receipts,
 * confirm-before-save, and offline-first saving (the server assigns the number, never the device). */
(function (g) {
  'use strict';
  const RW = (g.RW = g.RW || {});
  const UI = RW.ui, V = RW.v;
  const { h } = UI;

  RW.route('/vouchers/new', async function (root, p, app) {
    app.title('Create Voucher');
    await RW.loadFonts();
    const S = app.settings;
    // type: PAYMENT | RECEIPT | RECEIVED. "Cash Received" = money handed to you; same form, but no voucher number.
    const st = { type: p.q.type === 'RECEIPT' ? 'RECEIPT' : p.q.type === 'RECEIVED' ? 'RECEIVED' : 'PAYMENT', atts: [], saving: false };
    const isRcvd = () => st.type === 'RECEIVED';
    const today = app.today;
    const minDate = app.isAdmin ? '2000-01-01' : RW.addDays(today, -(S.userBackdateDays || 7));

    /* ------------------------------------------------------------ controls */
    const typeSeg = UI.segmented([{ value: 'PAYMENT', label: 'Cash Payment', icon: 'outflow', tone: 'out' }, { value: 'RECEIPT', label: 'Cash Receipt', icon: 'inflow', tone: 'in' }, { value: 'RECEIVED', label: 'Cash Received', icon: 'wallet', tone: 'in' }], st.type, (v) => { st.type = v; onType(); }, 'seg-lg');
    const numBox = h('div', { class: 'vnum-auto' }, UI.icon('lock', 15), h('span', { id: 'vnum' }));
    const date = h('input', { type: 'date', value: today, min: minDate, max: today, required: true });
    const party = h('input', { type: 'text', maxlength: 120, placeholder: 'Name of the person / firm', autocomplete: 'off', required: true });
    const partyLabel = h('span');
    const particulars = h('textarea', { rows: 3, maxlength: 1000, placeholder: 'What is this payment for?', required: true });
    const amount = h('input', { type: 'text', inputmode: 'decimal', placeholder: '0.00', autocomplete: 'off', required: true, 'aria-label': 'Amount in rupees' });
    const words = h('div', { class: 'amount-words', 'aria-live': 'polite' });
    const notes = h('textarea', { rows: 2, maxlength: 1000, placeholder: 'Any extra note for the records' });
    const attHost = h('div', { class: 'att-grid' });
    const attInfo = h('small', { class: 'muted' });
    const fileIn = h('input', { type: 'file', accept: 'image/*,application/pdf', multiple: true, hidden: true, onchange: async () => { const fs = Array.from(fileIn.files); fileIn.value = ''; await addFiles(fs); } });
    const errBox = h('div', { class: 'callout bad', hidden: true, role: 'alert' });
    const balanceNote = h('div', { class: 'muted', style: { fontSize: '12.5px' } });

    const fAmount = UI.field('Amount', h('div', { class: 'rupee-input' }, h('span', null, '₹'), amount), { class: 'span2' });
    const fNum = UI.field('Voucher number', numBox), numLabel = fNum.querySelector('label');
    const rcvdHint = h('div', { class: 'callout info', hidden: true }, UI.icon('wallet', 16), h('span', null, h('b', null, 'Cash Received'), ' — use this when someone hands you money (for example the owner gives you cash for expenses). It is added to your cash balance so everyone can see how much cash you hold. It has no voucher number.'));
    const fParty = UI.field('', party), fParts = UI.field('', particulars, { class: 'span2' }), fDate = UI.field('Date', date);
    fParty.querySelector('label').appendChild(partyLabel);
    const partsLabel = fParts.querySelector('label');
    fAmount.appendChild(words);

    /* ------------------------------------------------------------ preview */
    const previewHost = h('div');
    const draft = () => {
      const paise = safePaise(amount.value);
      const nt = isRcvd() ? 'RECEIPT' : st.type;
      return {
        number: isRcvd() ? '' : S.numbering[nt].prefix + '-' + '#'.repeat(S.numbering[nt].pad), type: nt, kind: isRcvd() ? 'RECEIVED' : 'VOUCHER', date: date.value || today,
        partyName: party.value.trim(), particulars: particulars.value.trim() || (isRcvd() ? 'Cash received' + (party.value.trim() ? ' from ' + party.value.trim() : '') : ''), amountPaise: paise, amountInWords: paise ? RW.amountInWords(paise) : '',
        branchName: app.branch.name, branchCode: app.branch.code, userName: app.user.fullName, status: 'ACTIVE',
      };
    };
    const drawPreview = UI.debounce(() => { UI.mount(previewHost, V.voucherSvg(draft(), S.company)); }, 120);

    function safePaise(t) { try { return t && String(t).trim() ? RW.toPaise(t) : 0; } catch (e) { return 0; } }

    function onType() {
      typeSeg.set(st.type);
      const pay = st.type === 'PAYMENT', rc = isRcvd();
      partyLabel.textContent = pay ? 'Paid To' : 'Received From';
      partsLabel.firstChild.textContent = pay ? 'Particulars / Payment For' : rc ? 'Particulars (optional)' : 'Particulars';
      party.placeholder = pay ? 'Name of the person / firm you paid' : rc ? 'Who gave you the cash?' : 'Name of the person / firm who paid you';
      particulars.placeholder = pay ? 'What was this payment for?' : rc ? 'What is this cash for? (optional)' : 'What is this receipt for?';
      numLabel.firstChild.textContent = rc ? 'Entry' : 'Voucher number';
      const vn = document.getElementById('vnum');
      if (vn) vn.textContent = rc ? 'No voucher number' : S.numbering[st.type].prefix + '-' + '#'.repeat(S.numbering[st.type].pad) + '  (auto)';
      rcvdHint.hidden = !rc;
      submitBtn.lastChild.textContent = rc ? 'Save Entry' : 'Save Voucher';
      submitBtn.className = 'btn btn-lg ' + (pay ? 'btn-primary' : 'btn-primary');
      checkBalance(); drawPreview();
    }
    function checkBalance() {
      const bal = app.register ? app.register.balancePaise : null;
      const paise = safePaise(amount.value);
      if (st.type === 'PAYMENT' && bal !== null && bal !== undefined && paise > bal && paise > 0) {
        balanceNote.className = 'callout warn'; UI.mount(balanceNote, UI.icon('alert', 16), h('span', null, 'This payment is more than your current cash balance of ' + RW.fmtINR(bal) + (S.blockNegativeCash ? ' and will be rejected.' : '. Your register will go negative.')));
      } else { balanceNote.className = 'muted'; UI.mount(balanceNote); }
    }

    // amount: digits and one dot, max 2 decimals; shows Indian grouping + words while typing
    amount.addEventListener('input', () => {
      let t = amount.value.replace(/[^0-9.]/g, '');
      const i = t.indexOf('.'); if (i >= 0) t = t.slice(0, i + 1) + t.slice(i + 1).replace(/\./g, '').slice(0, 2);
      const [ip, dp] = t.split('.');
      const grouped = ip ? RW.groupIndian(String(parseInt(ip, 10) || 0)) : '';
      amount.value = t.includes('.') ? grouped + '.' + (dp || '') : grouped;
      const paise = safePaise(amount.value.replace(/,/g, ''));
      words.textContent = paise > 0 ? RW.amountInWords(paise) : '';
      checkBalance(); drawPreview();
    });
    [party, particulars, date].forEach((i) => i.addEventListener('input', drawPreview));

    /* -------------------------------------------------------- attachments */
    async function addFiles(files) {
      for (const f of files) {
        if (st.atts.length >= S.maxAttachments) { UI.toast('You can attach up to ' + S.maxAttachments + ' files.', 'warn'); break; }
        try { st.atts.push(await RW.img.fromFile(f)); } catch (e) { UI.toast(UI.errMsg(e), 'error'); }
      }
      drawAtts();
    }
    function drawAtts() {
      UI.mount(attHost, st.atts.map((a, i) => h('div', { class: 'att' + (a.mime === 'application/pdf' ? ' file' : ''), onclick: () => preview(a) },
        a.mime === 'application/pdf' ? [UI.icon('file', 26), h('span', null, 'PDF')] : h('img', { src: a.dataUrl, alt: a.name }),
        h('button', { class: 'att-x', type: 'button', 'aria-label': 'Remove ' + a.name, onclick: (e) => { e.stopPropagation(); st.atts.splice(i, 1); drawAtts(); } }, UI.icon('x', 14)),
        h('span', { class: 'att-n' }, Math.round(a.size / 1024) + ' KB'))));
      attInfo.textContent = st.atts.length ? st.atts.length + ' of ' + S.maxAttachments + ' attached · photos are compressed automatically' : 'Attach the bill or receipt photo (optional). It is saved with the voucher and printed on page 2 of the PDF.';
    }
    function preview(a) {
      if (a.mime === 'application/pdf') return UI.toast('PDF attachments open after the voucher is saved.', 'info');
      UI.modal({ title: a.name, size: 'lg', body: h('img', { src: a.dataUrl, alt: a.name, style: { width: '100%', borderRadius: '8px' } }), actions: [{ label: 'Close' }] });
    }
    const takePhoto = async () => { const a = await RW.img.camera(); if (a) { st.atts.push(a); drawAtts(); } };

    /* ------------------------------------------------------------- submit */
    const fieldErr = (f, m) => UI.fieldError(f, m);
    function validate() {
      let ok = true;
      const need = (f, cond, msg) => { fieldErr(f, cond ? '' : msg); if (!cond) ok = false; };
      need(fParty, party.value.trim().length >= 2, (st.type === 'PAYMENT' ? 'Paid To' : 'Received From') + ' is required');
      need(fParts, isRcvd() || particulars.value.trim().length >= 3, 'Please describe the particulars (at least 3 characters)');
      const paise = safePaise(amount.value.replace(/,/g, ''));
      need(fAmount, paise > 0, 'Enter an amount greater than 0');
      if (paise > S.maxVoucherAmountPaise) { fieldErr(fAmount, 'Amount cannot exceed ' + RW.fmtINR(S.maxVoucherAmountPaise)); ok = false; }
      need(fDate, !!date.value && date.value <= today && date.value >= minDate, 'Choose a valid date' + (app.isAdmin ? '' : ' (up to ' + S.userBackdateDays + ' days back)'));
      if (!ok) { const bad = UI.$('.field.has-err', root); if (bad) { bad.scrollIntoView({ behavior: 'smooth', block: 'center' }); const i = bad.querySelector('input,textarea'); if (i) i.focus({ preventScroll: true }); } }
      return ok;
    }
    const payload = () => ({ type: isRcvd() ? 'RECEIPT' : st.type, kind: isRcvd() ? 'RECEIVED' : undefined, date: date.value, partyName: party.value.trim(), particulars: particulars.value.trim(), notes: notes.value.trim(), amount: amount.value.replace(/,/g, ''), attachments: st.atts.map((a) => ({ name: a.name, mime: a.mime, dataUrl: a.dataUrl })) });

    async function submit(thenPdf) {
      if (st.saving) return;
      errBox.hidden = true;
      if (!validate()) return;
      const pay = st.type === 'PAYMENT', rc = isRcvd(), paise = safePaise(amount.value.replace(/,/g, ''));
      const ok = await UI.confirm({
        title: 'Save this ' + (pay ? 'payment voucher' : rc ? 'cash received entry' : 'cash receipt') + '?', icon: 'lock', ok: rc ? 'Save entry' : 'Save voucher',
        message: h('div', { class: 'stack', style: { gap: '10px' } },
          h('dl', { class: 'kv' }, rc ? [h('dt', null, 'Entry'), h('dd', null, 'Cash Received (no voucher number)')] : null, h('dt', null, pay ? 'Paid to' : 'Received from'), h('dd', null, party.value.trim()), h('dt', null, 'Amount'), h('dd', null, h('b', null, RW.fmtINR2(paise)), h('div', { class: 'muted' }, RW.amountInWords(paise))), h('dt', null, 'Date'), h('dd', null, RW.fmtDate(date.value)), h('dt', null, 'Attachments'), h('dd', null, String(st.atts.length))),
          h('div', { class: 'lockbar' }, UI.icon('lock', 15), h('span', null, 'After saving, this ' + (rc ? 'entry' : 'voucher') + ' is ', h('b', null, 'locked'), '. Only an administrator can correct it, and every change is recorded.'))),
      });
      if (!ok) return;
      st.saving = true; submitBtn.disabled = true; submitBtn.classList.add('busy');
      try {
        if (!RW.net.online) return await saveOffline();
        let r;
        try { r = await RW.api.call('vouchers.create', Object.assign(payload(), { clientId: 'web-' + RW.randomHex(8) })); } catch (e) {
          if (!e || e.code) throw e;     // validation / permission errors are shown to the user
          return await saveOffline();    // network-type failure: keep the work safe on this device
        }
        UI.toast(r.voucher.number ? r.voucher.number + ' saved and locked.' : 'Cash received entry saved — it is added to your cash balance.', 'success', { title: r.voucher.number ? 'Voucher created' : 'Cash received saved' });
        location.hash = '#/vouchers/' + r.voucher.id + (thenPdf ? '?pdf=1' : '');
      } catch (e) {
        UI.mount(errBox, UI.icon('alert', 16), h('span', null, UI.errMsg(e))); errBox.hidden = false; errBox.scrollIntoView({ behavior: 'smooth', block: 'center' });
      } finally { st.saving = false; submitBtn.disabled = false; submitBtn.classList.remove('busy'); }
    }
    async function saveOffline() {
      await RW.outbox.add(app.user.id, payload());
      UI.toast(isRcvd() ? 'Saved on this device. It will be sent to the server when you are back online.' : 'Saved on this device. It will be sent and numbered by the server when you are back online.', 'warn', { title: 'OFFLINE — WAITING FOR SYNC', ms: 6500 });
      location.hash = '#/vouchers';
    }

    const submitBtn = h('button', { class: 'btn btn-primary btn-lg', type: 'button', onclick: () => submit(false) }, UI.icon('check', 18), 'Save Voucher');
    const pdfBtn = h('button', { class: 'btn btn-accent btn-lg', type: 'button', onclick: () => submit(true) }, UI.icon('download', 18), 'Save & Generate PDF');
    const previewBtn = h('button', { class: 'btn btn-ghost btn-lg', type: 'button', onclick: () => {
      UI.modal({ title: 'Voucher preview', size: 'lg', body: h('div', null, V.voucherSvg(draft(), S.company), h('p', { class: 'muted', style: { marginTop: '10px', fontSize: '12px' } }, isRcvd() ? 'Preview only — cash received entries have no voucher number.' : 'Preview only — the voucher number is assigned by the server when you save.')), actions: [{ label: 'Close' }] });
    } }, UI.icon('eye', 18), 'Preview');

    /* --------------------------------------------------------------- layout */
    const offlineBanner = h('div', { class: 'callout warn', hidden: RW.net.online }, UI.icon('wifioff', 16), h('span', null, 'You are offline. You can still save — the voucher will show ', h('b', null, 'OFFLINE — WAITING FOR SYNC'), ' and gets its number when the connection returns.'));
    const offNet = RW.net.on((on) => { offlineBanner.hidden = on; });

    const form = h('form', { class: 'card', novalidate: true, onsubmit: (e) => { e.preventDefault(); submit(false); } },
      h('div', { class: 'card-b stack', style: { gap: '18px' } },
        typeSeg, rcvdHint,
        h('div', { class: 'form-grid' },
          fNum, fDate, fParty, h('div', { class: 'field' }, h('label', null, 'Cash register'), h('div', { class: 'vnum-auto', style: { borderStyle: 'solid' } }, UI.icon('wallet', 15), h('span', null, (app.register && app.register.id) || 'None'))),
          fParts, fAmount, h('div', { class: 'span2' }, balanceNote),
          UI.field('Notes', notes, { optional: true, class: 'span2' })),
        h('div', null,
          h('div', { class: 'row sb', style: { marginBottom: '8px' } }, h('b', { style: { fontSize: '13px' } }, 'Receipt / bill photos'), attInfo),
          h('div', { class: 'photo-btns', style: { marginBottom: '12px' } },
            h('button', { class: 'btn btn-ghost photo-btn', type: 'button', onclick: takePhoto }, UI.icon('camera', 20), 'Take Photo'),
            h('button', { class: 'btn btn-ghost photo-btn', type: 'button', onclick: () => fileIn.click() }, UI.icon('image', 20), 'Choose from Gallery')),
          fileIn, attHost),
        errBox, offlineBanner,
        h('div', { class: 'sticky-actions' }, submitBtn, pdfBtn, previewBtn)));

    root.appendChild(V.pageHead('Create Voucher', 'Record a cash payment, a cash receipt, or cash you received. It is saved instantly to your cash register.', null, { href: '#/vouchers', label: 'My Vouchers' }));
    root.appendChild(h('div', { class: 'grid g-form' }, form, h('div', { class: 'stack form-preview' }, h('div', { class: 'row sb' }, h('b', { style: { fontSize: '13px' } }, 'Live voucher preview'), h('span', { class: 'badge badge-gray' }, 'Draft')), previewHost)));
    onType(); drawAtts();
    party.focus({ preventScroll: true });
    return { dispose() { offNet(); drawPreview.cancel(); } };
  }, { roles: ['USER', 'BRANCH_ADMIN', 'SUPER_ADMIN'] });
})(typeof window !== 'undefined' ? window : globalThis);
