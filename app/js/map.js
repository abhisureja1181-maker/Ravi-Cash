/* Ravi Cash — MAP helper (a thin layer over Leaflet, which is shipped with the app in vendor/leaflet).
 *
 * The background (streets) comes from OpenStreetMap by default and needs internet; staff positions and meeting pins are
 * drawn by the app itself, so they stay correct even when the background cannot load (a notice is shown then).
 * All text on the map (names, addresses) is put in with textContent / DOM nodes, never as HTML.
 */
(function (g) {
  'use strict';
  const RW = (g.RW = g.RW || {});
  const UI = RW.ui, { h } = UI;
  const M = (RW.map = {});

  M.available = () => !!g.L;
  M.tileUrl = () => (g.RW_CONFIG && g.RW_CONFIG.tileUrl) || 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
  const initials = (n) => String(n || '?').split(/\s+/).filter(Boolean).slice(0, 2).map((x) => x[0].toUpperCase()).join('');

  /* A map inside `host` (a sized element). Returns the Leaflet map. */
  M.create = function (host, o) {
    o = o || {};
    host.classList.add('rw-map');
    if (!M.available()) { UI.mount(host, h('div', { class: 'map-msg' }, UI.icon('map', 22), h('b', null, 'The map could not be loaded'), h('span', null, 'Reload the page. The list next to it still shows everything.'))); return null; }
    const L = g.L;
    const map = L.map(host, { zoomControl: true, attributionControl: true, worldCopyJump: false, zoomSnap: 0.5, tap: false })
      .setView(o.center || [22.9, 78.6], o.zoom || 5);
    const tiles = L.tileLayer(M.tileUrl(), { maxZoom: 19, referrerPolicy: 'strict-origin-when-cross-origin', attribution: '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a> contributors' }).addTo(map);
    let bad = 0, good = 0;
    const note = h('div', { class: 'map-offline-note', hidden: true }, UI.icon('alert', 14), 'The street map needs internet. Positions below are still correct.');
    host.appendChild(note);
    tiles.on('tileerror', () => { if (++bad >= 3 && !good) note.hidden = false; });
    tiles.on('tileload', () => { good++; note.hidden = true; });
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
