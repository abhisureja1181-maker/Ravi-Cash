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
  const report = (st) => RW.api.call('location.report', { state: st }, { noAuthRedirect: true }).catch(() => {});

  /* ----------------------------------------------------------- the chip on top */
  const CHIP = {
    ON: ['on', 'Location on', 'Your location is shared with the main admin and the CEO while this app is open. Tap for details.'],
    LOCATING: ['on', 'Locating…', 'Finding your position…'],
    ASK: ['ask', 'Share location', 'Tap to read what is shared and allow it.'],
    OFF: ['off', 'Location off', 'You chose not to share your location. Tap to turn it on.'],
    BLOCKED: ['bad', 'Location blocked', 'Location is blocked in your phone / browser settings. Tap for help.'],
    NA: ['off', 'No GPS', 'This device cannot give its location.'],
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
  function setState(s) { state = s; paint(); }

  T.openChip = function () {
    if (state === 'ON' || state === 'LOCATING') return notice(true);
    if (state === 'BLOCKED') return blockedHelp();
    if (state === 'ASK' || state === 'OFF') return notice(false);
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
    await RW.api.call('location.report', { state: 'CONSENT_GIVEN' }, { noAuthRedirect: true }).catch(() => {});
    cfg.consent = 'GIVEN';
    await begin();
  };
  T.decline = async function () {
    stopWatch();
    await RW.api.call('location.report', { state: 'CONSENT_DECLINED' }, { noAuthRedirect: true }).catch(() => {});
    if (cfg) cfg.consent = 'DECLINED';
    setState('OFF');
  };

  /* ------------------------------------------------------------------ lifecycle */
  T.start = async function (appRef) {
    T.stop();
    app = appRef;
    const my = ++gen;
    if (!tracked()) return setState('NONE');
    if (!supported()) return setState('NA');
    try { cfg = await RW.api.call('location.config', {}, { noAuthRedirect: true }); } catch (e) { return; }
    if (my !== gen) return;
    if (!cfg.enabled) return setState('NONE');
    if (cfg.consent === 'GIVEN') return begin();
    if (cfg.consent === 'DECLINED') return setState('OFF');
    setState('ASK');
    notice(false);
  };
  T.stop = function () { gen++; stopWatch(); cfg = null; last = null; lastSent = 0; lastSentPos = null; reportedPerm = false; app = null; setState('NONE'); };

  function stopWatch() {
    if (watchId !== null && supported()) { try { navigator.geolocation.clearWatch(watchId); } catch (e) { /* ignore */ } }
    watchId = null;
    if (timer) clearInterval(timer);
    timer = null;
    document.removeEventListener('visibilitychange', onVisible);
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
    if (force || now - lastSent >= SEND_EVERY_MS || (lastSentPos && now - lastSent >= 20000 && metres(lastSentPos, fix) >= MOVED_M)) send(fix);
  }
  function send(fix) {
    lastSent = Date.now(); lastSentPos = fix;
    RW.api.call('location.ping', { lat: fix.lat, lng: fix.lng, acc: fix.acc, at: fix.at }, { noAuthRedirect: true }).catch(() => { /* offline: the next one will do */ });
  }
  // a phone that stands still may not report anything: ask for a fresh position every minute
  function tick() {
    if (document.visibilityState !== 'visible' || Date.now() - lastSent < SEND_EVERY_MS - 2000) return;
    getFix({ high: false, timeout: 15000, maxAge: 30000 }).then((f) => onFix(f, true)).catch(onError);
  }
  function onVisible() {
    if (document.visibilityState === 'visible') getFix({ high: true, timeout: 15000, maxAge: 0 }).then((f) => onFix(f, true)).catch(onError);
  }

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
