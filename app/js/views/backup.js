/* Ravi Cash — Backup & Restore (Super Admin).
 *
 *  - Download a backup: ONE .json file with everything (optionally with the photos).
 *  - Restore from a backup file: the file is checked here first (is it whole, whose is it, what is in it), compared with
 *    what the system holds now, and only then restored — after the password and the word RESTORE.
 *  - The copies a self-hosted server keeps by itself (hourly, daily, before every permanent delete) can be downloaded or restored.
 *  - A reminder on the dashboard when the last backup is older than the chosen number of days.
 */
(function (g) {
  'use strict';
  const RW = (g.RW = g.RW || {});
  const UI = RW.ui, V = RW.v;
  const { h } = UI;

  const mb = (b) => (b >= 1048576 ? (b / 1048576).toFixed(b >= 10485760 ? 0 : 1) + ' MB' : Math.max(1, Math.round(b / 1024)) + ' KB');
  const num = (n) => Number(n || 0).toLocaleString('en-IN');
  const agoText = (iso) => (iso ? RW.fmtDateTime(iso) + ' · ' + RW.timeAgo(iso) : '');

  /* Make the backup file on the server and hand it to the browser as a download. Used by the Backup page, the dashboard
   * reminder and the "clear all data" dialog. Resolves { name, bytes }. */
  V.downloadBackup = async function (o) {
    const r = await RW.api.call('backup.export', { photos: !(o && o.photos === false) });
    const blob = new Blob([JSON.stringify(r.file)], { type: 'application/json' });
    UI.download(blob, r.name, 'application/json');
    return { name: r.name, bytes: blob.size, counts: r.file.counts };
  };
  V.backupSavedToast = (r) => UI.toast('Backup saved as ' + r.name + ' (' + mb(r.bytes) + '). Keep it somewhere safe — Google Drive, email, pen drive.', 'success', { ms: 9000 });

  const KIND = {
    auto: ['Automatic · hourly', 'Ledger only (no photos)'],
    daily: ['Daily copy', 'Full: ledger + photos'],
    'before-erase': ['Taken just before something was erased', 'Full: ledger + photos'],
    'before-clear': ['Taken just before “Clear all data”', 'Full: ledger + photos'],
    'before-restore': ['Taken just before a restore', 'Full: ledger + photos'],
  };

  /* The confirmation every restore goes through: password, the word RESTORE, optional reason. */
  function restoreDialog(o) {
    const demo = RW.api.kind === 'demo';
    const keepCopy = h('input', { type: 'checkbox', checked: true });
    let saved = false;                       // the copy of the current data is made once, even if the password has to be retyped
    const pw = h('input', { type: 'password', autocomplete: 'current-password', placeholder: 'Your password' });
    const phrase = h('input', { type: 'text', autocomplete: 'off', autocapitalize: 'characters', placeholder: 'RESTORE' });
    const why = h('textarea', { rows: 2, maxlength: 500, placeholder: 'Optional — saved in the audit log' });
    const fPw = UI.field('Your password', pw), fPhrase = UI.field('Type RESTORE to confirm', phrase), fWhy = UI.field('Reason', why, { optional: true });
    UI.modal({ title: o.title || 'Restore this backup', size: 'md', persistent: true,
      body: h('div', { class: 'stack', style: { gap: '14px' } },
        h('div', { class: 'callout warn' }, UI.icon('alert', 16), h('div', null, h('b', null, 'This replaces everything now in the system'), h('div', null, o.lines || []))),
        h('div', { class: 'callout info' }, UI.icon('shield', 16), h('span', null, demo ? 'A copy of what is there now is not kept by the demo itself — keep the box below ticked.' : 'The server also saves a full copy of what is there now (in its backups folder) before anything is replaced, so even a wrong restore can be undone.')),
        h('label', { class: 'opt-row' }, keepCopy, h('span', null, 'Download a backup of my current data first', h('small', null, 'Recommended. You get a file of what is there right now, before it is replaced.'))),
        fWhy, fPw, fPhrase),
      actions: [{ label: 'Cancel' }, { label: 'Restore now', kind: 'danger', icon: 'history', keepOpen: true, onClick: async (m) => {
        UI.fieldError(fPw, ''); UI.fieldError(fPhrase, '');
        if (!pw.value) { UI.fieldError(fPw, 'Enter your password'); return false; }
        if (phrase.value.trim().toUpperCase() !== 'RESTORE') { UI.fieldError(fPhrase, 'Type RESTORE exactly as shown'); return false; }
        if (keepCopy.checked && !saved) { try { const r = await V.downloadBackup({ photos: false }); saved = true; UI.toast('Current data saved as ' + r.name, 'info', { ms: 6000 }); } catch (e) { UI.toast('Could not save a copy of the current data: ' + UI.errMsg(e) + ' Nothing was restored.', 'error', { ms: 9000 }); return false; } }
        let r;
        try { r = await o.run({ password: pw.value, confirm: phrase.value.trim().toUpperCase(), reason: why.value }); }
        catch (e) { if (/password|wrong|incorrect|too many/i.test(e.message || '')) { UI.fieldError(fPw, e.message); return false; } throw e; }
        m.close();
        UI.toast('Restored. Vouchers now: ' + num(r.after.vouchers) + ' (before: ' + num(r.before.vouchers) + ').' + (r.signedOut ? ' Please sign in again.' : ''), 'success', { ms: 8000 });
        setTimeout(() => { if (r.signedOut) { RW.api.session.clear(); location.hash = ''; } else location.hash = '#/dashboard'; location.reload(); }, 1400);
      } }] });
  }

  RW.route('/backup', async function (root, p, app) {
    app.title('Backup & Restore');
    let dead = false;
    root.appendChild(V.pageHead('Backup & Restore', 'Keep all your data in one file, and put it back if anything is erased by mistake.'));
    const host = h('div', null, V.loading(5));
    root.appendChild(host);
    let info = null, copies = null;

    async function load() {
      info = await RW.api.call('backup.info', {});
      copies = info.auto.supported ? await RW.api.call('backup.list', {}) : null;
      if (!dead) paint();
    }

    const card = (title, sub, ...kids) => h('div', { class: 'card' }, h('div', { class: 'card-h' }, h('h3', null, title, sub ? h('small', null, sub) : null)), h('div', { class: 'card-b stack', style: { gap: '14px' } }, ...kids));

    /* ------------------------------------------------------------ 1. download */
    function downloadCard() {
      const st = info.status, c = info.counts;
      const withPhotos = h('input', { type: 'checkbox', checked: true });
      const state = !st.lastAt ? h('div', { class: 'callout warn' }, UI.icon('alert', 16), h('span', null, h('b', null, 'No backup has been taken yet.'), ' Download one now.'))
        : st.due ? h('div', { class: 'callout warn' }, UI.icon('alert', 16), h('span', null, h('b', null, 'Backup is due.'), ' Last one: ' + agoText(st.lastAt) + (st.lastBy ? ' by ' + st.lastBy : '') + '.'))
        : h('div', { class: 'callout ok' }, UI.icon('check', 16), h('span', null, h('b', null, 'Backed up.'), ' Last one: ' + agoText(st.lastAt) + (st.lastBy ? ' by ' + st.lastBy : '') + '.'));
      const sizeNote = h('small', { class: 'muted', style: { display: 'block' } });
      const upd = () => {
        const est = withPhotos.checked ? info.estimatedBytes : 0;
        sizeNote.textContent = num(c.vouchers) + ' vouchers, ' + num(c.users) + ' users, ' + num(c.branches) + ' branches' + (withPhotos.checked && info.photoBytes ? ', ' + num(c.photos) + ' photos (about ' + mb(est) + ' extra)' : '') + '.'
          + (info.maxFileMb && withPhotos.checked && est > info.maxFileMb * 1048576 * 0.9 ? ' This is close to the ' + info.maxFileMb + ' MB limit for restoring a file — take it without photos.' : '');
      };
      withPhotos.addEventListener('change', upd); upd();
      const btn = h('button', { class: 'btn btn-primary btn-lg', type: 'button' }, UI.icon('download', 17), 'Download backup file');
      btn.addEventListener('click', async () => {
        btn.disabled = true; btn.classList.add('busy');
        try { const r = await V.downloadBackup({ photos: withPhotos.checked }); V.backupSavedToast(r); await load(); }
        catch (e) { UI.toast(UI.errMsg(e), 'error'); } finally { btn.disabled = false; btn.classList.remove('busy'); }
      });
      const remind = UI.select([{ value: 0, label: 'Never remind me' }, { value: 1, label: 'Every day' }, { value: 3, label: 'Every 3 days' }, { value: 7, label: 'Every week' }, { value: 15, label: 'Every 15 days' }, { value: 30, label: 'Every month' }], st.remindDays);
      remind.addEventListener('change', async () => {
        try { await RW.api.call('backup.configure', { remindDays: remind.value }); UI.toast(remind.value === '0' ? 'No reminders.' : 'The dashboard will remind you when the last backup is older than that.', 'success'); }
        catch (e) { UI.toast(UI.errMsg(e), 'error'); }
      });
      return card('Download a backup', 'One file with all branches, users, vouchers, statements, tours and the audit trail', state,
        h('label', { class: 'opt-row' }, withPhotos, h('span', null, 'Include receipt and meeting photos', h('small', null, 'Needed to bring the photos back after they were erased. Makes the file bigger.'))), sizeNote,
        h('div', null, btn),
        h('div', { class: 'row', style: { gap: '10px', alignItems: 'center', flexWrap: 'wrap' } }, h('span', { class: 'muted', style: { fontSize: '13px' } }, 'Remind me on the dashboard:'), h('div', { style: { minWidth: '170px' } }, remind)),
        h('div', { class: 'callout info' }, UI.icon('info', 16), h('span', null, 'Save the file outside this phone/computer — Google Drive, your email, a pen drive. ',
          h('b', null, 'Keep it private:'), ' it holds all your business data and every user’s sign-in details (as scrambled hashes, not the passwords themselves).')));
    }

    /* ------------------------------------------------------- 2. restore a file */
    function restoreCard() {
      const out = h('div', { class: 'stack', style: { gap: '12px' } });
      const input = h('input', { type: 'file', accept: '.json,application/json', id: 'bkp-file', class: 'bkp-file' });
      const pick = h('label', { class: 'btn btn-ghost', for: 'bkp-file' }, UI.icon('cloudup', 16), 'Choose backup file…');
      input.addEventListener('change', async () => {
        const f = input.files && input.files[0];
        if (!f) return;
        UI.mount(out, h('div', { class: 'callout info' }, UI.icon('clock', 16), h('span', null, 'Checking ' + f.name + ' …')));
        try {
          if (info.maxFileMb && f.size > info.maxFileMb * 1048576 * 0.97) throw new Error('This file is ' + mb(f.size) + ', more than this server accepts (' + info.maxFileMb + ' MB). Take backups without photos, or restore from the server’s own copies below.');
          let file;
          try { file = JSON.parse(await f.text()); } catch (e) { throw new Error('This file cannot be read — it is not a backup file, or it is cut short.'); }
          const chk = await RW.Backup.checkFile(file);
          UI.mount(out, preview(file, chk, f));
        } catch (e) {
          UI.mount(out, h('div', { class: 'callout bad' }, UI.icon('alert', 16), h('span', null, h('b', null, 'This file cannot be restored.'), ' ' + UI.errMsg(e))));
        } finally { input.value = ''; }
      });
      return card('Restore from a backup file', 'Pick a file saved earlier with “Download backup file”', h('div', null, pick, input), out,
        h('p', { class: 'muted', style: { margin: 0, fontSize: '12.5px' } }, 'Nothing changes when you choose a file — you first see what is inside and how it differs from now.'));
    }

    function preview(file, chk, f) {
      const B = RW.Backup.summary(chk.db), N = info.counts;
      const photosInFile = Object.keys(chk.kv).filter((k) => k.startsWith('att:')).length;
      const row = (k, a, b, money) => { const fmt = (v) => (money ? RW.fmtINR(v) : num(v)); return h('tr', null, h('td', null, k), h('td', { class: 'num' }, fmt(a)), h('td', { class: 'num' }, h('b', null, fmt(b)))); };
      const diff = B.vouchers - N.vouchers;
      const lines = [];
      if (diff < 0) lines.push(h('div', { class: 'callout warn' }, UI.icon('alert', 16), h('span', null, h('b', null, num(-diff) + ' voucher' + (diff === -1 ? '' : 's') + ' entered after this backup will disappear.'), ' Everything done after ' + RW.fmtDateTime(file.createdAt) + ' is not in this file.')));
      else if (diff > 0) lines.push(h('div', { class: 'callout info' }, UI.icon('info', 16), h('span', null, num(diff) + ' voucher' + (diff === 1 ? '' : 's') + ' that are missing now will be brought back.')));
      else lines.push(h('div', { class: 'callout info' }, UI.icon('info', 16), h('span', null, 'Same number of vouchers as now. Any edits made after this backup will be undone.')));
      lines.push(h('div', { class: 'callout info' }, UI.icon('key', 16), h('span', null, 'Users and passwords become the ones saved in the backup. If your own account is not in it, you will be signed out.')));
      for (const w of chk.warnings) lines.push(h('div', { class: 'callout warn' }, UI.icon('alert', 16), h('span', null, w)));
      const who = [file.company, file.createdBy ? 'saved by ' + file.createdBy : '', file.source === 'server-copy' ? '(a server copy)' : ''].filter(Boolean).join(' · ');
      return h('div', { class: 'bkp-preview' },
        h('div', { class: 'row sb', style: { flexWrap: 'wrap', gap: '8px' } }, h('div', null, h('b', null, 'Backup of ' + RW.fmtDateTime(file.createdAt)), h('div', { class: 'muted', style: { fontSize: '12.5px' } }, who + ' · ' + mb(f.size))),
          UI.badge('File is whole and unchanged', 'green', 'check')),
        h('table', { class: 'tbl bkp-cmp' }, h('thead', null, h('tr', null, h('th', null, ''), h('th', { class: 'num' }, 'Now'), h('th', { class: 'num' }, 'In this backup'))),
          h('tbody', null, row('Vouchers', N.vouchers, B.vouchers), row('Users', N.users, B.users), row('Branches', N.branches, B.branches), row('Cash received (all time)', N.cashInPaise, B.cashInPaise, true), row('Cash paid (all time)', N.cashOutPaise, B.cashOutPaise, true),
            h('tr', null, h('td', null, 'Latest voucher date'), h('td', { class: 'num' }, N.lastVoucherDate ? RW.fmtDate(N.lastVoucherDate) : '—'), h('td', { class: 'num' }, h('b', null, B.lastVoucherDate ? RW.fmtDate(B.lastVoucherDate) : '—'))))),
        h('div', { class: 'muted', style: { fontSize: '12.5px' } }, photosInFile ? num(photosInFile) + ' photos are in this file and will be put back.' : 'No photos in this file — photos already stored are kept as they are.'),
        ...lines,
        h('div', null, h('button', { class: 'btn btn-danger', type: 'button', onclick: () => restoreDialog({
          title: 'Restore backup of ' + RW.fmtDateTime(file.createdAt),
          lines: [h('div', null, num(B.vouchers) + ' vouchers, ' + num(B.users) + ' users — instead of the ' + num(N.vouchers) + ' vouchers and ' + num(N.users) + ' users now.')],
          run: (extra) => RW.api.call('backup.restore', Object.assign({ backup: file }, extra)),
        }) }, UI.icon('history', 16), 'Restore this backup…')));
    }

    /* ------------------------------------------------- 3. copies the server keeps */
    function copiesCard() {
      if (!copies || !copies.supported) {
        return card('Copies kept by the server', null, h('div', { class: 'callout info' }, UI.icon('info', 16), h('span', null, RW.api.kind === 'demo'
          ? 'This is the demo: its data lives only in this browser, and nobody keeps copies for it. Download a backup file to be safe. The online/self-hosted version also keeps hourly and daily copies by itself.'
          : 'This installation does not keep automatic copies. Download a backup file regularly.')));
      }
      const rows = copies.rows;
      const list = h('div', { class: 'bkp-copies' });
      if (!rows.length) list.appendChild(h('div', { class: 'muted', style: { padding: '8px 0' } }, 'No copies yet — the first one is made after the first change.'));
      for (const c of rows) {
        const k = KIND[c.kind] || [c.kind, c.full ? 'Full: ledger + photos' : 'Ledger only'];
        const dl = h('button', { class: 'btn btn-ghost btn-sm', type: 'button' }, UI.icon('download', 14), 'Download');
        dl.addEventListener('click', async () => {
          dl.disabled = true; dl.classList.add('busy');
          try { const r = await RW.api.call('backup.get', { id: c.id }); const blob = new Blob([JSON.stringify(r.file)], { type: 'application/json' }); UI.download(blob, r.name, 'application/json'); UI.toast('Saved as ' + r.name, 'success'); }
          catch (e) { UI.toast(UI.errMsg(e), 'error'); } finally { dl.disabled = false; dl.classList.remove('busy'); }
        });
        const rs = h('button', { class: 'btn btn-ghost btn-sm', type: 'button', style: { color: 'var(--bad)' }, onclick: () => restoreDialog({
          title: 'Restore the copy of ' + RW.fmtDateTime(c.at),
          lines: [h('div', null, k[0] + ' — ' + RW.fmtDateTime(c.at) + (c.full ? '' : '. This copy has the ledger only; photos stay as they are now.'))],
          run: (extra) => RW.api.call('backup.restoreCopy', Object.assign({ id: c.id }, extra)),
        }) }, UI.icon('history', 14), 'Restore…');
        list.appendChild(h('div', { class: 'bkp-copy' },
          h('div', { class: 'bkp-copy-t' }, h('b', null, RW.fmtDateTime(c.at)), h('span', { class: 'muted' }, RW.timeAgo(c.at)), h('span', { class: 'bkp-copy-k' }, k[0] + ' · ' + k[1] + (c.full && c.photos ? ' (' + num(c.photos) + ' photos)' : '') + ' · ' + mb(c.bytes))),
          h('div', { class: 'row', style: { gap: '6px', flex: 'none' } }, dl, rs)));
      }
      return card('Copies kept by the server', 'Made automatically — hourly, daily, and just before anything is erased', list,
        h('div', { class: 'callout warn' }, UI.icon('alert', 16), h('span', null, h('b', null, 'These copies sit on the same disk as your data.'), ' If the whole server or its disk is lost, they are lost with it. That is why you should also download a backup file now and then and keep it somewhere else.')));
    }

    // The restore card is built once: a colleague's voucher arriving by live sync must not wipe a file you are looking at.
    let restoreEl = null;
    function paint() {
      if (!restoreEl) restoreEl = restoreCard();
      UI.mount(host, h('div', { class: 'stack' }, downloadCard(), restoreEl, copiesCard()));
    }

    try { await load(); } catch (e) { if (!dead) UI.mount(host, V.errorCard(e, () => load())); }
    const again = UI.debounce(() => { if (!dead) load().catch(() => {}); }, 1500);
    const off = app.live(again);
    return { dispose() { dead = true; if (off) off(); } };
  }, { roles: ['SUPER_ADMIN'] });
})(typeof window !== 'undefined' ? window : globalThis);
