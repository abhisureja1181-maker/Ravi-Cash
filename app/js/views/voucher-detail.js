/* Ravi Cash — voucher detail: the voucher itself (always white paper), lock state, attachments,
 * activity timeline, PDF, and admin-only EDIT / VOID / DELETE (each needs a reason and is audit-logged). */
(function (g) {
  'use strict';
  const RW = (g.RW = g.RW || {});
  const UI = RW.ui, V = RW.v;
  const { h } = UI;

  const ACTION_ICON = { CREATE: 'plus', EDIT: 'edit', VOID: 'ban', DELETE: 'trash', ATTACH: 'clip', ATTACH_REMOVED: 'x', PDF: 'download', REVIEW: 'check' };
  const FIELD_LABEL = { date: 'Date', partyName: 'Party', particulars: 'Particulars', notes: 'Notes', amount: 'Amount (₹)', status: 'Status', review: 'Audit review', transfer: 'Branch transfer', counted: 'Counted as expense', receivedFrom: 'Received from', kind: 'Entry', name: 'File', number: 'Number', type: 'Type' };
  const showVal = (k, v) => (k === 'counted' ? (v ? 'Yes' : 'No') : k === 'date' ? RW.fmtDate(v) : k === 'amount' ? RW.fmtINR2(Math.round(Number(v) * 100)) : String(v === null || v === undefined || v === '' ? '—' : v));

  RW.route('/vouchers/:id', async function (root, p, app) {
    await RW.loadFonts();
    let dead = false, data = null;
    const host = h('div', null, V.loading(8));
    root.appendChild(host);
    const back = app.mgmt ? { href: '#/all-vouchers', label: app.isAdmin ? 'All Vouchers' : 'Vouchers' } : { href: '#/vouchers', label: 'My Vouchers' };

    async function load(first) {
      let d;
      try { d = await RW.api.call('vouchers.get', { id: p.id }); } catch (e) {
        if (dead) return;
        UI.mount(host, V.pageHead('Voucher not found', null, null, back), h('div', { class: 'card' }, UI.empty('This voucher could not be found', 'It may not exist, or it belongs to another branch.', 'search', h('a', { class: 'btn btn-primary btn-sm', style: { marginTop: '14px' }, href: back.href }, 'Back to vouchers'))));
        return;
      }
      if (dead) return;
      data = d; render(d);
      app.title(d.voucher.label);
      if (first && p.q.pdf === '1') { history.replaceState(null, '', '#/vouchers/' + p.id); pdf(false); }
    }

    async function pdf(open, btn) {
      if (btn) { btn.disabled = true; btn.classList.add('busy'); }
      try { await V.voucherPdf(p.id, { open }); UI.toast('PDF ready — page 1 is the voucher' + (data && data.attachments.length ? ', following pages hold the receipt photos.' : '.'), 'success', { ms: 3000 }); load(); } catch (e) { UI.toast(UI.errMsg(e), 'error'); } finally { if (btn) { btn.disabled = false; btn.classList.remove('busy'); } }
    }

    /* ------------------------------------------------------- admin dialogs */
    const reasonField = (label) => { const t = h('textarea', { rows: 3, maxlength: 500, placeholder: label || 'Why is this change needed? (required — saved in the audit log)' }); return { t, f: UI.field('Reason', t) }; };
    const needReason = (r) => { const ok = r.t.value.trim().length >= 5; UI.fieldError(r.f, ok ? '' : 'Please enter a reason (at least 5 characters)'); if (!ok) r.t.focus(); return ok; };

    function editDialog(d) {
      const v = d.voucher;
      const date = h('input', { type: 'date', value: v.date, max: app.today });
      const party = h('input', { type: 'text', value: v.partyName, maxlength: 120 });
      const parts = h('textarea', { rows: 3, maxlength: 1000 }, v.particulars); parts.value = v.particulars;
      const amt = h('input', { type: 'text', inputmode: 'decimal', value: String(v.amount) });
      const notes = h('textarea', { rows: 2, maxlength: 1000 }); notes.value = v.notes || '';
      const num = v.number ? h('input', { type: 'text', value: v.number, maxlength: 30, autocapitalize: 'characters', autocomplete: 'off', spellcheck: 'false' }) : null;
      const words = h('div', { class: 'amount-words' }, v.amountInWords);
      amt.addEventListener('input', () => { try { words.textContent = RW.amountInWords(RW.toPaise(amt.value.replace(/,/g, ''))); } catch (e) { words.textContent = ''; } });
      const r = reasonField();
      /* Branch transfer (main admin): mark an old entry as a transfer so it stops counting as expense / income, link it to the money that was sent, or take the mark off */
      const xferHostEd = h('div'), xs = { out: null, sel: null, rows: [] };
      (async () => {
        try {
          const t = await RW.api.call('transfers.targets', { asUserId: v.userId });
          if (v.type === 'PAYMENT') {
            xs.out = V.transferOutBox(t, { settledChoice: true, title: 'This payment was money sent to another branch or person (transfer)', hint: 'It then stops counting as an expense. The branch receives it by adding "Cash Received".' });
            if (v.transfer) xs.out.set({ branchId: v.transfer.branchId, userId: v.transfer.userId, settled: v.transfer.settled });
            UI.mount(xferHostEd, xs.out.el);
          } else {
            const pend = await RW.api.call('transfers.pending', { all: true });
            const opts = [h('option', { value: '' }, 'Not a transfer — counted as income')];
            if (v.transfer && v.transfer.link) opts.push(h('option', { value: 'link:' + v.transfer.link }, 'Linked to ' + (v.transfer.linkNumber || 'a transfer') + ' (' + UI.transferWho(v.transfer) + ')'));
            pend.rows.forEach((x) => opts.push(h('option', { value: 'link:' + x.id }, 'Received transfer ' + (x.number || '') + ' · ' + RW.fmtINR(x.amountPaise) + ' ' + UI.transferWho({ dir: 'IN', branchName: x.from.branchName, userName: x.from.userName }) + ' → ' + x.to.branchName)));
            t.branches.forEach((b) => opts.push(h('option', { value: 'branch:' + b.id }, 'Money from branch: ' + b.name + ' (not linked to a payment)')));
            xs.sel = h('select', null, opts);
            xs.sel.value = v.transfer ? (v.transfer.link ? 'link:' + v.transfer.link : 'branch:' + v.transfer.branchId) : '';
            UI.mount(xferHostEd, h('div', { class: 'xfer-box' }, UI.field('Is this money a branch transfer?', xs.sel, { hint: 'A transfer is not income. Choose the payment it belongs to, or only the branch it came from.' })));
          }
        } catch (e) { /* no transfer section if the server cannot be reached */ }
      })();
      UI.modal({
        title: 'Edit ' + v.label, size: 'md',
        body: h('div', { class: 'stack', style: { gap: '14px' } },
          h('div', { class: 'callout warn' }, UI.icon('alert', 16), h('span', null, (v.number ? 'You can also change the voucher number (it must stay unique).' : 'This entry has no voucher number.') + ' The old and new values, your name and the reason are recorded permanently.')),
          h('div', { class: 'form-grid' }, num ? UI.field('Voucher number', num, { class: 'span2', hint: 'Only the main admin can change it. Another voucher must not already use it.' }) : null, UI.field('Date', date), UI.field(v.type === 'PAYMENT' ? 'Paid To' : 'Received From', party), UI.field('Particulars', parts, { class: 'span2' }), UI.field('Amount (₹)', amt, { class: 'span2' }), h('div', { class: 'span2' }, words), UI.field('Notes', notes, { optional: true, class: 'span2' })),
          xferHostEd, r.f),
        actions: [{ label: 'Cancel' }, { label: 'Save correction', kind: 'primary', icon: 'check', keepOpen: true, onClick: async (m) => {
          if (!needReason(r)) return false;
          const patch = {};
          if (xs.out) {
            if (!xs.out.check()) return false;
            const nv = xs.out.value(), cur = v.transfer;
            if (!nv && cur) patch.transfer = null;
            else if (nv && (!cur || cur.branchId !== nv.toBranchId || (cur.userId || '') !== (nv.toUserId || '') || !!cur.settled !== !!nv.settled)) patch.transfer = nv;
          } else if (xs.sel) {
            const val = xs.sel.value, cur = v.transfer ? (v.transfer.link ? 'link:' + v.transfer.link : 'branch:' + v.transfer.branchId) : '';
            if (val !== cur) patch.transfer = !val ? null : val.startsWith('link:') ? { link: val.slice(5) } : { fromBranchId: val.slice(7) };
          }
          if (num && num.value.trim().toUpperCase() !== v.number) patch.number = num.value;
          if (date.value !== v.date) patch.date = date.value;
          if (party.value.trim() !== v.partyName) patch.partyName = party.value;
          if (parts.value.trim() !== v.particulars) patch.particulars = parts.value;
          if (notes.value.trim() !== (v.notes || '')) patch.notes = notes.value;
          let np; try { np = RW.toPaise(amt.value.replace(/,/g, '')); } catch (e) { UI.toast('Enter a valid amount', 'error'); return false; }
          if (np !== v.amountPaise) patch.amount = amt.value.replace(/,/g, '');
          if (!Object.keys(patch).length) { UI.toast('Nothing was changed.', 'info'); return false; }
          await RW.api.call('vouchers.edit', { id: v.id, patch, reason: r.t.value });
          UI.toast('Correction saved and logged in the audit trail.', 'success'); m.close(); load();
        } }],
      });
    }
    function voidDialog(d) {
      const r = reasonField('Why is this voucher being voided?');
      UI.modal({ title: 'Void ' + d.voucher.label, size: 'sm', body: h('div', { class: 'stack', style: { gap: '12px' } },
        h('div', { class: 'confirm-body' }, h('div', { class: 'confirm-ic danger' }, UI.icon('ban', 22)), h('p', null, 'A voided voucher stays on record, is stamped VOID and is excluded from cash totals. This cannot be undone.')), r.f),
      actions: [{ label: 'Cancel' }, { label: 'Void voucher', kind: 'danger', keepOpen: true, onClick: async (m) => { if (!needReason(r)) return false; await RW.api.call('vouchers.void', { id: d.voucher.id, reason: r.t.value }); UI.toast(d.voucher.label + ' voided.', 'success'); m.close(); load(); } }] });
    }
    function deleteDialog(d) {
      const r = reasonField('Why is this voucher being deleted?');
      UI.modal({ title: 'Delete ' + d.voucher.label, size: 'sm', body: h('div', { class: 'stack', style: { gap: '12px' } },
        h('div', { class: 'confirm-body' }, h('div', { class: 'confirm-ic danger' }, UI.icon('trash', 22)), h('p', null, 'The voucher is removed from lists and totals but stays on record: administrators can still see it under the “Deleted” filter and its number is never reused. To erase it completely, use “Delete permanently”.')), r.f),
      actions: [{ label: 'Cancel' }, { label: 'Delete voucher', kind: 'danger', keepOpen: true, onClick: async (m) => { if (!needReason(r)) return false; await RW.api.call('vouchers.delete', { id: d.voucher.id, reason: r.t.value }); UI.toast(d.voucher.label + ' deleted.', 'success'); m.close(); location.hash = back.href; } }] });
    }
    function purgeDialog(d) {
      const r = reasonField('Why is this voucher being erased?');
      const ack = h('input', { type: 'checkbox' });
      UI.modal({ title: 'Delete ' + d.voucher.label + ' permanently', size: 'sm', body: h('div', { class: 'stack', style: { gap: '12px' } },
        h('div', { class: 'confirm-body' }, h('div', { class: 'confirm-ic danger' }, UI.icon('trash', 22)), h('p', null, 'The voucher and its receipt photos are erased for good and removed from the cash register. The number is not reused. Only a short record of what was erased (number, party, amount, reason) stays in the audit log.')),
        r.f, h('label', { class: 'opt-row' }, ack, h('span', null, 'I understand this cannot be undone'))),
      actions: [{ label: 'Cancel' }, { label: 'Delete permanently', kind: 'danger', icon: 'trash', keepOpen: true, onClick: async (m) => {
        if (!needReason(r)) return false;
        if (!ack.checked) { UI.toast('Tick the box to confirm', 'error'); return false; }
        await RW.api.call('vouchers.purge', { ids: [d.voucher.id], reason: r.t.value }); UI.toast(d.voucher.label + ' deleted permanently.', 'success'); m.close(); location.hash = back.href;
      } }] });
    }
    function removeAttDialog(d, a) {
      const r = reasonField('Why is this file being removed?');
      UI.modal({ title: 'Remove attachment', size: 'sm', body: h('div', { class: 'stack', style: { gap: '12px' } }, h('p', null, 'Remove ', h('b', null, a.name), ' from ' + d.voucher.label + '?'), r.f),
        actions: [{ label: 'Cancel' }, { label: 'Remove', kind: 'danger', keepOpen: true, onClick: async (m) => { if (!needReason(r)) return false; await RW.api.call('vouchers.removeAttachment', { id: a.id, reason: r.t.value }); UI.toast('Attachment removed.', 'success'); m.close(); load(); } }] });
    }

    /* ---------------------------------------------------------- attachments */
    const io = 'IntersectionObserver' in g ? new IntersectionObserver((es) => es.forEach((e) => { if (e.isIntersecting) { io.unobserve(e.target); e.target._load && e.target._load(); } }), { rootMargin: '120px' }) : null;
    async function openAtt(a) {
      try {
        const f = await RW.api.call('attachments.get', { id: a.id });
        if (f.mime === 'application/pdf') { const bin = RW.dataUrlBytes(f.dataUrl); return UI.openBlob(bin, 'application/pdf'); }
        UI.modal({ title: a.name, size: 'lg', body: h('img', { src: f.dataUrl, alt: a.name, style: { width: '100%', borderRadius: '8px', background: '#fff' } }),
          actions: [{ label: 'Close' }, { label: 'Download', kind: 'primary', icon: 'download', keepOpen: true, onClick: () => { UI.download(RW.dataUrlBytes(f.dataUrl), a.name, f.mime); return false; } }] });
      } catch (e) { UI.toast(UI.errMsg(e), 'error'); }
    }
    function attTile(d, a) {
      const isPdf = a.mime === 'application/pdf';
      const t = h('div', { class: 'att' + (isPdf ? ' file' : ''), tabindex: 0, role: 'button', 'aria-label': 'Open ' + a.name, onclick: () => openAtt(a), onkeydown: (e) => { if (e.key === 'Enter') openAtt(a); } },
        isPdf ? [UI.icon('file', 26), h('span', null, 'PDF')] : UI.icon('image', 24),
        d.canAdmin ? h('button', { class: 'att-x', type: 'button', 'aria-label': 'Remove ' + a.name, onclick: (e) => { e.stopPropagation(); removeAttDialog(d, a); } }, UI.icon('x', 14)) : null,
        h('span', { class: 'att-n' }, Math.round(a.size / 1024) + ' KB · ' + a.addedBy.split(' ')[0]));
      if (!isPdf) t._load = async () => { try { const f = await RW.api.call('attachments.get', { id: a.id }); const im = h('img', { src: f.dataUrl, alt: a.name, loading: 'lazy' }); t.insertBefore(im, t.firstChild); const ic = t.querySelector('.ico'); if (ic) ic.remove(); } catch (e) { /* keep placeholder */ } };
      if (io && !isPdf) io.observe(t); else if (t._load) t._load();
      return t;
    }
    async function addMore(d, files) {
      for (const f of files) {
        try { const a = await RW.img.fromFile(f); await RW.api.call('vouchers.addAttachment', { voucherId: d.voucher.id, attachment: { name: a.name, mime: a.mime, dataUrl: a.dataUrl } }); } catch (e) { UI.toast(UI.errMsg(e), 'error'); }
      }
      load();
    }

    /* -------------------------------------------------------------- timeline */
    function timeline(d) {
      const items = d.timeline.slice().reverse();
      return h('ol', { class: 'timeline' }, items.map((t) => h('li', { class: 't-' + t.action }, h('span', { class: 'tl-dot' }, UI.icon(ACTION_ICON[t.action] || 'clock', 13)),
        h('b', null, t.label), h('small', null, t.by + ' · ' + UI.roleName(t.role) + ' · ' + RW.fmtDateTime(t.at)),
        t.reason ? h('small', { style: { color: 'var(--ink-2)', marginTop: '2px' } }, 'Reason: ', t.reason) : null,
        t.old && t.new && Object.keys(t.new).length && (t.action === 'EDIT' || t.action === 'VOID' || t.action === 'REVIEW')
          ? h('div', { class: 'diff' }, Object.keys(t.new).map((k) => h('div', null, h('span', { class: 'muted' }, (FIELD_LABEL[k] || k) + ': '), h('s', null, showVal(k, (t.old || {})[k])), ' → ', h('ins', null, showVal(k, t.new[k]))))) : null)));
    }

    /* ---------------------------------------------------------------- render */
    function render(d) {
      const v = d.voucher, inn = v.type === 'RECEIPT';
      const pdfBtn = h('button', { class: 'btn btn-accent', type: 'button', onclick: (e) => pdf(false, e.currentTarget) }, UI.icon('download', 16), 'Download PDF');
      const acts = [pdfBtn, h('button', { class: 'btn btn-ghost', type: 'button', onclick: () => g.print() }, UI.icon('printer', 16), 'Print')];
      if (d.canAdmin && v.status === 'ACTIVE') { acts.push(h('button', { class: 'btn btn-ghost', type: 'button', onclick: () => editDialog(d) }, UI.icon('edit', 16), 'Edit')); acts.push(h('button', { class: 'btn btn-ghost', type: 'button', style: { color: 'var(--bad)' }, onclick: () => voidDialog(d) }, UI.icon('ban', 16), 'Void')); }
      if (d.canDelete && v.status !== 'DELETED') acts.push(h('button', { class: 'btn btn-ghost', type: 'button', style: { color: 'var(--bad)' }, onclick: () => deleteDialog(d) }, UI.icon('trash', 16), 'Delete'));
      if (d.canDelete) acts.push(h('button', { class: 'btn btn-ghost', type: 'button', style: { color: 'var(--bad)' }, onclick: () => purgeDialog(d) }, UI.icon('trash', 16), 'Delete permanently'));
      if (app.isAdmin) acts.push(h('a', { class: 'btn btn-ghost', href: '#/audit?entity=' + encodeURIComponent(v.number || v.id) }, UI.icon('history', 16), 'Audit'));

      const lock = v.status === 'VOID'
        ? h('div', { class: 'callout bad' }, UI.icon('ban', 16), h('span', null, h('b', null, 'VOID'), ' — this voucher is cancelled and excluded from cash totals.' + (v.voidReason ? ' Reason: ' + v.voidReason : '')))
        : v.status === 'DELETED' ? h('div', { class: 'callout bad' }, UI.icon('trash', 16), h('span', null, h('b', null, 'DELETED'), ' — visible to administrators only. Reason: ' + v.voidReason))
        : h('div', { class: 'lockbar' }, UI.icon('lock', 16), h('span', null, h('b', null, 'LOCKED'), ' · ', d.canAdmin ? 'The main admin can correct this voucher; every change is logged.' : 'This voucher can no longer be edited. Ask the main admin for a correction.'));

      const canAddPhoto = app.canCreate && v.status === 'ACTIVE' && (v.userId === app.user.id || d.canAdmin) && d.attachments.length < app.settings.maxAttachments;
      const fileIn = h('input', { type: 'file', accept: 'image/*,application/pdf', multiple: true, hidden: true, onchange: () => { const fs = Array.from(fileIn.files); fileIn.value = ''; addMore(d, fs); } });
      const attCard = h('div', { class: 'card' }, h('div', { class: 'card-h' }, h('h3', null, 'Attachments', h('small', null, d.attachments.length ? d.attachments.length + ' file' + (d.attachments.length > 1 ? 's' : '') + ' · printed after the voucher in the PDF' : 'No receipt photo attached')),
        canAddPhoto ? h('div', { class: 'acts', style: { display: 'flex', gap: '8px' } }, h('button', { class: 'btn btn-ghost btn-sm', type: 'button', onclick: async () => { const a = await RW.img.camera(); if (a) { try { await RW.api.call('vouchers.addAttachment', { voucherId: v.id, attachment: { name: a.name, mime: a.mime, dataUrl: a.dataUrl } }); UI.toast('Photo added.', 'success'); load(); } catch (e) { UI.toast(UI.errMsg(e), 'error'); } } } }, UI.icon('camera', 15), 'Photo'), h('button', { class: 'btn btn-ghost btn-sm', type: 'button', onclick: () => fileIn.click() }, UI.icon('image', 15), 'Gallery')) : null),
        h('div', { class: 'card-b' }, d.attachments.length ? h('div', { class: 'att-grid' }, d.attachments.map((a) => attTile(d, a))) : h('p', { class: 'muted' }, 'Nothing attached.'), fileIn));

      const info = h('div', { class: 'card' }, h('div', { class: 'card-h' }, h('h3', null, 'Details')), h('div', { class: 'card-b' }, h('dl', { class: 'kv' },
        h('dt', null, v.kind === 'RECEIVED' ? 'Entry' : 'Voucher'), h('dd', null, v.number ? [h('b', null, v.number), ' '] : null, UI.typeBadge(v.type, v.kind, v.transfer), ' ', UI.statusBadge(v.status)),
        v.transfer ? [h('dt', null, 'Branch transfer'), h('dd', null, V.transferLine(v.transfer), h('div', { class: 'muted', style: { fontSize: '12px', marginTop: '2px' } }, 'Not counted as ' + (inn ? 'income' : 'an expense') + ' — it only moves cash between registers.'))] : null,
        v.kind === 'RECEIVED' ? [h('dt', null, 'Voucher no.'), h('dd', null, h('span', { class: 'muted' }, 'None — cash received entries are not numbered'))] : null,
        h('dt', null, inn ? 'Received from' : 'Paid to'), h('dd', null, v.partyName),
        h('dt', null, 'Amount'), h('dd', null, h('b', { class: v.transfer ? 'amt-xfer' : inn ? 'amt-in' : 'amt-out' }, (inn ? '+ ' : '− ') + RW.fmtINR2(v.amountPaise))),
        h('dt', null, 'Date'), h('dd', null, RW.fmtDate(v.date)),
        h('dt', null, 'Branch'), h('dd', null, v.branchName),
        h('dt', null, 'Cash register'), h('dd', null, v.registerId + ' · ' + v.userName),
        h('dt', null, 'Created'), h('dd', null, RW.fmtDateTime(v.createdAt) + ' by ' + v.createdBy),
        v.version > 1 ? [h('dt', null, 'Last updated'), h('dd', null, RW.fmtDateTime(v.updatedAt) + ' by ' + v.updatedBy + ' (version ' + v.version + ')')] : null,
        v.notes ? [h('dt', null, 'Notes'), h('dd', null, v.notes)] : null)));

      const tl = h('div', { class: 'card' }, h('div', { class: 'card-h' }, h('h3', null, 'Activity timeline', h('small', null, 'Who did what, and when — history cannot be changed'))), h('div', { class: 'card-b' }, timeline(d)));

      UI.mount(host,
        V.pageHead(v.label, RW.fmtDate(v.date) + ' · ' + UI.typeLabel(v.type, v.kind, v.transfer) + ' · ' + v.branchName, acts, back),
        h('div', { class: 'grid g-form' },
          h('div', { class: 'stack' }, lock, V.reviewBox(v, app.isSuper, () => load()), h('div', { class: 'print-area' }, V.voucherSvg(v, d.company))),
          h('div', { class: 'stack' }, info, attCard, tl)));
    }

    load(true);
    app.live(() => load());
    return { dispose() { dead = true; if (io) io.disconnect(); } };
  });
})(typeof window !== 'undefined' ? window : globalThis);
