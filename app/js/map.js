/* Ravi Cash — MAP helper (a thin layer over Leaflet, which is shipped with the app in vendor/leaflet).
 *
 * The background (streets) comes from OpenStreetMap by default and needs internet. On a server it is fetched BY THE SERVER and
 * handed to the browser from the site's own address (server/tiles.js) — OpenStreetMap refuses browsers that do not send a Referer
 * (file://, privacy tools, some phones), and this way that no longer matters. If the server cannot get tiles, the browser tries the
 * provider directly; if that fails too, a clear panel with a "Try again" button is shown.
 * Staff positions and meeting pins are drawn by the app itself, so they stay correct even when the background cannot load.
 * All text on the map (names, addresses) is put in with textContent / DOM nodes, never as HTML.
 */
(function (g) {
  'use strict';
  const RW = (g.RW = g.RW || {});
  const UI = RW.ui, { h } = UI;
  const M = (RW.map = {});

  M.available = () => !!g.L;
  M.tileUrl = () => (g.RW_CONFIG && g.RW_CONFIG.tileUrl) || 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';   // direct address (also used when the server cannot supply tiles)
  const ATTR = '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a> contributors';

  /* Where tiles come from: { proxy: true, key } on a server, { proxy: false } in the browser demo. Asked once per two hours. */
  let cfgP = null, cfgAt = 0;
  M.config = function (force) {
    if (!force && cfgP && Date.now() - cfgAt < 2 * 3600000) return cfgP;
    cfgAt = Date.now();
    cfgP = Promise.resolve().then(() => RW.api.call('map.config', {})).then((c) => (c && c.proxy && c.key ? c : { proxy: false })).catch(() => ({ proxy: false }));
    return cfgP;
  };
  M.proxyUrl = (cfg) => String((g.RW_CONFIG && g.RW_CONFIG.apiUrl) || '/api').replace(/\/api\/?$/, '').replace(/\/+$/, '') + '/tiles/{z}/{x}/{y}.png?k=' + encodeURIComponent(cfg.key);
  const initials = (n) => String(n || '?').split(/\s+/).filter(Boolean).slice(0, 2).map((x) => x[0].toUpperCase()).join('');

  /* A map inside `host` (a sized element). Returns the Leaflet map. */
  M.create = function (host, o) {
    o = o || {};
    host.classList.add('rw-map');
    if (!M.available()) { UI.mount(host, h('div', { class: 'map-msg' }, UI.icon('map', 22), h('b', null, 'The map could not be loaded'), h('span', null, 'Reload the page. The list next to it still shows everything.'))); return null; }
    const L = g.L;
    const map = L.map(host, { zoomControl: true, attributionControl: true, worldCopyJump: false, zoomSnap: 0.5, tap: false })
      .setView(o.center || [22.9, 78.6], o.zoom || 5);
    /* The background. Order: the server's own tiles -> (key refreshed once) -> the provider directly -> a clear message. */
    const st = { src: '', layer: null, bad: 0, good: 0, retried: false };
    const fromFile = !!(g.location && g.location.protocol === 'file:');
    const msg = h('span', null, h('b', null, 'The map background could not be loaded. '), fromFile
      ? 'This app was opened as a file from the computer, and the map provider only serves websites. Open the online version for the live map. The positions below are still right.'
      : 'The positions of your staff are still right — open a person and use “Open in Google Maps” to see the place.');
    const note = h('div', { class: 'map-offline-note', hidden: true, role: 'alert' }, UI.icon('alert', 16), msg,
      h('button', { class: 'btn btn-ghost btn-sm', type: 'button', onclick: () => start(true) }, UI.icon('refresh', 14), 'Try again'));
    host.appendChild(note);
    const useLayer = (src, url) => {
      if (st.layer) { try { map.removeLayer(st.layer); } catch (e) { /* gone */ } }
      st.src = src; st.bad = 0; st.good = 0;
      const layer = L.tileLayer(url, { maxZoom: 19, referrerPolicy: 'strict-origin-when-cross-origin', attribution: ATTR });
      layer.on('tileerror', () => {
        if (layer !== st.layer) return;
        if (++st.bad < 3 || st.good) return;                       // a few missing tiles are normal; "nothing at all loaded" is not
        if (st.src === 'proxy') {
          if (!st.retried) { st.retried = true; M.config(true).then((c) => (layer === st.layer ? (c.proxy ? useLayer('proxy', M.proxyUrl(c)) : useLayer('direct', M.tileUrl())) : null)); }
          else useLayer('direct', M.tileUrl());                       // the server could not get tiles: ask the provider from this browser
        } else note.hidden = false;
      });
      // From the server a loaded tile is a real tile. From the provider directly it may be its "Access blocked" picture (the browser loads
      // that happily, whatever the status), so there the answer to one test request decides, see probe().
      layer.on('tileload', () => { if (layer === st.layer) { st.good++; if (src === 'proxy') note.hidden = true; } });
      layer.addTo(map); st.layer = layer;
      if (src === 'direct') probe(layer);
    };
    function probe(layer) {
      const u = M.tileUrl().replace('{s}', 'a').replace('{r}', '').replace('{z}', '4').replace('{x}', '11').replace('{y}', '7');
      if (typeof fetch !== 'function') return;
      fetch(u, { mode: 'cors', cache: 'no-store', referrerPolicy: 'strict-origin-when-cross-origin' })
        .then((r) => { if (layer === st.layer) note.hidden = r.ok; })
        .catch(() => { /* cannot tell (offline, or the provider does not allow reading): the tile errors above decide */ });
    }
    function start(again) {
      note.hidden = true; st.retried = false;
      return M.config(!!again).then((c) => { if (c.proxy) useLayer('proxy', M.proxyUrl(c)); else useLayer('direct', M.tileUrl()); });
    }
    start(false);
    // the key lives 4-8 hours: a map left open all day gets a new one
    const keyTimer = setInterval(() => { if (st.src === 'proxy' && st.layer) M.config(true).then((c) => { if (c.proxy && st.src === 'proxy' && st.layer) st.layer.setUrl(M.proxyUrl(c)); }); }, 2.5 * 3600000);
    map.on('unload', () => clearInterval(keyTimer));
    // the host may be laid out after the map is created (modals, tabs): fix the size once it is visible
    setTimeout(() => { try { map.invalidateSize(); } catch (e) { /* removed */ } }, 60);
    return map;
  };

  /* ------------------------------------------------------------------ markers */
  const STATUS = { LIVE: 'Live', RECENT: 'Recent', OFFLINE: 'Offline', OFF: 'Location off', NEVER: 'Not shared yet' };
  M.STATUS = STATUS;
  M.staffIcon = function (name, status, selected) {
    const el = h('div', { class: 'mk-staff mk-' + status + (selected ? ' sel' : '') }, h('span', null, initials(name)));
    return g.L.divIcon({ className: 'mk-wrap', html: el, iconSize: [40, 40], iconAnchor: [20, 20], popupAnchor: [0, -20] });
  };
  /* numbered pin for a meeting; kind: 'ok' (place known), 'plan' (a planned party that was met), 'late' (location older than 10 minutes) */
  M.meetIcon = function (n, kind) {
    const el = h('div', { class: 'mk-meet mk-' + (kind || 'ok') }, h('span', null, String(n)));
    return g.L.divIcon({ className: 'mk-wrap', html: el, iconSize: [30, 38], iconAnchor: [15, 36], popupAnchor: [0, -34] });
  };
  M.dot = function (cls) { return g.L.divIcon({ className: 'mk-wrap', html: h('div', { class: 'mk-dot ' + (cls || '') }), iconSize: [14, 14], iconAnchor: [7, 7] }); };

  /* fit the map to a list of [lat, lng] (a single point zooms in to street level) */
  M.fit = function (map, pts, opts) {
    if (!map || !pts.length) return;
    if (pts.length === 1) return map.setView(pts[0], (opts && opts.zoom) || 15);
    map.fitBounds(g.L.latLngBounds(pts), Object.assign({ padding: [40, 40], maxZoom: 16 }, opts || {}));
  };
  M.gmaps = (lat, lng) => 'https://www.google.com/maps?q=' + lat + ',' + lng;
  M.gdir = (lat, lng) => 'https://www.google.com/maps/dir/?api=1&destination=' + lat + ',' + lng;

  /* A small dialog with one place on a map (from a meeting card). */
  M.dialog = function (o) {
    const host = h('div', { class: 'map-dlg' });
    const body = h('div', { class: 'stack', style: { gap: '10px' } }, host,
      h('div', { class: 'map-dlg-f' }, h('span', { class: 'muted' }, (o.sub || '') + (o.acc ? ' · accuracy about ±' + o.acc + ' m' : '')),
        h('a', { class: 'link', href: M.gmaps(o.lat, o.lng), target: '_blank', rel: 'noopener' }, 'Open in Google Maps')));
    const m = UI.modal({ title: o.title || 'Location', size: 'lg', body, actions: [{ label: 'Close' }] });
    setTimeout(() => {
      const map = M.create(host, { center: [o.lat, o.lng], zoom: 16 });
      if (!map) return;
      const mk = g.L.marker([o.lat, o.lng], { icon: M.meetIcon(o.n || '•', o.kind || 'ok') }).addTo(map);
      if (o.acc && o.acc > 5) g.L.circle([o.lat, o.lng], { radius: o.acc, color: '#D9530A', weight: 1, fillOpacity: 0.1 }).addTo(map);
      void mk;
      map.setView([o.lat, o.lng], o.acc > 300 ? 14 : 16);
    }, 30);
    return m;
  };
})(typeof window !== 'undefined' ? window : globalThis);
