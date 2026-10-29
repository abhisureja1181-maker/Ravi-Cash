/* Ravi Cash — login / entry experience. */
(function (g) {
  'use strict';
  const RW = (g.RW = g.RW || {});
  const UI = RW.ui, V = RW.v;
  const { h, svg } = UI;

  // The company logo is a picture (supplied by the owner) on a white background, so inside the app it always sits on a white tile.
  V.logoImg = (k, height) => h('img', { class: 'logo-img', src: RW.logoSrc(k), alt: 'Ravi water flow PUMP', height: height, style: { height: height + 'px' }, draggable: 'false' });
  V.logoTile = (k, height) => h('span', { class: 'logo-tile' }, V.logoImg(k, height));

  const DEMO = [
    { label: 'Super Admin', branch: 'MAIN', user: 'admin', pw: 'Admin@1234' },
    { label: 'Main Accountant', branch: 'MAIN', user: 'main.accountant', pw: 'Ravi@1234' },
    { label: 'Indore Accountant', branch: 'INDORE', user: 'indore.accountant', pw: 'Ravi@1234' },
    { label: 'Nagpur Accountant', branch: 'NAGPUR', user: 'nagpur.accountant', pw: 'Ravi@1234' },
    { label: 'Indore Manager', branch: 'INDORE', user: 'indore.manager', pw: 'Ravi@1234' },
    { label: 'CEO (view only)', branch: 'MAIN', user: 'ceo', pw: 'Ravi@1234' },
    { label: 'Nagpur Auditor (view only)', branch: 'NAGPUR', user: 'nagpur.auditor', pw: 'Ravi@1234' },
  ];

  V.login = async function (root, app, notice) {
    let info = { branches: [], company: {} }, unreachable = false;
    try { info = await RW.api.call('branches.public', {}, { token: null, fast: true }); } catch (e) { unreachable = true; /* the form is still shown, with a clear message below */ }
    const played = RW.LS.get('rw.intro') === '1' || (function () { try { return sessionStorage.getItem('rw.intro') === '1'; } catch (e) { return false; } })();
    try { sessionStorage.setItem('rw.intro', '1'); } catch (e) { /* ignore */ }

    /* ------- hero */
    const rnd = RW.prng(7);
    const kIn = h('b', null, '₹0'), kOut = h('b', null, '₹0'), kNet = h('b', null, '₹0');
    const bars = h('div', { class: 'pv-chart' }, Array.from({ length: 12 }, (_, i) => h('div', { style: { '--i': i } }, h('i', { style: { height: 30 + rnd() * 70 + '%' } }), h('i', { style: { height: 18 + rnd() * 55 + '%' } }))));
    const hero = h('section', { class: 'hero' },
      h('div', { class: 'hero-layer hero-glow' }), h('div', { class: 'hero-layer hero-grid' }), h('div', { class: 'hero-layer' }, h('i', { class: 'orb a' }), h('i', { class: 'orb b' })),
      h('div', { class: 'hero-brand' }, V.logoTile('full', 112)),
      h('div', { class: 'hero-kicker' }, 'Ravi Water Flow Pump  ·  Cash Management System'),
      h('h1', null, h('span', { class: 'ln' }, h('span', null, 'CASH MANAGEMENT')), h('span', { class: 'ln' }, h('span', null, 'MADE SIMPLE'))),
      h('p', { class: 'hero-sub' }, 'Secure', h('i', null, '•'), 'Real-Time', h('i', null, '•'), 'Multi-Branch Cash Management'),
      h('div', { class: 'preview-wrap' },
        h('div', { class: 'preview', 'aria-hidden': 'true' },
          h('div', { class: 'pv-bar' }, h('i'), h('i'), h('i'), h('span', { style: { marginLeft: '8px' } }, 'ADMIN DASHBOARD'), h('span', { class: 'live' }, h('i'), 'LIVE')),
          h('div', { class: 'pv-kpis' }, h('div', { class: 'pv-k in' }, h('small', null, 'CASH IN'), kIn), h('div', { class: 'pv-k out' }, h('small', null, 'CASH OUT'), kOut), h('div', { class: 'pv-k' }, h('small', null, 'NET CASH'), kNet)), bars),
        h('div', { class: 'pv-toast', 'aria-hidden': 'true' }, h('span', { class: 'ic' }, UI.icon('bell', 14)), h('div', null, h('b', null, 'New voucher created'), h('small', null, 'CPV-000245 · ₹25,000 · Indore')))),
      h('div', { class: 'branches' }, (RW.api.kind === 'demo' ? ['MAIN', 'INDORE', 'NAGPUR'] : info.branches.map((b) => b.code).slice(0, 4)).map((c, i) => [c, ['#4a8ae0', '#F08A3C', '#2fb5a6', '#c88ae0'][i % 4]]).map((b, i) => h('span', { style: { '--i': i, '--c': b[1] } }, h('i'), b[0]))));
    hero.addEventListener('mousemove', (e) => { const r = hero.getBoundingClientRect(); hero.style.setProperty('--px', ((e.clientX - r.left) / r.width - 0.5) * 2); hero.style.setProperty('--py', ((e.clientY - r.top) / r.height - 0.5) * 2); });
    setTimeout(() => { UI.animateValue(kIn, 1255000 * 100, (v) => RW.fmtINR(Math.round(v / 100) * 100), { duration: 1800 }); UI.animateValue(kOut, 842500 * 100, (v) => RW.fmtINR(Math.round(v / 100) * 100), { duration: 1800 }); UI.animateValue(kNet, 412500 * 100, (v) => RW.fmtINR(Math.round(v / 100) * 100), { duration: 1800 }); }, played ? 100 : 2300);

    /* ------- first-time setup (real server only, while nothing exists yet) */
    if (info.empty && RW.api.kind !== 'demo') {
      const inp = (o) => h('input', Object.assign({ type: 'text', autocomplete: 'off' }, o));
      const company = inp({ value: 'Ravi Water Flow Pump', maxlength: 100 }), branch = inp({ placeholder: 'e.g. Ravi Water Flow Pump - Rajkot', maxlength: 100 }), code = inp({ placeholder: 'Auto', maxlength: 10, style: { textTransform: 'uppercase' } });
      const full = inp({ placeholder: 'Your full name', maxlength: 80, autocomplete: 'name' }), email = inp({ type: 'email', placeholder: 'you@company.com', autocomplete: 'email' });
      const user = inp({ placeholder: 'e.g. admin', maxlength: 32, autocapitalize: 'none', autocomplete: 'username' });
      const pw = inp({ type: 'password', placeholder: 'At least 8 characters, letters and numbers', autocomplete: 'new-password' }), pw2 = inp({ type: 'password', placeholder: 'Repeat password', autocomplete: 'new-password' });
      const skey = inp({ placeholder: 'Paste the SETUP_KEY from your hosting settings', autocomplete: 'off', autocapitalize: 'none', spellcheck: 'false' });
      const err = h('div', { class: 'err', role: 'alert', hidden: true });
      const go = h('button', { class: 'btn btn-primary btn-lg btn-block', type: 'submit' }, 'Create system', UI.icon('right', 18));
      const form = h('form', { novalidate: true, onsubmit: async (e) => {
        e.preventDefault(); err.hidden = true;
        const fail = (m) => { UI.mount(err, UI.icon('alert', 16), h('span', null, m)); err.hidden = false; };
        if (pw.value !== pw2.value) return fail('The two passwords do not match');
        go.disabled = true; go.classList.add('busy');
        try {
          const r = await RW.api.call('system.setup', { companyName: company.value, branchName: branch.value, branchCode: code.value || undefined, fullName: full.value, email: email.value, username: user.value, password: pw.value, setupKey: skey.value }, { token: null });
          RW.api.session.save(r.token, false);
          RW.LS.set('rw.lastBranch', r.branch.code);
          await app.start();
          UI.toast('Your system is ready. Add your branches and users next.', 'success', { title: 'Welcome', ms: 6000 });
        } catch (x) { fail(UI.errMsg(x)); } finally { go.disabled = false; go.classList.remove('busy'); }
      } },
        UI.field('Business name', company), UI.field('First branch name', branch), UI.field('Branch code', code, { optional: true, hint: 'Short code used in register ids, e.g. RAJKOT. Cannot be changed later.' }),
        info.setupKeyRequired ? UI.field('Setup key', skey, { hint: 'Your hosting service created it for you (setting name SETUP_KEY). It stops strangers from setting up your system first.' }) : null,
        UI.field('Your full name (Super Admin)', full), UI.field('Email', email), UI.field('Username', user), UI.field('Password', pw), UI.field('Confirm password', pw2), err, go);
      const panel = h('section', { class: 'panel' }, h('div', { class: 'panel-in' }, h('div', { class: 'p-mark' }, V.logoImg('mark', 40)),
        h('h2', null, 'Set up your system'), h('p', { class: 'lead' }, 'This is the first start. Create your first branch and the Super Admin account. You can add more branches and users afterwards.'),
        form, h('div', { class: 'secure-note' }, UI.icon('shield', 16), 'This screen disappears for good as soon as the Super Admin exists.')));
      UI.mount(root, h('div', { class: 'login quick' }, hero, panel));
      document.title = 'Set up · Ravi Cash';
      return;
    }

    /* ------- form */
    const branchSel = h('select', { id: 'lg-branch', required: true, autocomplete: 'organization' }, h('option', { value: '' }, unreachable ? 'Server not reachable' : 'Select your branch'), info.branches.map((b) => h('option', { value: b.code }, b.name)));
    const last = RW.LS.get('rw.lastBranch');
    if (last && info.branches.some((b) => b.code === last)) branchSel.value = last;
    const userIn = h('input', { id: 'lg-user', type: 'text', autocomplete: 'username', placeholder: 'Username or email', required: true, autocapitalize: 'none', spellcheck: 'false' });
    const pwIn = h('input', { id: 'lg-pw', type: 'password', autocomplete: 'current-password', placeholder: 'Password', required: true });
    const eye = h('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Show password', onclick: () => { const on = pwIn.type === 'password'; pwIn.type = on ? 'text' : 'password'; UI.clear(eye); eye.appendChild(UI.icon(on ? 'eyeoff' : 'eye', 18)); eye.setAttribute('aria-label', on ? 'Hide password' : 'Show password'); } }, UI.icon('eye', 18));
    const remember = h('input', { type: 'checkbox', id: 'lg-rem' });
    const errBox = h('div', { class: 'err', role: 'alert', hidden: true });
    // The installed app can open from the browser cache even when the server is off, which used to look like a login form
    // with an empty branch list. Say what is wrong, and reconnect by itself as soon as the server answers.
    const retry = () => V.login(root, app, notice);
    const netBox = unreachable
      ? h('div', { class: 'callout bad', role: 'alert', style: { marginBottom: '14px' } }, UI.icon('wifioff', 16), h('span', null, h('b', null, 'Cannot reach the server. '),
        'Check the internet connection. If Ravi Cash runs on this computer, start START.bat and keep its black window open. Trying again every few seconds… ', h('button', { type: 'button', class: 'link', onclick: retry }, 'Try now')))
      : (!info.empty && !info.branches.length
        ? h('div', { class: 'callout warn', style: { marginBottom: '14px' } }, UI.icon('alert', 16), h('span', null, h('b', null, 'No active branch found. '), 'Ask your administrator to check Branches.'))
        : null);
    if (unreachable) {
      const timer = setInterval(async () => {
        if (!document.body.contains(netBox)) return clearInterval(timer);   // the screen changed
        try { await RW.api.call('branches.public', {}, { token: null, fast: true }); clearInterval(timer); retry(); } catch (e) { /* still down */ }
      }, 4000);
    }
    const submit = h('button', { class: 'btn btn-primary btn-lg btn-block', type: 'submit' }, 'Sign in', UI.icon('right', 18));
    const showErr = (m) => { UI.mount(errBox, UI.icon('alert', 16), h('span', null, m)); errBox.hidden = false; errBox.style.animation = 'none'; errBox.offsetHeight; errBox.style.animation = ''; };
    if (notice) showErr(notice);
    const form = h('form', { novalidate: true, onsubmit: async (e) => {
      e.preventDefault(); errBox.hidden = true;
      if (!branchSel.value) return showErr('Please select your branch');
      if (!userIn.value.trim() || !pwIn.value) return showErr('Enter your username and password');
      submit.disabled = true; submit.classList.add('busy');
      try {
        const r = await RW.api.call('auth.login', { branchCode: branchSel.value, identifier: userIn.value.trim(), password: pwIn.value, remember: remember.checked }, { token: null });
        RW.api.session.save(r.token, remember.checked);
        RW.LS.set('rw.lastBranch', branchSel.value);
        await app.start();
      } catch (err) { showErr(UI.errMsg(err)); pwIn.select(); } finally { submit.disabled = false; submit.classList.remove('busy'); }
    } },
      netBox,
      UI.field('Branch', branchSel),
      UI.field('Username / Email', h('div', { class: 'input-ico' }, UI.icon('user', 17), userIn)),
      UI.field('Password', h('div', { class: 'input-ico' }, UI.icon('lock', 17), pwIn, eye)),
      h('div', { class: 'opts' }, h('label', null, remember, 'Remember me'), h('button', { type: 'button', class: 'link', onclick: forgot }, 'Forgot password?')),
      errBox, submit);
    function forgot() {
      UI.modal({ title: 'Forgot your password?', size: 'sm', body: h('div', { class: 'stack', style: { gap: '12px' } },
        h('p', { style: { color: 'var(--ink-2)', lineHeight: 1.6 } }, 'To keep cash records secure, passwords cannot be reset by yourself. Your administrator resets it for you:'),
        h('ol', { style: { margin: 0, paddingLeft: '18px', color: 'var(--ink-2)', lineHeight: 1.8 } }, h('li', null, 'Contact your branch administrator or the Super Admin.'), h('li', null, 'They open Users → Reset Password and give you a temporary password.'), h('li', null, 'Sign in and choose a new password when asked.'))),
      actions: [{ label: 'Got it', kind: 'primary' }] });
    }

    const demoBox = RW.api.kind === 'demo' ? h('div', { class: 'demo-box' }, h('h5', null, UI.icon('info', 13), 'Demo mode'),
      h('p', null, 'This is a DEMO. It runs entirely in this browser with sample data that stays on this device — it is not your real system and does not sync with your PC or other phones. Tap an account to try it:'),
      h('div', { class: 'demo-chips' }, DEMO.map((d) => h('button', { type: 'button', class: 'demo-chip', onclick: () => { branchSel.value = d.branch; userIn.value = d.user; pwIn.value = d.pw; pwIn.focus(); } }, d.label)))) : null;

    const themeBtn = h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Toggle dark mode', onclick: () => app.toggleTheme() }, UI.icon(app.theme === 'dark' ? 'sun' : 'moon', 18));
    const panel = h('section', { class: 'panel' }, h('div', { class: 'panel-in' },
      h('div', { class: 'p-mark' }, V.logoImg('mark', 40)),
      h('h2', null, 'Welcome back'), h('p', { class: 'lead' }, 'Sign in to Ravi Water Flow Pump cash management. Accounts are created by your administrator.'),
      form, h('div', { class: 'secure-note' }, UI.icon('shield', 16), 'Encrypted connection · every action is recorded in the audit log'), demoBox,
      h('div', { class: 'panel-foot' }, h('span', null, '© Ravi Water Flow Pump'), themeBtn)));
    UI.mount(root, h('div', { class: 'login' + (played ? ' quick' : '') }, hero, panel));
    document.title = 'Sign in · Ravi Cash';
  };
})(typeof window !== 'undefined' ? window : globalThis);
