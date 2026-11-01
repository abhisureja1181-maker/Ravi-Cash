/* Ravi Cash — backup file and restore.
 *
 * A backup is ONE JSON file with everything: branches, users (with their password hashes — never the passwords),
 * vouchers, registers, statements, outstanding, tours, notifications, the audit trail, settings and (optionally) the
 * receipt / meeting photos. It can be saved anywhere (Google Drive, WhatsApp, pen drive) and restored later.
 *
 *   backup.info       what the system holds now, when it was last backed up, is a reminder due?   (Super Admin)
 *   backup.export     the backup file                                                              (Super Admin)
 *   backup.restore    put a backup file back — asks the password again, a typed word, and first
 *                     keeps a copy of what is there now so a wrong restore can itself be undone     (Super Admin)
 *   backup.configure  how many days before the dashboard reminds to take a backup
 *   backup.list / backup.get / backup.restoreCopy
 *                     the copies a self-hosted server keeps by itself (hourly, daily, before every
 *                     permanent delete) — download one, or restore one without any file
 *
 * What a restore deliberately does NOT bring back from the file: people who are signed in right now stay signed in
 * (if they still exist in the backup), and the voucher numbers never go backwards — a number that was already given
 * out is not given out again.
 */
(function (g) {
  'use strict';
  const RW = (g.RW = g.RW || {});
  RW.serverModules = RW.serverModules || [];

  const FORMAT = 'ravi-cash-backup';
  const VERSION = 1;
  const APP = 'Ravi Cash 5.5';
  const ROLES = ['SUPER_ADMIN', 'CEO', 'BRANCH_ADMIN', 'USER', 'VIEWER'];
  const CORE_LISTS = ['branches', 'users', 'registers', 'vouchers', 'attachments', 'statements', 'outstanding', 'notifications', 'audit'];
  const OPTIONAL_LISTS = ['tours', 'visits'];
  const MAX_ITEMS = 2000000;
  const CONFIRM_PHRASE = 'RESTORE';
  const isObj = (x) => !!x && typeof x === 'object' && !Array.isArray(x);
  const bad = (msg) => new RW.ApiError('VALIDATION', msg);

  /* Numbers shown in the preview and stored in the file header. Pure: also used by the browser to preview a file. */
  function summary(db) {
    const arr = (k) => (Array.isArray(db && db[k]) ? db[k] : []);
    let inP = 0, outP = 0, first = '', last = '';
    for (const v of arr('vouchers')) {
      if (v && v.status === 'ACTIVE' && v.review !== 'INVALID') { if (v.transfer) { /* money moved between branches is neither cash in nor cash out */ } else if (v.type === 'RECEIPT') inP += v.amountPaise || 0; else outP += v.amountPaise || 0; }
      if (v && v.date) { if (!first || v.date < first) first = v.date; if (v.date > last) last = v.date; }
    }
    return {
      branches: arr('branches').length, users: arr('users').filter((u) => u && !u.deleted).length, vouchers: arr('vouchers').length,
      photos: arr('attachments').length, tours: arr('tours').length, outstanding: arr('outstanding').length, statements: arr('statements').length,
      audit: arr('audit').length, cashInPaise: inP, cashOutPaise: outP, firstVoucherDate: first, lastVoucherDate: last,
    };
  }

  /* Is this file really a Ravi Cash backup, whole and undamaged? Throws a ValidationError saying what is wrong.
   * Returns { db, kv, warnings }. (The same function runs in the browser for the preview and on the server for the restore.) */
  async function checkFile(file) {
    if (!isObj(file) || file.format !== FORMAT) throw bad('This is not a Ravi Cash backup file. Choose the .json file that was saved with "Download backup".');
    if (!(Number(file.version) >= 1)) throw bad('This backup file has no version number, so it cannot be trusted.');
    if (Number(file.version) > VERSION) throw bad('This backup was made by a newer Ravi Cash (file version ' + file.version + '). Update the app first, then restore it.');
    const d = file.data;
    if (!isObj(d) || !isObj(d.db)) throw bad('The backup file is incomplete: it holds no data.');
    if (typeof file.checksum !== 'string' || !/^[0-9a-f]{64}$/.test(file.checksum)) throw bad('The backup file has no checksum, so it cannot be checked. Use a file saved by "Download backup".');
    const sum = await RW.sha256Hex(JSON.stringify(d));
    if (sum !== file.checksum) throw bad('The backup file is damaged or was changed after it was saved (its checksum does not match). Use another copy of the backup.');
    const db = d.db, kv = isObj(d.kv) ? d.kv : {};
    for (const k of CORE_LISTS) if (!Array.isArray(db[k])) throw bad('The backup is incomplete: the list "' + k + '" is missing.');
    for (const k of OPTIONAL_LISTS) if (db[k] !== undefined && !Array.isArray(db[k])) throw bad('The backup is damaged: "' + k + '" is not a list.');
    for (const k of CORE_LISTS.concat(OPTIONAL_LISTS)) if ((db[k] || []).length > MAX_ITEMS) throw bad('The backup is too large to restore.');
    for (const k of ['counters', 'seq', 'settings']) if (db[k] !== undefined && !isObj(db[k])) throw bad('The backup is damaged: "' + k + '" is not valid.');
    const seen = (list, what, check) => {
      const ids = new Set();
      for (const x of list) {
        if (!isObj(x) || typeof x.id !== 'string' || !x.id) throw bad('The backup is damaged: a ' + what + ' has no id.');
        if (ids.has(x.id)) throw bad('The backup is damaged: the ' + what + ' id ' + x.id + ' appears twice.');
        ids.add(x.id);
        if (check) check(x);
      }
      return ids;
    };
    const branchIds = seen(db.branches, 'branch', (b) => { if (typeof b.code !== 'string' || !b.code) throw bad('The backup is damaged: a branch has no code.'); });
    seen(db.users, 'user', (u) => {
      if (!ROLES.includes(u.role)) throw bad('The backup is damaged: user "' + u.username + '" has an unknown role.');
      if (typeof u.username !== 'string' || !u.username || typeof u.pwHash !== 'string' || typeof u.pwSalt !== 'string') throw bad('The backup is damaged: a user is missing sign-in details.');
    });
    seen(db.vouchers, 'voucher', (v) => {
      if (v.type !== 'PAYMENT' && v.type !== 'RECEIPT') throw bad('The backup is damaged: a voucher has no type.');
      if (!Number.isInteger(v.amountPaise) || v.amountPaise < 0) throw bad('The backup is damaged: a voucher has an invalid amount.');
      if (typeof v.date !== 'string') throw bad('The backup is damaged: a voucher has no date.');
    });
    if (!db.users.some((u) => u.role === 'SUPER_ADMIN' && !u.deleted && u.status === 'ACTIVE')) {
      throw bad('This backup has no active Super Admin, so nobody could sign in after restoring it. It cannot be restored.');
    }
    const warnings = [];
    if (db.users.some((u) => !u.deleted && u.role !== 'SUPER_ADMIN' && u.role !== 'CEO' && !branchIds.has(u.branchId))) warnings.push('Some users in this backup belong to a branch that is not in it; they will not be able to sign in.');
    // the receipt / meeting photos
    for (const k of Object.keys(kv)) {
      if (k === 'loc') { if (!isObj(kv[k])) throw bad('The backup is damaged: the location data is not valid.'); continue; }
      if (/^trail:\d{4}-\d{2}-\d{2}$/.test(k)) { if (!isObj(kv[k])) throw bad('The backup is damaged: a location trail is not valid.'); continue; }
      if (/^att:[A-Za-z0-9_.-]{1,100}$/.test(k)) { if (typeof kv[k] !== 'string' || !/^data:[a-z0-9/+.-]+;base64,/i.test(kv[k])) throw bad('The backup is damaged: a photo is not valid.'); continue; }
      throw bad('The backup contains something unexpected (' + String(k).slice(0, 30) + ').');
    }
    return { db, kv, warnings };
  }

  RW.Backup = { FORMAT, VERSION, CONFIRM_PHRASE, summary, checkFile };

  RW.serverModules.push(function (H) {
    const { ApiError, def, audit, notify, nowIso, cleanText } = H;
    const SUPER = ['SUPER_ADMIN'];
    const DAY = 864e5;
    const REMIND_CHOICES = [0, 1, 3, 7, 15, 30];

    /* ---------------------------------------------------------------- reminder */
    H.backupStatus = (s) => {
      const st = s.settings || {};
      const days = REMIND_CHOICES.includes(st.backupReminderDays) ? st.backupReminderDays : 7;      // 0 = no reminder
      const last = st.lastBackupAt || null;
      const age = last ? (H.clock() - Date.parse(last)) / DAY : null;
      const hasData = (s.vouchers || []).length > 0;
      return { lastAt: last, lastBy: st.lastBackupBy || '', remindDays: days, ageDays: age === null ? null : Math.floor(age), due: days > 0 && hasData && (age === null || age >= days) };
    };

    /* ------------------------------------------------------------ build a file */
    const detach = (x) => JSON.parse(JSON.stringify(x));
    const withoutSecrets = (s) => { const o = Object.assign({}, s); delete o.sessions; delete o.loginFails; return o; };
    const stamp = () => { const t = H.clock() + 19800000; return new Date(t).toISOString().slice(0, 10) + '-' + new Date(t).toISOString().slice(11, 16).replace(':', ''); };

    async function readPhotos(s, kv, getBlob) {
      let included = 0, missing = 0;
      for (const a of s.attachments) {
        const blob = await getBlob(a.id);
        if (typeof blob === 'string' && blob) { kv['att:' + a.id] = blob; included++; } else missing++;
      }
      return { included, missing };
    }

    async function makeFile(db, kv, meta) {
      const data = { db: detach(withoutSecrets(db)), kv };
      const file = {
        format: FORMAT, version: VERSION, app: APP, createdAt: nowIso(), createdBy: meta.by || '', source: meta.source || 'manual',
        company: (db.settings && db.settings.company && db.settings.company.name) || '', includesPhotos: !!meta.includesPhotos,
        photoCount: meta.photoCount || 0, photosMissing: meta.photosMissing || 0, counts: summary(db),
        note: 'Keep this file private: it holds your whole business data and every user\'s password hash. Restore it from Backup in the app.',
        checksum: await RW.sha256Hex(JSON.stringify(data)), data,
      };
      return file;
    }

    async function liveKv(s, withPhotos) {
      const kv = {};
      let photos = { included: 0, missing: 0 };
      if (withPhotos) photos = await readPhotos(s, kv, (id) => H.storage.get('att:' + id));
      const loc = await H.storage.get('loc');
      if (loc) kv.loc = loc;
      for (const k of await H.storage.keys('trail:')) { const t = await H.storage.get(k); if (t) kv[k] = t; }
      return { kv, photos };
    }

    /* A copy the server kept itself (read from its backups folder) turned into the same file format. */
    async function fileFromCopy(id, by) {
      if (!H.storage.readBackup) throw new ApiError('VALIDATION', 'This installation does not keep automatic copies.');
      let c;
      try { c = await H.storage.readBackup(id); } catch (e) { throw new ApiError('NOT_FOUND', 'That copy is not available any more.'); }
      const db = c.db;
      if (!isObj(db) || !Array.isArray(db.vouchers)) throw new ApiError('VALIDATION', 'That copy is damaged and cannot be used.');
      for (const k of CORE_LISTS.concat(OPTIONAL_LISTS)) if (db[k] === undefined) db[k] = [];
      const kv = {};
      let photos = { included: 0, missing: 0 };
      const have = c.kv || {};
      if (c.full) photos = await readPhotos(db, kv, async (aid) => have['att:' + aid]);
      if (have.loc) kv.loc = have.loc;
      for (const k of Object.keys(have)) if (k.startsWith('trail:')) kv[k] = have[k];
      return makeFile(db, kv, { by, source: 'server-copy', includesPhotos: !!c.full, photoCount: photos.included, photosMissing: photos.missing });
    }

    /* ------------------------------------------------------- password + restore */
    async function askPassword(ctx, p) {
      const s = ctx.state, u = ctx.user;
      if (String(p.confirm || '').trim().toUpperCase() !== CONFIRM_PHRASE) throw new ApiError('VALIDATION', 'Type ' + CONFIRM_PHRASE + ' to confirm');
      const key = 'restore:' + u.id, now = H.clock();
      const f = s.loginFails[key];
      if (f && f.lockedUntil && f.lockedUntil > now) { ctx.dirty = false; throw new ApiError('RATE_LIMIT', 'Too many wrong passwords. Try again in a few minutes.'); }
      const hash = await RW.hashPassword(String(p.password || ''), u.pwSalt, u.pwIter);
      if (!RW.timingSafeEqualHex(hash, u.pwHash)) {
        const rec = f && f.first > now - 600000 ? f : { count: 0, first: now };
        rec.count++;
        if (rec.count >= 5) { rec.lockedUntil = now + 300000; rec.count = 0; rec.first = now; }
        s.loginFails[key] = rec;
        await audit(ctx, { entity: 'SYSTEM', action: 'RESTORE_FAILED', entityLabel: 'Wrong password while restoring a backup', branchId: null });
        await ctx.save();
        throw new ApiError('VALIDATION', 'Your password is incorrect');
      }
      delete s.loginFails[key];
    }

    function fillDefaults(db) {
      const e = H.emptyState(), D = H.DEFAULT_SETTINGS();
      for (const k of Object.keys(e)) if (db[k] === undefined) db[k] = e[k];
      db.seq = Object.assign({}, e.seq, db.seq);
      db.counters = Object.assign({}, e.counters, db.counters);
      const st = db.settings = Object.assign({}, D, db.settings);
      st.company = Object.assign({}, D.company, st.company);
      st.numbering = { PAYMENT: Object.assign({}, D.numbering.PAYMENT, (st.numbering || {}).PAYMENT), RECEIPT: Object.assign({}, D.numbering.RECEIPT, (st.numbering || {}).RECEIPT) };
      db.sessions = {}; db.loginFails = {};
      return db;
    }

    async function doRestore(ctx, file, p, how) {
      const s = ctx.state, u = ctx.user;
      const reason = p.reason ? cleanText(p.reason, 0, 500, 'Reason') : '';
      await askPassword(ctx, p);
      const chk = await checkFile(file);                                  // everything is checked BEFORE anything is touched
      const before = summary(s);
      // A server with real storage keeps a full copy of what is there now first; if that fails nothing is changed.
      let safety = null;
      if (H.beforeRestore) {
        try { safety = (await H.beforeRestore()) || null; } catch (e) { throw new ApiError('VALIDATION', 'A safety copy of the current data could not be saved, so nothing was changed (' + (e && e.message ? e.message : e) + ').'); }
      }
      const keep = { rev: s.rev, sessions: s.sessions, loginFails: s.loginFails, counters: Object.assign({}, s.counters), lastBackupAt: s.settings.lastBackupAt, lastBackupBy: s.settings.lastBackupBy };
      const fresh = fillDefaults(chk.db);
      for (const k of Object.keys(s)) delete s[k];
      Object.assign(s, fresh);
      s.rev = keep.rev;
      s.loginFails = keep.loginFails;
      for (const k of Object.keys(keep.sessions)) { const x = H.userById(s, keep.sessions[k].userId); if (x && !x.deleted) s.sessions[k] = keep.sessions[k]; }
      // numbers that were already given out are never given out again
      for (const t of ['PAYMENT', 'RECEIPT']) s.counters[t] = Math.max(s.counters[t] || 0, keep.counters[t] || 0);
      if (keep.lastBackupAt) { s.settings.lastBackupAt = keep.lastBackupAt; s.settings.lastBackupBy = keep.lastBackupBy || ''; }
      const after = summary(s);
      for (const k of Object.keys(chk.kv)) if (k.startsWith('att:')) ctx.blobs[k.slice(4)] = chk.kv[k];
      await audit(ctx, { entity: 'SYSTEM', action: 'RESTORE', entityLabel: 'Data restored from a backup', branchId: null,
        old: before, new: { restoredBy: u.fullName, how, backupCreatedAt: file.createdAt || '', backupSource: file.source || '', includesPhotos: !!file.includesPhotos, ...after }, reason });
      notify(ctx, { kind: 'SYSTEM', title: 'Data was restored from a backup', body: u.fullName + ' restored the system from a backup' + (file.createdAt ? ' made on ' + RW.fmtDateTime(file.createdAt) : '') + '. Vouchers now: ' + after.vouchers + (reason ? '. Reason: ' + reason : ''), branchId: null, important: true });
      await ctx.save();                                                   // photos first, then the database
      const keepLoc = Object.keys(chk.kv).filter((k) => k === 'loc' || k.startsWith('trail:'));
      if (keepLoc.length && H.replaceLocations) await H.replaceLocations(Object.fromEntries(keepLoc.map((k) => [k, chk.kv[k]])));
      const me = H.userById(s, u.id);
      return { ok: true, before, after, photosRestored: Object.keys(chk.kv).filter((k) => k.startsWith('att:')).length, warnings: chk.warnings, safetyCopy: safety,
        signedOut: !(me && !me.deleted && me.status === 'ACTIVE' && s.sessions[ctx.sessionKey]) };
    }

    /* ------------------------------------------------------------------ methods */
    def('backup.info', { roles: SUPER }, async (ctx) => {
      const s = ctx.state;
      const photoBytes = s.attachments.reduce((a, x) => a + (x.size || 0), 0);
      return {
        counts: summary(s), photoBytes, estimatedBytes: Math.round(photoBytes * 1.37),
        status: H.backupStatus(s), auto: { supported: !!H.storage.listBackups },
        maxFileMb: Number(H.maxBackupMb) || 0, company: s.settings.company.name,
      };
    });

    def('backup.export', { w: true, roles: SUPER }, async (ctx, p) => {
      const s = ctx.state;
      const withPhotos = p.photos !== false;
      const { kv, photos } = await liveKv(s, withPhotos);
      const file = await makeFile(s, kv, { by: ctx.user.fullName, source: 'manual', includesPhotos: withPhotos, photoCount: photos.included, photosMissing: photos.missing });
      // remember it (the file itself was sealed above, so this note is not inside it)
      s.settings.lastBackupAt = nowIso(); s.settings.lastBackupBy = ctx.user.fullName;
      await audit(ctx, { entity: 'SYSTEM', action: 'BACKUP', entityLabel: 'Backup file downloaded', branchId: null, new: Object.assign({ withPhotos, photos: photos.included }, file.counts) });
      return { file, name: 'ravi-cash-backup-' + stamp() + '.json' };
    });

    def('backup.restore', { w: true, roles: SUPER }, async (ctx, p) => {
      if (!isObj(p.backup)) throw new ApiError('VALIDATION', 'Choose a backup file first');
      return doRestore(ctx, p.backup, p, 'file');
    });

    def('backup.configure', { w: true, roles: SUPER }, async (ctx, p) => {
      const days = parseInt(p.remindDays, 10);
      if (!REMIND_CHOICES.includes(days)) throw new ApiError('VALIDATION', 'Choose 0 (no reminder), 1, 3, 7, 15 or 30 days');
      const st = ctx.state.settings;
      const old = H.backupStatus(ctx.state).remindDays;
      if (days === old) return { ok: true };
      st.backupReminderDays = days;
      await audit(ctx, { entity: 'SETTINGS', entityId: 'settings', entityLabel: 'Backup reminder', action: 'EDIT', branchId: null, old: { backupReminderDays: old }, new: { backupReminderDays: days } });
      return { ok: true };
    });

    /* The copies the server keeps by itself. Old rolling copies are thinned for the screen: the newest 24, then the last one of each day. */
    def('backup.list', { roles: SUPER }, async () => {
      if (!H.storage.listBackups) return { supported: false, rows: [] };
      const all = await H.storage.listBackups();
      const rows = [], days = new Set();
      let autoShown = 0;
      for (const c of all) {                                              // newest first
        if (c.kind !== 'auto') { rows.push(c); continue; }
        const day = RW.istDate(c.at);
        if (autoShown < 24) { autoShown++; days.add(day); rows.push(c); continue; }
        if (!days.has(day) && days.size < 60) { days.add(day); rows.push(c); }
      }
      return { supported: true, rows: rows.slice(0, 150) };
    });

    def('backup.get', { w: true, roles: SUPER }, async (ctx, p) => {
      const file = await fileFromCopy(String(p.id || ''), ctx.user.fullName);
      await audit(ctx, { entity: 'SYSTEM', action: 'BACKUP', entityLabel: 'Server copy downloaded', branchId: null, new: { copy: String(p.id).slice(0, 80) } });
      return { file, name: 'ravi-cash-copy-' + String(p.id).replace(/[^A-Za-z0-9-]/g, '') + '.json' };
    });

    def('backup.restoreCopy', { w: true, roles: SUPER }, async (ctx, p) => {
      const file = await fileFromCopy(String(p.id || ''), ctx.user.fullName);
      return doRestore(ctx, file, p, 'server copy ' + String(p.id).slice(0, 60));
    });
  });
})(typeof window !== 'undefined' ? window : globalThis);
