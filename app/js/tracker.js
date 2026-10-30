/* Ravi Cash — LIVE LOCATION on the phone.
 *
 * What it does: while a User / Branch Admin is signed in and the app is open it sends the phone's GPS position to the
 * server about once a minute (location.ping). The main admin and the CEO see it on the Live Map. It also gives a
 * meeting its place (RW.tracker.capture) when it is recorded.
 *
 * What it will NOT do (a web app cannot): track while the app is closed or the phone is locked. For that the app would have
 * to be a native Android app. The phone itself keeps showing "Location on" at the top while it is shared.
 *
 * Fairness: the person is told clearly what is shared and who sees it, and answers once (Allow / Not now); the browser
 * asks for its own permission as well. A "Not now" or a blocked permission is not hidden: the admin sees "location off".
 */
(function (g) {
  'use strict';
  const RW = (g.RW = g.RW || {});
  const UI = RW.ui, { h } = UI;
  const T = (RW.tracker = {});
  const TRACKED = ['USER', 'BRANCH_ADMIN'];
  const SEND_EVERY_MS = 60000;           // one position a minute
  const MOVED_M = 150;                   // ...or sooner after moving this far

  let app = null, cfg = null, chip = null, state = 'NONE', watchId = null, timer = null, last = null, lastSent = 0, lastSentPos = null, reportedPerm = false, gen = 0;
  let wake = null, retryTimer = null, pendingReport = null;
  const diag = { okAt: 0, errAt: 0, err: '', sent: 0 };            // what the phone itself knows, shown on the Profile page
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const lsGet = (k) => { try { return localStorage.getItem(k); } catch (e) { return null; } };
  const lsSet = (k, v) => { try { localStorage.setItem(k, v); } catch (e) { /* private mode */ } };

  const supported = () => typeof navigator !== 'undefined' && !!navigator.geolocation;
  const tracked = () => !!app && !!app.user && TRACKED.includes(app.user.role);
  function metres(a, b) {
    const R = 6371000, rad = Math.PI / 180, dLat = (b.lat - a.lat) * rad, dLng = (b.lng - a.lng) * rad;
    const x = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLng / 2) ** 2;
    return 2 * R * Math.asin(Math.min(1, Math.sqrt(x)));
  }
  const fixOf = (pos) => ({ lat: pos.coords.latitude, lng: pos.coords.longitude, acc: Math.round(pos.coords.accuracy || 0), at: pos.timestamp || Date.now() });
  const getFix = (o) => new Promise((res, rej) => navigator.geolocation.getCurrentPosition((p) => res(fixOf(p)), rej, { enableHighAccuracy: o.high !== false, timeout: o.timeout || 15000, maximumAge: o.maxAge || 0 }));
  async function permission() {
    try { if (navigator.permissions && navigator.permissions.query) return (await navigator.permissions.query({ name: 'geolocation' })).state; } catch (e) { /* not supported */ }
    return null;
  }
  // Tell the server a state (consent / permission). If the network blinks it is tried again, so the admin never sees a stale answer.
  const report = (st) => RW.api.call('location.report', { state: st }, { noAuthRedirect: true }).then(() => true, (e) => { if (!(e && (e.code === 'UNAUTHENTICATED' || e.code === 'FORBIDDEN'))) retryReport(st); return false; });
  function retryReport(st) {
    pendingReport = st;
    if (retryTimer) return;
    const my = gen;
    retryTimer = setTimeout(async () => {
      retryTimer = null;
      if (my !== gen || !pendingReport) return;
      const st2 = pendingReport; pendingReport = null;
      await report(st2);
    }, 15000);
  }

  /* ----------------------------------------------------------- the chip on top */
  const CHIP = {
    ON: ['on', 'Location on', 'Your location is shared with the main admin and the CEO while this app is open. Tap for details.'],
    LOCATING: ['on', 'Locating…', 'Finding your position…'],
    ASK: ['ask', 'Share location', 'Tap to read what is shared and allow it.'],
    OFF: ['off', 'Location off', 'You chose not to share your location. Tap to turn it on.'],
    BLOCKED: ['bad', 'Location blocked', 'Location is blocked in your phone / browser settings. Tap for help.'],
    NA: ['off', 'No GPS', 'This device cannot give its location.'],
    WAIT: ['ask', 'Connecting…', 'Could not reach the server yet. Trying again by itself.'],
  };
  T.chip = function () {
    chip = h('button', { class: 'loc-chip', type: 'button', id: 'loc-chip', hidden: true, onclick: () => T.openChip() });
    paint();
    return chip;
  };
  function paint() {
    if (!chip) return;
    const c = CHIP[state];
    chip.hidden = !c;
    if (!c) return;
    chip.className = 'loc-chip ' + c[0];
    chip.title = c[2]; chip.setAttribute('aria-label', c[1] + '. ' + c[2]);
    UI.mount(chip, UI.icon('pin', 14), h('span', null, c[1]));
  }
  function setState(s) { state = s; paint(); if (s !== 'ON') releaseWake(); else applyWake(); if (T.onStateChange) { try { T.onStateChange(s); } catch (e) { /* view gone */ } } }

  T.openChip = function () {
    if (state === 'ON' || state === 'LOCATING') return notice(true);
    if (state === 'BLOCKED') return blockedHelp();
    if (state === 'ASK' || state === 'OFF') return notice(false);
    if (state === 'WAIT') return UI.toast('Reaching the server… your location will start sharing as soon as it connects.', 'info');
  };

  /* ----------------------------------------------------------------- the notice */
  function notice(already, done) {
    const keep = (cfg && cfg.keepDays) || 30;
    const body = h('div', { class: 'stack', style: { gap: '12px' } },
      h('p', { style: { margin: 0 } }, already ? 'Your location is being shared with the company.' : 'Ravi Cash can share your phone\'s location with the company while you work.'),
      h('ul', { class: 'loc-list' },
        h('li', null, h('b', null, 'What is shared: '), 'your GPS position about once a minute while you are signed in and this app is open, and the place where you record each tour meeting.'),
        h('li', null, h('b', null, 'Who can see it: '), 'only the main admin and the CEO. Not your colleagues, not Branch Admins.'),
        h('li', null, h('b', null, 'How long: '), 'your daily route is kept for ' + keep + ' days, then erased.'),
        h('li', null, h('b', null, 'On your phone: '), 'a “Location on” sign stays at the top while it is shared. The app cannot track you when it is closed.')),
      already ? null : h('p', { class: 'muted', style: { margin: 0, fontSize: '12.5px' } }, 'Your phone will also ask for permission — please choose “Allow”.'));
    UI.modal({ title: already ? 'Location sharing' : 'Share your location?', size: 'sm', persistent: !already, body, onClose: () => { if (done) done(); },
      actions: already ? [{ label: 'Close' }, { label: 'Turn off', kind: 'danger', keepOpen: true, onClick: async (m) => { await T.decline(); m.close(); } }]
        : [{ label: 'Not now', onClick: async () => { await T.decline(); } }, { label: 'Allow location', kind: 'primary', keepOpen: true, onClick: async (m) => { m.close(); await T.allow(); } }] });
  }
  function blockedHelp() {
    UI.modal({ title: 'Location is blocked', size: 'sm', body: h('div', { class: 'stack', style: { gap: '10px' } },
      h('p', { style: { margin: 0 } }, 'This phone is not letting the app see your location, so the admin sees “location off” and your meetings are saved without a place.'),
      h('ol', { class: 'loc-list' },
        h('li', null, 'Open the browser / app settings of this phone.'),
        h('li', null, 'Go to Site settings (or App permissions) → Location.'),
        h('li', null, 'Allow location for this app, and make sure the phone\'s GPS (Location) switch is on.'),
        h('li', null, 'Come back here and tap “Try again”.'))),
      actions: [{ label: 'Close' }, { label: 'Try again', kind: 'primary', keepOpen: true, onClick: async (m) => { m.close(); await begin(); } }] });
  }

  T.allow = async function () {
    cfg = cfg || { enabled: true };
    cfg.consent = 'GIVEN';                         // the phone starts at once; the server is told (and told again if the first try fails)
    report('CONSENT_GIVEN');
    await begin();
  };
  T.decline = async function () {
    stopWatch();
    if (cfg) cfg.consent = 'DECLINED';
    setState('OFF');
    await report('CONSENT_DECLINED');
  };

  /* ------------------------------------------------------------------ lifecycle */
  T.start = async function (appRef) {
    T.stop();
    app = appRef;
    const my = ++gen;
    if (!tracked()) return setState('NONE');
    if (!supported()) return setState('NA');
    if (app.user.mustChangePassword) return setState('NONE');   // first sign-in: choose the new password first; the profile page starts the tracker right after
    cfg = await loadConfig(my);
    if (my !== gen || !cfg) return;
    if (!cfg.enabled) return setState('NONE');
    if (cfg.consent === 'GIVEN') return begin();
    if (cfg.consent === 'DECLINED') return setState('OFF');
    setState('ASK');
    notice(false);
  };
  // The first call after sign-in can fail on a weak phone network. Try again (3 s, 8 s, 20 s, then every 45 s) instead of staying silent for the whole day.
  async function loadConfig(my) {
    const waits = [3000, 8000, 20000, 45000];
    for (let i = 0; ; i++) {
      try { const c = await RW.api.call('location.config', {}, { noAuthRedirect: true }); if (my === gen && state === 'WAIT') setState('NONE'); return c; }
      catch (e) {
        if (my !== gen) return null;
        if (e && (e.code === 'UNAUTHENTICATED' || e.code === 'FORBIDDEN' || e.code === 'ACCOUNT_DISABLED')) return null;
        diag.err = (e && e.message) || 'Could not reach the server'; diag.errAt = Date.now();
        if (state !== 'WAIT') setState('WAIT');
        await sleep(waits[Math.min(i, waits.length - 1)]);
        if (my !== gen) return null;
      }
    }
  }
  T.stop = function () { gen++; stopWatch(); releaseWake(); if (retryTimer) { clearTimeout(retryTimer); retryTimer = null; } pendingReport = null; cfg = null; last = null; lastSent = 0; lastSentPos = null; reportedPerm = false; app = null; setState('NONE'); };

  function stopWatch() {
    if (watchId !== null && supported()) { try { navigator.geolocation.clearWatch(watchId); } catch (e) { /* ignore */ } }
    watchId = null;
    if (timer) clearInterval(timer);
    timer = null;
    document.removeEventListener('visibilitychange', onVisible);
    window.removeEventListener('pagehide', onHide);
    window.removeEventListener('online', onOnline);
  }

  async function begin() {
    stopWatch();
    const my = gen;
    if ((await permission()) === 'denied') { report('DENIED'); return setState('BLOCKED'); }
    setState('LOCATING');
    try {
      const fix = await getFix({ high: true, timeout: 20000 });
      if (my !== gen) return;
      onFix(fix, true);
    } catch (e) {
      if (my !== gen) return;
      if (e && e.code === 1) { report('DENIED'); return setState('BLOCKED'); }
      // no fix yet (indoors, GPS warming up): keep trying quietly
    }
    if (my !== gen) return;
    watchId = navigator.geolocation.watchPosition((p) => onFix(fixOf(p), false), onError, { enableHighAccuracy: true, maximumAge: 15000, timeout: 30000 });
    timer = setInterval(tick, 30000);
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('pagehide', onHide);
    window.addEventListener('online', onOnline);
    applyWake();
  }

  function onError(e) {
    if (e && e.code === 1) { stopWatch(); report('DENIED'); setState('BLOCKED'); }
    // position unavailable / timeout: try again by itself
  }
  function onFix(fix, force) {
    last = fix;
    if (state !== 'ON') setState('ON');
    if (!reportedPerm) { reportedPerm = true; report('GRANTED'); }
    const now = Date.now();
    if (force || now - lastSent >= SEND_EVERY_MS || (lastSentPos && now - lastSent >= 20000 && metres(lastSentPos, fix) >= MOVED_M)) send(fix).catch(() => { /* offline: the next position will do */ });
  }
  function send(fix) {
    lastSent = Date.now(); lastSentPos = fix;
    return RW.api.call('location.ping', { lat: fix.lat, lng: fix.lng, acc: fix.acc, at: fix.at, consent: cfg && cfg.consent === 'GIVEN' ? 1 : 0 }, { noAuthRedirect: true })
      .then((r) => { diag.okAt = Date.now(); diag.sent++; if (r && r.off) diag.err = 'The server says location sharing is off for you'; else diag.err = ''; return r; },
        (e) => { diag.errAt = Date.now(); diag.err = (e && e.message) || 'Could not reach the server'; lastSent = 0; /* try again at the next position */ throw e; });
  }
  // a phone that stands still may not report anything: ask for a fresh position every minute
  function tick() {
    if (document.visibilityState !== 'visible' || Date.now() - lastSent < SEND_EVERY_MS - 2000) return;
    getFix({ high: false, timeout: 15000, maxAge: 30000 }).then((f) => onFix(f, true)).catch(onError);
  }
  function onVisible() {
    if (document.visibilityState === 'visible') { getFix({ high: true, timeout: 15000, maxAge: 0 }).then((f) => onFix(f, true)).catch(onError); applyWake(); }
    else onHide();
  }
  // The person leaves the app (another app, lock screen): send the last known place now, so the admin sees where they were when it went quiet.
  function onHide() { if (last && Date.now() - last.at < 120000) send(last).catch(() => {}); }
  function onOnline() { if (last) send(last).catch(() => {}); if (pendingReport) { const st = pendingReport; pendingReport = null; report(st); } }

  /* ---------- optional: keep the screen on while the app is open, so the phone keeps giving positions (uses more battery) */
  const canWake = () => typeof navigator !== 'undefined' && 'wakeLock' in navigator;
  T.canKeepAwake = canWake;
  T.isKeepAwake = () => lsGet('rw.loc.awake') === '1';
  T.setKeepAwake = (on) => { lsSet('rw.loc.awake', on ? '1' : '0'); applyWake(); };
  async function applyWake() {
    const want = canWake() && lsGet('rw.loc.awake') === '1' && state === 'ON' && document.visibilityState === 'visible';
    if (want && !wake) {
      try { wake = await navigator.wakeLock.request('screen'); wake.addEventListener('release', () => { wake = null; }); } catch (e) { wake = null; }
    } else if (!want && wake) releaseWake();
  }
  function releaseWake() { const w = wake; wake = null; if (w) { try { w.release(); } catch (e) { /* gone */ } } }

  /* ---------- the Profile page: what this phone knows, and a button that proves it works */
  T.diag = async function () {
    const perm = supported() ? await permission() : null;
    return { state, tracked: tracked(), supported: supported(), perm, consent: cfg ? cfg.consent : null, enabled: cfg ? cfg.enabled : null, lastFixAt: last ? last.at : 0, acc: last ? last.acc : null,
      okAt: diag.okAt, errAt: diag.errAt, err: diag.err, sent: diag.sent, awake: lsGet('rw.loc.awake') === '1', canKeepAwake: canWake() };
  };
  T.sendNow = async function () {
    if (!tracked()) throw new Error('Location is shared by users and branch admins only.');
    if (!supported()) throw new Error('This phone cannot give its location.');
    let fix;
    try { fix = await getFix({ high: true, timeout: 10000 }); }
    catch (e) {
      if (e && e.code === 1) { report('DENIED'); setState('BLOCKED'); throw new Error('Location is blocked on this phone. Allow it in the phone settings, then try again.'); }
      if (last && Date.now() - last.at < 180000) fix = last;           // no fresh reading right now (indoors): the position from a moment ago is still true
      else throw new Error('The phone could not find your position yet. Go near a window or outside and try again.');
    }
    last = fix;
    if (state !== 'ON') setState('ON');
    await send(fix);
    return fix;
  };
  T.onStateChange = null;

  /* ---------------------------------------------- a meeting gets the place it was recorded from */
  T.canCapture = function () {
    if (!supported()) return false;
    if (!app || !app.user) return false;
    if (TRACKED.includes(app.user.role)) return !!cfg && cfg.enabled && cfg.consent === 'GIVEN' && state !== 'BLOCKED';
    return true;
  };
  T.why = function () {          // why a meeting has no place right now
    if (!supported()) return 'UNAVAILABLE';
    if (state === 'BLOCKED') return 'DENIED';
    return 'OFF';
  };
  T.capture = async function () {
    if (!T.canCapture()) return { geoStatus: T.why() };
    if (last && Date.now() - last.at < 90000 && last.acc <= 150) return { geo: last };
    try { const f = await getFix({ high: true, timeout: 12000, maxAge: 0 }); last = f; return { geo: f }; } catch (e) { return { geoStatus: e && e.code === 1 ? 'DENIED' : 'UNAVAILABLE' }; }
  };
  /* "Turn on" from a meeting form: show the notice first when the person has not agreed yet, then wait for the answer */
  T.enable = function () {
    return new Promise((resolve) => {
      if (state === 'BLOCKED') { blockedHelp(); return resolve(); }
      if (tracked() && (!cfg || cfg.consent !== 'GIVEN')) return notice(false, resolve);
      begin().then(resolve, resolve);
    });
  };
  T.state = () => state;
})(typeof window !== 'undefined' ? window : globalThis);
