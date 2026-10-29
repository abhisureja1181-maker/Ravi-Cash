/* Ravi Cash — administration: Branches, Users, Outstanding. */
(function (g) {
  'use strict';
  const RW = (g.RW = g.RW || {});
  const UI = RW.ui, V = RW.v;
  const { h } = UI;
  const CH = () => RW.charts;

  const reasonBox = (ph) => { const t = h('textarea', { rows: 2, maxlength: 500, placeholder: ph || 'Reason (saved in the audit log)' }); return { t, f: UI.field('Reason', t) }; };
  const parseMoney = (t) => RW.toPaise(String(t || '').replace(/,/g, ''));
  const isMoney = (t) => { try { return parseMoney(t) > 0; } catch (e) { return false; } };

  // modal body that shows a one-time credential with copy buttons
  function credentialModal(title, lead, user, pw) {
    UI.modal({ title, size: 'sm', persistent: true,
      body: h('div', { class: 'stack', style: { gap: '12px' } }, h('p', { class: 'muted' }, lead),
        user ? h('div', { class: 'cred' }, h('span', null, user), h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Copy username', onclick: () => UI.copy(user) }, UI.icon('copy', 16))) : null,
        h('div', { class: 'cred' }, h('span', null, pw), h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Copy password', onclick: () => UI.copy(pw) }, UI.icon('copy', 16))),
        h('div', { class: 'callout warn' }, UI.icon('alert', 16), h('span', null, 'This temporary password is shown only once. The user must choose a new password at first sign-in.'))),
      actions: [{ label: 'I have noted it', kind: 'primary' }] });
  }

  /* ================================================================ branches */
  V.editBranch = function (br, done) {
    const isNew = !br;
    br = br || {};
    const name = h('input', { type: 'text', value: br.name || '', maxlength: 100, placeholder: 'Ravi Water Flow Pump - Pune' });
    const code = h('input', { type: 'text', value: br.code || '', maxlength: 10, placeholder: 'Auto (e.g. PUNE)', disabled: !isNew, style: { textTransform: 'uppercase' } });
    const addr = h('textarea', { rows: 2, maxlength: 300, placeholder: 'Street, city, state, PIN' }); addr.value = br.address && br.address !== '-' ? br.address : '';
    const contact = h('input', { type: 'text', value: br.contact && br.contact !== '-' ? br.contact : '', maxlength: 100, placeholder: 'Phone / email' });
    UI.modal({ title: isNew ? 'Add branch' : 'Edit ' + br.name, size: 'md',
      body: h('div', { class: 'form-grid' }, UI.field('Branch name', name, { class: 'span2' }), UI.field('Branch code', code, { hint: isNew ? 'Short unique code, used in register ids. Cannot be changed later.' : 'Cannot be changed' }), UI.field('Contact', contact), UI.field('Address', addr, { class: 'span2' })),
      actions: [{ label: 'Cancel' }, { label: isNew ? 'Create branch' : 'Save changes', kind: 'primary', keepOpen: true, onClick: async (m) => {
        if (isNew) await RW.api.call('branches.create', { name: name.value, code: code.value || undefined, address: addr.value || undefined, contact: contact.value || undefined });
        else await RW.api.call('branches.update', { id: br.id, name: name.value, address: addr.value || '-', contact: contact.value || '-' });
        UI.toast(isNew ? 'Branch created. Add its first user next.' : 'Branch updated.', 'success'); m.close(); if (done) done();
      } }] });
  };

  RW.route('/branches', async function (root, p, app) {
    app.title('Branches');
    let dead = false, preset = 'month';
    const host = h('div', { class: 'grid g3 m1' }, V.loading(4));
    const chips = V.presetChips([{ value: 'today', label: 'Today' }, { value: 'week', label: 'This Week' }, { value: 'month', label: 'This Month' }, { value: 'year', label: 'This Year' }], preset, (v) => { preset = v; load(); });
    root.appendChild(V.pageHead('Branches', app.seesAll ? 'Each branch has its own users, vouchers and cash registers. Data never mixes between branches.' : 'Your branch overview', [chips.el, app.isSuper ? h('button', { class: 'btn btn-accent', type: 'button', onclick: () => V.editBranch(null, load) }, UI.icon('plus', 16), 'Add Branch') : null]));
    root.appendChild(host);
    async function load() {
      try {
        const r = await RW.api.call('branches.list', { preset });
        if (dead) return;
        UI.mount(host, r.rows.map((b) => {
          const slot = V.slotFor(b.id), off = b.status !== 'ACTIVE';
          return h('div', { class: 'card branch-card', style: { opacity: off ? 0.72 : 1 } },
            h('div', { class: 'bc-h' }, h('b', null, h('i', { style: { background: 'var(--c' + slot + ')' } }), b.code + ' BRANCH'), off ? UI.badge('DISABLED', 'gray') : UI.badge('ACTIVE', 'green')),
            h('h4', null, b.name),
            h('p', { class: 'muted', style: { fontSize: '12.5px', margin: '-4px 0 12px', minHeight: '34px' } }, [b.address, b.contact].filter((x) => x && x !== '-').join(' · ') || 'No address added'),
            h('div', { class: 'bc-grid' }, h('div', { class: 'in' }, h('small', null, 'Cash In'), h('b', null, RW.fmtINR(b.inPaise))), h('div', { class: 'out' }, h('small', null, 'Cash Out'), h('b', null, RW.fmtINR(b.outPaise))), h('div', null, h('small', null, 'Balance'), h('b', { class: b.balancePaise < 0 ? 'neg' : '' }, RW.fmtINR(b.balancePaise))), h('div', null, h('small', null, 'Vouchers · Users'), h('b', null, b.count + ' · ' + b.userCount))),
            h('div', { class: 'row', style: { gap: '8px', marginTop: '14px', flexWrap: 'wrap' } },
              app.seesAll ? h('a', { class: 'btn btn-primary btn-sm', href: '#/branches/' + b.id }, UI.icon('chart', 14), 'Analytics') : null,
              h('a', { class: 'btn btn-ghost btn-sm', href: '#/users?branch=' + b.id }, UI.icon('users', 14), 'Users'),
              app.isSuper ? h('button', { class: 'btn btn-ghost btn-sm', type: 'button', onclick: () => V.editBranch(b, load) }, UI.icon('edit', 14), 'Edit') : null,
              app.isSuper ? h('button', { class: 'btn btn-ghost btn-sm', type: 'button', style: { color: off ? 'var(--ok)' : 'var(--bad)' }, onclick: () => toggle(b) }, UI.icon(off ? 'check' : 'ban', 14), off ? 'Enable' : 'Disable') : null,
              app.isSuper ? h('button', { class: 'btn btn-ghost btn-sm', type: 'button', style: { color: 'var(--bad)' }, onclick: () => delBranch(b) }, UI.icon('trash', 14), 'Delete') : null));
        }));
      } catch (e) { if (!dead) UI.mount(host, V.errorCard(e, load)); }
    }
    function delBranch(b) {
      const r = reasonBox('Why is this branch being deleted?');
      const code = h('input', { type: 'text', placeholder: b.code, autocomplete: 'off', autocapitalize: 'characters', style: { textTransform: 'uppercase' } });
      const fCode = UI.field('Type the branch code ' + b.code + ' to confirm', code);
      const sum = h('div', { class: 'callout bad' }, UI.icon('alert', 16), h('span', null, 'Counting what would be erased…'));
      RW.api.call('erase.preview', { branchId: b.id }).then((c) => UI.mount(sum, UI.icon('alert', 16), h('span', null, h('b', null, b.name), ' will be erased for good with its ', h('b', null, c.users + ' user' + (c.users === 1 ? '' : 's')), ', ', h('b', null, c.vouchers + ' voucher' + (c.vouchers === 1 ? '' : 's')), ', ' + c.attachments + ' receipt photo' + (c.attachments === 1 ? '' : 's') + (c.tours || c.visits ? ', ' + c.tours + ' tour plan' + (c.tours === 1 ? '' : 's') + ' with ' + c.visits + ' meeting' + (c.visits === 1 ? '' : 's') : '') + ', ' + c.outstanding + ' outstanding entr' + (c.outstanding === 1 ? 'y' : 'ies') + ' and all cash registers. This cannot be undone. To keep the data and only stop sign-ins, use “Disable” instead.')), () => {});
      UI.modal({ title: 'Delete ' + b.name, size: 'sm', body: h('div', { class: 'stack', style: { gap: '12px' } }, sum, fCode, r.f),
        actions: [{ label: 'Cancel' }, { label: 'Delete branch permanently', kind: 'danger', keepOpen: true, onClick: async (m) => {
          UI.fieldError(fCode, '');
          if (code.value.trim().toUpperCase() !== b.code) { UI.fieldError(fCode, 'Type ' + b.code + ' exactly'); return false; }
          await RW.api.call('branches.delete', { id: b.id, reason: r.t.value, confirmCode: code.value });
          UI.toast(b.name + ' deleted.', 'success'); m.close(); load();
        } }] });
    }
    async function toggle(b) {
      const off = b.status !== 'ACTIVE';
      const ok = await UI.confirm({ title: (off ? 'Enable ' : 'Disable ') + b.name + '?', icon: off ? 'check' : 'ban', tone: off ? '' : 'danger', ok: off ? 'Enable branch' : 'Disable branch', message: off ? 'Its users will be able to sign in again.' : 'Users of this branch will be signed out and cannot sign in until it is enabled again. Existing data is kept.' });
      if (!ok) return;
      try { await RW.api.call('branches.setStatus', { id: b.id, status: off ? 'ACTIVE' : 'DISABLED' }); UI.toast('Branch ' + (off ? 'enabled' : 'disabled') + '.', 'success'); load(); } catch (e) { UI.toast(UI.errMsg(e), 'error'); }
    }
    load(); app.live(load);
    return { dispose() { dead = true; } };
  }, { roles: ['SUPER_ADMIN', 'BRANCH_ADMIN', 'CEO'] });

  /* ================================================================== users */
  RW.route('/users', async function (root, p, app) {
    app.title('Users');
    let dead = false, branches = [];
    const q = h('input', { type: 'search', placeholder: 'Name, username, email, mobile…' });
    const role = UI.select([{ value: '', label: 'All roles' }, { value: 'SUPER_ADMIN', label: 'Super Admin' }, { value: 'CEO', label: 'CEO' }, { value: 'BRANCH_ADMIN', label: 'Branch Admin' }, { value: 'USER', label: 'Branch User' }, { value: 'VIEWER', label: 'Viewer' }], '');
    const status = UI.select([{ value: '', label: 'Any status' }, { value: 'ACTIVE', label: 'Active' }, { value: 'INACTIVE', label: 'Inactive' }, { value: 'SUSPENDED', label: 'Suspended' }], '');
    const branch = UI.select([{ value: '', label: 'All branches' }], p.q.branch || '');
    const host = h('div', null, V.loading(6));
    // Super Admin: tick users to delete several at once (never yourself)
    const sel = app.isSuper ? new Map() : null;
    const selBar = h('div', { class: 'sel-bar', hidden: true });
    let shown = [];
    const bar = h('div', { class: 'bar-filters' }, UI.field('Search', q, { class: 'wide' }), app.seesAll ? UI.field('Branch', branch) : null, UI.field('Role', role), UI.field('Status', status));
    root.appendChild(V.pageHead('Users', 'Accounts are created by administrators — there is no self-registration.', [app.isSuper ? h('button', { class: 'btn btn-accent', type: 'button', onclick: () => userDialog(null) }, UI.icon('plus', 16), 'Add User') : null]));
    root.appendChild(bar); root.appendChild(h('div', { class: 'card' }, selBar, h('div', { class: 'card-b flush' }, host)));
    const reload = UI.debounce(load, 220);
    q.addEventListener('input', reload); [role, status, branch].forEach((s) => s.addEventListener('change', load));
    if (app.seesAll) V.branchOptions(app).then((bo) => { branches = bo.filter((o) => o.value); UI.mount(branch, bo.map((o) => h('option', { value: o.value }, o.label))); branch.value = p.q.branch || ''; });

    async function load() {
      try {
        const r = await RW.api.call('users.list', { filters: { q: q.value.trim(), role: role.value, status: status.value, branchId: branch.value || undefined } });
        if (dead) return;
        shown = r.rows.filter((u) => u.id !== app.user.id);
        if (sel) for (const id of Array.from(sel.keys())) if (!shown.some((u) => u.id === id)) sel.delete(id);
        const headBox = sel ? h('input', { type: 'checkbox', 'aria-label': 'Select all users in this list' }) : null;
        const rowBoxes = [];
        const sync = () => {
          const n = shown.filter((u) => sel.has(u.id)).length;
          headBox.checked = n > 0 && n === shown.length; headBox.indeterminate = n > 0 && n < shown.length;
          rowBoxes.forEach(([cb, tr, u]) => { cb.checked = sel.has(u.id); tr.classList.toggle('picked', cb.checked); });
          drawSelBar();
        };
        if (sel) headBox.addEventListener('change', () => { shown.forEach((u) => { if (headBox.checked) sel.set(u.id, u); else sel.delete(u.id); }); sync(); });
        const selCell = (u, tr) => {
          if (!sel) return null;
          if (u.id === app.user.id) return h('td', { class: 'sel-col keep' });
          const cb = h('input', { type: 'checkbox', 'aria-label': 'Select ' + u.fullName });
          cb.addEventListener('change', () => { if (cb.checked) sel.set(u.id, u); else sel.delete(u.id); sync(); });
          rowBoxes.push([cb, tr, u]);
          return h('td', { class: 'sel-col keep', onclick: (e) => e.stopPropagation() }, cb);
        };
        const withSel = (u, tr) => { const c = selCell(u, tr); if (c) tr.insertBefore(c, tr.firstChild); return tr; };
        UI.mount(host, r.rows.length ? h('div', { class: 'tbl-wrap' }, h('table', { class: 'tbl rt' },
          h('thead', null, h('tr', null, sel ? h('th', { class: 'sel-col' }, headBox) : null, h('th', null, 'User'), h('th', { class: 'hide-m' }, 'Role'), h('th', { class: 'hide-m' }, 'Branch'), h('th', { class: 'hide-m' }, 'Register'), h('th', { class: 'num hide-m' }, 'Balance'), h('th', null, 'Status'), h('th', { class: 'hide-m' }, 'Last sign-in'), app.isSuper ? h('th', null, '') : null)),
          h('tbody', null, r.rows.map((u) => withSel(u, h('tr', null,
            h('td', { class: 'keep full' }, h('div', { class: 'row', style: { gap: '10px', flexWrap: 'nowrap' } }, h('span', { class: 'avatar', style: { width: '34px', height: '34px', fontSize: '12px', flex: 'none' } }, RW.initials(u.fullName)), h('div', { style: { minWidth: 0 } }, h('b', null, u.fullName), h('span', { class: 'sub' }, u.username + (u.designation ? ' · ' + u.designation : ''))))),
            h('td', { class: 'hide-m' }, UI.roleName(u.role)), h('td', { class: 'hide-m' }, V.branchShort(u)),
            h('td', { class: 'hide-m nowrap' }, u.registerId ? h('a', { class: 'link', href: '#/register?user=' + u.id }, u.registerId) : h('span', { class: 'muted' }, '—')),
            h('td', { class: 'num hide-m' }, u.balancePaise === null ? '—' : RW.fmtINR(u.balancePaise)),
            h('td', { class: 'keep' }, UI.userStatusBadge(u.status), u.mustChangePassword ? h('span', { class: 'sub' }, 'Password change pending') : null),
            h('td', { class: 'hide-m' }, u.lastLoginAt ? RW.timeAgo(u.lastLoginAt) : h('span', { class: 'muted' }, 'Never')),
            app.isSuper ? h('td', { class: 'num keep' }, h('button', { class: 'btn btn-ghost btn-sm', type: 'button', onclick: (e) => menu(e.currentTarget, u) }, UI.icon('more', 16), 'Manage')) : null)))))) : UI.empty('No users found', 'Try a different search or filter.', 'users'));
        if (sel) { if (r.rows.length) sync(); else drawSelBar(); }
      } catch (e) { if (!dead) UI.mount(host, V.errorCard(e, load)); }
    }
    function drawSelBar() {
      if (!sel || !sel.size) { UI.mount(selBar); selBar.hidden = true; return; }
      selBar.hidden = false;
      UI.mount(selBar, UI.icon('trash', 16), h('span', null, h('b', null, sel.size), ' user' + (sel.size === 1 ? '' : 's') + ' selected'), h('span', { class: 'grow' }),
        h('button', { class: 'btn btn-ghost btn-sm', type: 'button', onclick: () => { sel.clear(); load(); } }, 'Clear selection'),
        h('button', { class: 'btn btn-danger btn-sm', type: 'button', onclick: bulkDelete }, UI.icon('trash', 14), 'Delete selected'));
    }
    function bulkDelete() {
      const users = Array.from(sel.values());
      if (!users.length) return;
      const r = reasonBox('Why are these users being deleted?');
      const erase = h('input', { type: 'checkbox' });
      const ack = h('input', { type: 'checkbox' });
      const ackRow = h('label', { class: 'opt-row', hidden: true }, ack, h('span', null, 'I understand this cannot be undone'));
      const warn = h('div', { class: 'callout bad', hidden: true }, UI.icon('alert', 16), h('span', null, 'Counting what would be erased…'));
      RW.api.call('erase.preview', { userIds: users.map((u) => u.id) }).then((c) => UI.mount(warn, UI.icon('alert', 16), h('span', null, h('b', null, c.vouchers + ' voucher' + (c.vouchers === 1 ? '' : 's')), ', ' + c.attachments + ' receipt photo' + (c.attachments === 1 ? '' : 's') + (c.tours || c.visits ? ', ' + c.tours + ' tour plan' + (c.tours === 1 ? '' : 's') + ' with ' + c.visits + ' meeting' + (c.visits === 1 ? '' : 's') : '') + ' and the cash registers of ' + users.length + ' user' + (users.length === 1 ? '' : 's') + ' will be erased for good and cannot be recovered. Only a short record stays in the audit log.')), () => UI.mount(warn, UI.icon('alert', 16), h('span', null, 'Everything these users created will be erased for good.')));
      erase.addEventListener('change', () => { warn.hidden = !erase.checked; ackRow.hidden = !erase.checked; });
      const names = users.slice(0, 5).map((u) => u.fullName).join(', ') + (users.length > 5 ? ' and ' + (users.length - 5) + ' more' : '');
      UI.modal({ title: 'Delete ' + users.length + ' user' + (users.length === 1 ? '' : 's'), size: 'sm', body: h('div', { class: 'stack', style: { gap: '12px' } },
        h('p', null, h('b', null, names), ' can no longer sign in. By default their vouchers, registers and audit history are kept for the records.'),
        h('label', { class: 'opt-row' }, erase, h('span', null, h('b', null, 'Also erase everything they created'), h('small', null, 'Vouchers, receipt photos and cash registers — permanently'))), warn, ackRow, r.f),
        actions: [{ label: 'Cancel' }, { label: 'Delete users', kind: 'danger', keepOpen: true, onClick: async (m) => {
          if (r.t.value.trim().length < 5) { UI.fieldError(r.f, 'Enter a reason (at least 5 characters)'); r.t.focus(); return false; }
          if (erase.checked && !ack.checked) { UI.toast('Tick the box to confirm', 'error'); return false; }
          const out = await RW.api.call('users.deleteMany', { ids: users.map((u) => u.id), erase: erase.checked, reason: r.t.value.trim() });
          sel.clear(); m.close();
          UI.toast(out.removed.users + ' user' + (out.removed.users === 1 ? '' : 's') + (erase.checked ? ' and ' + out.removed.vouchers + ' voucher' + (out.removed.vouchers === 1 ? '' : 's') + ' erased.' : ' deleted.'), 'success'); load();
        } }] });
    }

    function menu(anchor, u) {
      const items = [];
      if (u.canManage) items.push(['Edit details', 'edit', () => userDialog(u)], ['Reset password', 'key', () => resetPw(u)]);
      if (u.canManage && u.id !== app.user.id) {
        if (u.status !== 'ACTIVE') items.push(['Activate', 'check', () => setStatus(u, 'ACTIVE')]);
        if (u.status === 'ACTIVE') items.push(['Deactivate', 'ban', () => setStatus(u, 'INACTIVE')], ['Suspend', 'lock', () => setStatus(u, 'SUSPENDED')]);
      }
      if (u.registerId) items.push(['View register', 'wallet', () => (location.hash = '#/register?user=' + u.id)]);
      items.push(['Activity report', 'chart', () => (location.hash = '#/reports?tab=user&user=' + u.id)]);
      if (app.isSuper && u.id !== app.user.id) items.push(['Delete user', 'trash', () => delUser(u), true]);
      const m = h('div', { class: 'drop', style: { position: 'fixed', width: '210px', zIndex: 300 } }, items.map(([label, ic, fn, bad]) => h('button', { class: 'item', style: { width: '100%', border: 0, background: 'none', textAlign: 'left', color: bad ? 'var(--bad)' : undefined }, onclick: () => { m.remove(); fn(); } }, UI.icon(ic, 16), label)));
      document.body.appendChild(m);
      const r = anchor.getBoundingClientRect();
      m.style.top = Math.min(innerHeight - m.offsetHeight - 8, r.bottom + 6) + 'px'; m.style.left = Math.max(8, r.right - 210) + 'px';
      const close = (e) => { if (!m.contains(e.target)) { m.remove(); document.removeEventListener('mousedown', close, true); } };
      setTimeout(() => document.addEventListener('mousedown', close, true), 0);
    }

    function userDialog(u) {
      const isNew = !u;
      u = u || {};
      const name = h('input', { type: 'text', value: u.fullName || '', maxlength: 80, placeholder: 'e.g. Rahul Patel' });
      const uname = h('input', { type: 'text', value: u.username || '', maxlength: 32, placeholder: 'e.g. rahul.patel', disabled: !isNew, autocapitalize: 'none' });
      const email = h('input', { type: 'email', value: u.email || '', placeholder: 'name@company.com' });
      const mobile = h('input', { type: 'tel', value: u.mobile || '', placeholder: '10-digit mobile', maxlength: 14 });
      const desig = h('input', { type: 'text', value: u.designation || '', maxlength: 60, placeholder: 'e.g. Accountant' });
      const joined = h('input', { type: 'date', value: u.joiningDate || app.today, max: app.today });
      const roleOpts = app.isSuper ? [{ value: 'USER', label: 'Branch User' }, { value: 'BRANCH_ADMIN', label: 'Branch Admin' }, { value: 'VIEWER', label: 'Viewer (read-only)' }, { value: 'CEO', label: 'CEO (sees every branch, changes nothing)' }, { value: 'SUPER_ADMIN', label: 'Super Admin' }] : [{ value: 'USER', label: 'Branch User' }, { value: 'VIEWER', label: 'Viewer (read-only)' }];
      const roleSel = UI.select(roleOpts, u.role || 'USER', { disabled: !isNew && !app.isSuper || (!isNew && u.id === app.user.id) });
      const brSel = UI.select(branches.length ? branches : [{ value: app.user.branchId, label: app.branch.name }], u.branchId || (branches[0] && branches[0].value) || app.user.branchId, { disabled: !app.isSuper });
      const pw = h('input', { type: 'text', placeholder: 'Leave empty to generate one', autocomplete: 'off' });
      UI.modal({ title: isNew ? 'Add user' : 'Edit ' + u.fullName, size: 'md',
        body: h('div', { class: 'stack', style: { gap: '14px' } },
          h('div', { class: 'form-grid' }, UI.field('Full name', name), UI.field('Username', uname, { hint: isNew ? 'Used to sign in. Cannot be changed later.' : '' }), UI.field('Email', email), UI.field('Mobile', mobile, { optional: true }), UI.field('Designation', desig, { optional: true }), UI.field('Joining date', joined), UI.field('Role', roleSel), UI.field('Branch', brSel), isNew ? UI.field('Temporary password', pw, { optional: true, class: 'span2', hint: 'The user must change it at first sign-in.' }) : null),
          isNew ? h('div', { class: 'callout info' }, UI.icon('info', 16), h('span', null, 'A cash register is created automatically (viewers do not get one).')) : null),
        actions: [{ label: 'Cancel' }, { label: isNew ? 'Create user' : 'Save changes', kind: 'primary', keepOpen: true, onClick: async (m) => {
          if (isNew) {
            const r = await RW.api.call('users.create', { fullName: name.value, username: uname.value, email: email.value, mobile: mobile.value, designation: desig.value, joiningDate: joined.value, role: roleSel.value, branchId: brSel.value, password: pw.value || undefined });
            m.close(); load();
            credentialModal('User created', 'Share these sign-in details with ' + r.user.fullName + ' (branch: ' + r.user.branchName + ').', r.user.username, r.tempPassword || '(the password you entered)');
          } else {
            const patch = { id: u.id, fullName: name.value, email: email.value, mobile: mobile.value, designation: desig.value, joiningDate: joined.value };
            if (app.isSuper && roleSel.value !== u.role) patch.role = roleSel.value;
            if (app.isSuper && brSel.value !== u.branchId) patch.branchId = brSel.value;
            await RW.api.call('users.update', patch); UI.toast('User updated.', 'success'); m.close(); load();
          }
        } }] });
    }
    async function resetPw(u) {
      if (!(await UI.confirm({ title: 'Reset password for ' + u.fullName + '?', icon: 'key', ok: 'Reset password', message: 'A new temporary password is generated and the user is signed out everywhere. They must choose a new password at the next sign-in.' }))) return;
      try { const r = await RW.api.call('users.resetPassword', { id: u.id }); credentialModal('Password reset', 'Give this temporary password to ' + u.fullName + '.', u.username, r.tempPassword); load(); } catch (e) { UI.toast(UI.errMsg(e), 'error'); }
    }
    async function setStatus(u, st) {
      const verb = { ACTIVE: 'Activate', INACTIVE: 'Deactivate', SUSPENDED: 'Suspend' }[st];
      if (!(await UI.confirm({ title: verb + ' ' + u.fullName + '?', icon: st === 'ACTIVE' ? 'check' : 'ban', tone: st === 'ACTIVE' ? '' : 'danger', ok: verb, message: st === 'ACTIVE' ? 'They can sign in again.' : 'They are signed out immediately and cannot sign in. Their vouchers and history stay intact.' }))) return;
      try { await RW.api.call('users.setStatus', { id: u.id, status: st }); UI.toast(u.fullName + ' is now ' + st.toLowerCase() + '.', 'success'); load(); } catch (e) { UI.toast(UI.errMsg(e), 'error'); }
    }
    function delUser(u) {
      const r = reasonBox('Why is this user being deleted?');
      const erase = h('input', { type: 'checkbox' });
      const warn = h('div', { class: 'callout bad', hidden: true }, UI.icon('alert', 16), h('span', null, 'Counting what would be erased…'));
      RW.api.call('erase.preview', { userId: u.id }).then((c) => UI.mount(warn, UI.icon('alert', 16), h('span', null, h('b', null, c.vouchers + ' voucher' + (c.vouchers === 1 ? '' : 's')), ', ' + c.attachments + ' receipt photo' + (c.attachments === 1 ? '' : 's') + (c.tours || c.visits ? ', ' + c.tours + ' tour plan' + (c.tours === 1 ? '' : 's') + ' with ' + c.visits + ' meeting' + (c.visits === 1 ? '' : 's') : '') + ' and ' + (u.registerId || 'the cash register') + ' will be erased for good and cannot be recovered. Only a short record stays in the audit log.')), () => {});
      erase.addEventListener('change', () => { warn.hidden = !erase.checked; });
      UI.modal({ title: 'Delete ' + u.fullName, size: 'sm', body: h('div', { class: 'stack', style: { gap: '12px' } },
        h('p', null, 'The user can no longer sign in. By default their vouchers, register and audit history are kept for the records.'),
        h('label', { class: 'opt-row' }, erase, h('span', null, h('b', null, 'Also erase everything they created'), h('small', null, 'Vouchers, receipt photos and cash register — permanently'))), warn, r.f),
        actions: [{ label: 'Cancel' }, { label: 'Delete user', kind: 'danger', keepOpen: true, onClick: async (m) => {
          const gone = erase.checked;
          await RW.api.call(gone ? 'users.erase' : 'users.delete', { id: u.id, reason: r.t.value });
          UI.toast(gone ? 'User and all their data erased.' : 'User deleted.', 'success'); m.close(); load();
        } }] });
    }
    load(); app.live(load);
    return { dispose() { dead = true; } };
  }, { roles: ['SUPER_ADMIN', 'BRANCH_ADMIN', 'CEO', 'VIEWER'] });

  /* ============================================================= outstanding */
  RW.route('/outstanding', async function (root, p, app) {
    app.title('Outstanding');
    let dead = false, dir = '', st = 'OPEN', page = 1, branches = [];
    const sumHost = h('div', { class: 'grid g4' }), breakHost = h('div', { class: 'grid g2' }), tableHost = h('div', null, V.loading(5));
    const party = h('input', { type: 'search', placeholder: 'Search party or reference…' });
    const branchSel = UI.select([{ value: '', label: 'All branches' }], p.q.branch || '');
    const dirSeg = UI.segmented([{ value: '', label: 'All' }, { value: 'RECEIVABLE', label: 'To receive', tone: 'in' }, { value: 'PAYABLE', label: 'To pay', tone: 'out' }], dir, (v) => { dir = v; page = 1; load(); });
    const stSel = UI.select([{ value: 'OPEN', label: 'Open' }, { value: 'SETTLED', label: 'Settled' }, { value: 'CANCELLED', label: 'Cancelled' }, { value: 'ALL', label: 'All' }], st);
    root.appendChild(V.pageHead('Outstanding', 'Money to receive from customers and money to pay to suppliers, with due dates.', [app.isSuper ? h('button', { class: 'btn btn-accent', type: 'button', onclick: () => editDialog(null) }, UI.icon('plus', 16), 'Add Entry') : null]));
    root.appendChild(h('div', { class: 'stack' }, sumHost, breakHost,
      h('div', { class: 'bar-filters', style: { marginBottom: 0 } }, UI.field('Search', party, { class: 'wide' }), app.seesAll ? UI.field('Branch', branchSel) : null, UI.field('Show', dirSeg, { class: 'fit' }), UI.field('Status', stSel)),
      h('div', { class: 'card' }, h('div', { class: 'card-b flush' }, tableHost))));
    const rl = UI.debounce(() => { page = 1; load(); }, 240);
    party.addEventListener('input', rl); stSel.addEventListener('change', () => { st = stSel.value; page = 1; load(); }); branchSel.addEventListener('change', () => { page = 1; load(); });
    if (app.seesAll) V.branchOptions(app).then((bo) => { branches = bo.filter((o) => o.value); UI.mount(branchSel, bo.map((o) => h('option', { value: o.value }, o.label))); branchSel.value = p.q.branch || ''; });

    const scard = (title, icon, tone, c, sub) => h('div', { class: 'card kpi ' + tone }, h('div', { class: 'kpi-top' }, h('span', { class: 'kpi-ic' }, UI.icon(icon, 16)), title), h('div', { class: 'kpi-v' }, RW.fmtINR(c.totalPaise)),
      h('div', { class: 'kpi-s', style: { display: 'block', lineHeight: 1.7 } }, h('div', null, h('span', { class: 'amt-in' }, 'To receive ' + RW.fmtINR(c.receivablePaise))), h('div', null, h('span', { class: 'amt-out' }, 'To pay ' + RW.fmtINR(c.payablePaise))), h('small', null, c.count + ' open ' + (c.count === 1 ? 'entry' : 'entries') + (sub ? ' · ' + sub : ''))));

    async function load() {
      try {
        const r = await RW.api.call('outstanding.list', { filters: { q: party.value.trim(), direction: dir || undefined, status: st, branchId: branchSel.value || undefined }, page, pageSize: 20 });
        if (dead) return;
        const s = r.summary;
        UI.mount(sumHost, scard('Total outstanding', 'scale', 'accent', s.total), scard('Overdue', 'alert', 'out', s.overdue, 'past due date'), scard('Due this week', 'calendar', '', s.dueWeek), scard('Due this month', 'calendar', '', s.dueMonth));
        const mk = (title, sub, items, slotOf) => { const c = h('div'); const card = h('div', { class: 'card' }, h('div', { class: 'card-h' }, h('div', null, h('h3', null, title), h('small', null, sub))), h('div', { class: 'card-b' }, items.length ? c : h('p', { class: 'muted' }, 'Nothing outstanding.'))); if (items.length) setTimeout(() => CH().hbars(c, items.slice(0, 6).map((x, i) => ({ label: x.name, sub: x.count + ' entr' + (x.count === 1 ? 'y' : 'ies'), value: x.totalPaise, slot: slotOf ? slotOf(x, i) : (i % 3) + 1 }))), 0); return card; };
        UI.mount(breakHost, mk('Branch-wise outstanding', 'Open balance per branch', s.byBranch, (x) => V.slotFor(x.key)), mk('Party-wise outstanding', 'Largest open balances', s.byParty, () => 2));
        UI.mount(tableHost, r.rows.length ? [h('div', { class: 'tbl-wrap' }, h('table', { class: 'tbl rt' },
          h('thead', null, h('tr', null, h('th', null, 'Party'), h('th', { class: 'hide-m' }, 'Branch'), h('th', null, 'Due'), h('th', { class: 'num hide-m' }, 'Amount'), h('th', { class: 'num hide-m' }, 'Settled'), h('th', { class: 'num' }, 'Balance'), app.isSuper ? h('th', null, '') : null)),
          h('tbody', null, r.rows.map((o) => {
            const inn = o.direction === 'RECEIVABLE', open = o.status === 'OPEN';
            return h('tr', null,
              h('td', { class: 'keep full' }, h('b', null, o.partyName), h('span', { class: 'sub' }, (inn ? 'To receive' : 'To pay') + (o.reference ? ' · ' + o.reference : ''))),
              h('td', { class: 'hide-m' }, V.branchShort(o)),
              h('td', { class: 'keep nowrap' }, RW.fmtDate(o.dueDate), o.overdue ? h('span', { class: 'sub', style: { color: 'var(--bad)', fontWeight: 600 } }, o.daysOverdue + ' day' + (o.daysOverdue === 1 ? '' : 's') + ' overdue') : !open ? h('span', { class: 'sub' }, o.status.toLowerCase()) : null),
              h('td', { class: 'num hide-m' }, RW.fmtINR(o.amountPaise)), h('td', { class: 'num hide-m' }, RW.fmtINR(o.settledPaise)),
              h('td', { class: 'num keep' }, h('b', { class: inn ? 'amt-in' : 'amt-out' }, RW.fmtINR(o.balancePaise))),
              !app.isSuper ? null : h('td', { class: 'num keep nowrap acts-cell' }, open ? [h('button', { class: 'btn btn-primary btn-sm', type: 'button', onclick: () => settleDialog(o) }, inn ? 'Received' : 'Paid'), ' ', h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Edit', onclick: () => editDialog(o) }, UI.icon('edit', 16)), h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Cancel entry', title: 'Cancel (keeps it on record)', onclick: () => cancelDialog(o) }, UI.icon('ban', 16))] : null,
                h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Delete entry permanently', title: 'Delete permanently', style: { color: 'var(--bad)' }, onclick: () => deleteDialog(o) }, UI.icon('trash', 16))));
          })))), UI.pager(r, (n) => { page = n; load(); })] : UI.empty('No entries', st === 'OPEN' ? 'Nothing is outstanding. Add an entry when someone owes you, or you owe someone.' : 'No entries match this filter.', 'scale'));
      } catch (e) { if (!dead) UI.mount(tableHost, V.errorCard(e, load)); }
    }

    function editDialog(o) {
      const isNew = !o; o = o || {};
      const partyIn = h('input', { type: 'text', value: o.partyName || '', maxlength: 120, placeholder: 'Customer / supplier name' });
      const amt = h('input', { type: 'text', inputmode: 'decimal', value: o.amountPaise ? String(o.amountPaise / 100) : '', placeholder: '0.00' });
      const due = h('input', { type: 'date', value: o.dueDate || RW.addDays(app.today, 15) });
      const ref = h('input', { type: 'text', value: o.reference || '', maxlength: 80, placeholder: 'Invoice / bill number' });
      const notes = h('textarea', { rows: 2, maxlength: 500 }); notes.value = o.notes || '';
      const dsel = UI.segmented([{ value: 'RECEIVABLE', label: 'To receive', tone: 'in' }, { value: 'PAYABLE', label: 'To pay', tone: 'out' }], o.direction || 'RECEIVABLE', null, 'seg-lg');
      const brSel = UI.select(branches.length ? branches : [{ value: app.user.branchId, label: app.branch.name }], o.branchId || (branches[0] && branches[0].value) || app.user.branchId, { disabled: !app.isSuper || !isNew });
      UI.modal({ title: isNew ? 'Add outstanding entry' : 'Edit entry', size: 'md',
        body: h('div', { class: 'stack', style: { gap: '14px' } }, isNew ? dsel : null, h('div', { class: 'form-grid' }, UI.field('Party', partyIn), app.isSuper && isNew ? UI.field('Branch', brSel) : h('div'), UI.field('Amount (₹)', amt), UI.field('Due date', due), UI.field('Reference', ref, { optional: true }), UI.field('Notes', notes, { optional: true }))),
        actions: [{ label: 'Cancel' }, { label: isNew ? 'Add entry' : 'Save', kind: 'primary', keepOpen: true, onClick: async (m) => {
          if (!isMoney(amt.value)) { UI.toast('Enter a valid amount', 'error'); return false; }
          const body = { partyName: partyIn.value, amount: amt.value.replace(/,/g, ''), dueDate: due.value, reference: ref.value, notes: notes.value };
          if (isNew) await RW.api.call('outstanding.create', Object.assign(body, { direction: dsel.get(), branchId: brSel.value })); else await RW.api.call('outstanding.update', Object.assign(body, { id: o.id }));
          UI.toast(isNew ? 'Entry added.' : 'Entry updated.', 'success'); m.close(); load();
        } }] });
    }
    function settleDialog(o) {
      const inn = o.direction === 'RECEIVABLE';
      const amt = h('input', { type: 'text', inputmode: 'decimal', value: String(o.balancePaise / 100) });
      const vn = h('input', { type: 'text', placeholder: inn ? 'CRV-000123' : 'CPV-000123', autocapitalize: 'characters' });
      const note = h('input', { type: 'text', maxlength: 200, placeholder: 'e.g. part payment by cheque' });
      UI.modal({ title: (inn ? 'Record receipt' : 'Record payment') + ' · ' + o.partyName, size: 'sm',
        body: h('div', { class: 'stack', style: { gap: '12px' } }, h('p', { class: 'muted' }, 'Balance due: ', h('b', null, RW.fmtINR(o.balancePaise))), UI.field('Amount (₹)', amt), UI.field('Linked voucher', vn, { optional: true, hint: 'Link the ' + (inn ? 'cash receipt' : 'cash payment') + ' voucher number for the records.' }), UI.field('Note', note, { optional: true })),
        actions: [{ label: 'Cancel' }, { label: 'Save', kind: 'primary', keepOpen: true, onClick: async (m) => {
          if (!isMoney(amt.value)) { UI.toast('Enter a valid amount', 'error'); return false; }
          await RW.api.call('outstanding.settle', { id: o.id, amount: amt.value.replace(/,/g, ''), voucherNumber: vn.value || undefined, note: note.value || undefined });
          UI.toast('Saved.', 'success'); m.close(); load();
        } }] });
    }
    function deleteDialog(o) {
      const r = reasonBox('Why is this entry being deleted?');
      UI.modal({ title: 'Delete entry', size: 'sm', body: h('div', { class: 'stack', style: { gap: '12px' } }, h('p', null, 'Erase the entry for ', h('b', null, o.partyName), ' (' + RW.fmtINR(o.amountPaise) + ') for good? It cannot be recovered; only a short record stays in the audit log. Use the cancel button instead if it should stay on record.'), r.f),
        actions: [{ label: 'Keep it' }, { label: 'Delete permanently', kind: 'danger', keepOpen: true, onClick: async (m) => { await RW.api.call('outstanding.delete', { id: o.id, reason: r.t.value }); UI.toast('Entry deleted.', 'success'); m.close(); load(); } }] });
    }
    function cancelDialog(o) {
      const r = reasonBox('Why is this entry being cancelled?');
      UI.modal({ title: 'Cancel entry', size: 'sm', body: h('div', { class: 'stack', style: { gap: '12px' } }, h('p', null, 'Cancel the outstanding entry for ', h('b', null, o.partyName), '? It stays on record as cancelled.'), r.f),
        actions: [{ label: 'Keep it' }, { label: 'Cancel entry', kind: 'danger', keepOpen: true, onClick: async (m) => { await RW.api.call('outstanding.cancel', { id: o.id, reason: r.t.value }); UI.toast('Entry cancelled.', 'success'); m.close(); load(); } }] });
    }
    load(); app.live(load);
    return { dispose() { dead = true; } };
  }, { roles: ['SUPER_ADMIN', 'BRANCH_ADMIN', 'CEO'] });
})(typeof window !== 'undefined' ? window : globalThis);
