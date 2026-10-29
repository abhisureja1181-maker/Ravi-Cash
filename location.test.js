// Live location (GPS): staff share it, only the main admin and the CEO see it; meetings carry the place they were recorded from.
const test = require('node:test');
const assert = require('node:assert/strict');
const RW = require('./load.js');

let clockMs;
async function fresh(seed) {
  clockMs = Date.now();
  const storage = new RW.MemoryStorage();
  const server = RW.createServer({ storage, hashIterations: 1000, now: () => clockMs });
  await RW.seedDemo(server, Object.assign({ adminActions: true, tours: false, locations: false }, seed || {}));
  server.storage = storage;
  return server;
}
async function login(server, branch, user, pw) {
  const r = await server.call(null, 'auth.login', { branchCode: branch, identifier: user, password: pw || 'Ravi@1234', remember: true }, { device: 'test' });
  return r.token;
}
const rejects = (p, code) => assert.rejects(p, (e) => { assert.equal(e.code, code, 'expected ' + code + ' got ' + e.code + ': ' + e.message); return true; });
const today = () => RW.today(clockMs);
const day = (n) => RW.addDays(today(), n);
const INDORE = { lat: 22.7196, lng: 75.8577, acc: 15 };
const plan = () => ({ title: 'Gujarat dealer tour', purpose: '', startDate: day(0), endDate: day(1), days: [{ date: day(0), place: 'Rajkot', parties: [{ name: 'Ganesh Pumps', address: 'Gondal Road' }] }, { date: day(1), place: 'Morbi', parties: [] }] });

test('location: staff share it after saying yes; the main admin and the CEO see who is live, recent, offline or blocked', async () => {
  const s = await fresh();
  const neha = await login(s, 'INDORE', 'neha.joshi'), sa = await login(s, 'MAIN', 'admin', 'Admin@1234'), ceo = await login(s, 'MAIN', 'ceo');
  const cfg = await s.call(neha, 'location.config', {});
  assert.equal(cfg.enabled, true); assert.equal(cfg.consent, null); assert.equal(cfg.keepDays, 30);
  await s.call(neha, 'location.report', { state: 'CONSENT_GIVEN' });
  assert.equal((await s.call(neha, 'location.config', {})).consent, 'GIVEN');

  assert.equal((await s.call(neha, 'location.ping', Object.assign({ at: clockMs }, INDORE))).ok, true);
  assert.equal((await s.call(neha, 'location.ping', Object.assign({ at: clockMs }, INDORE))).throttled, true, 'one position per 10 seconds');
  const find = async (tok) => (await s.call(tok, 'location.live', {})).staff.find((x) => x.id === 'u_neha');
  let me = await find(sa);
  assert.equal(me.status, 'LIVE'); assert.equal(me.pos.lat, 22.7196); assert.equal(me.pos.acc, 15); assert.equal(me.branchCode, 'INDORE');
  assert.equal((await find(ceo)).status, 'LIVE', 'the CEO sees it too');
  clockMs += 10 * 60000; assert.equal((await find(sa)).status, 'RECENT');
  clockMs += 40 * 60000; assert.equal((await find(sa)).status, 'OFFLINE');
  assert.equal((await find(sa)).pos.ageSec >= 3000, true);

  // the person turns it off: shown at once as "location off", and nothing more is stored from that phone
  clockMs += 1000;
  await s.call(neha, 'location.report', { state: 'CONSENT_DECLINED' });
  assert.equal((await find(sa)).status, 'OFF');
  assert.equal((await s.call(neha, 'location.ping', INDORE)).off, true);
  await s.call(neha, 'location.report', { state: 'CONSENT_GIVEN' });
  clockMs += 11000;
  await s.call(neha, 'location.ping', INDORE);
  assert.equal((await find(sa)).status, 'LIVE');
  clockMs += 50 * 60000;

  // the phone says the browser blocked the location → "location off"
  await s.call(neha, 'location.report', { state: 'DENIED' });
  me = await find(sa); assert.equal(me.status, 'OFF'); assert.equal(me.blocked, true);
  // someone who never answered
  const live = await s.call(sa, 'location.live', {});
  assert.equal(live.staff.find((x) => x.id === 'u_nagpur').status, 'NEVER');
  assert.deepEqual(live.staff.map((x) => x.role).filter((r) => !['USER', 'BRANCH_ADMIN'].includes(r)), [], 'only User and Branch Admin accounts are tracked');
  assert.equal(live.counts.total, 6);

  // bad positions are refused
  clockMs += 60000;
  for (const bad of [{ lat: 95, lng: 10 }, { lat: 10, lng: 200 }, { lat: 'x', lng: 10 }, { lat: 0, lng: 0 }, {}]) await rejects(s.call(neha, 'location.ping', bad), 'VALIDATION');
  await rejects(s.call(neha, 'location.report', { state: 'WHATEVER' }), 'VALIDATION');
});

test('location: nobody but the main admin and the CEO can read it; the main admin and the CEO are not tracked', async () => {
  const s = await fresh();
  const neha = await login(s, 'INDORE', 'neha.joshi'), mgr = await login(s, 'INDORE', 'indore.manager'), colleague = await login(s, 'INDORE', 'indore.accountant');
  const viewer = await login(s, 'NAGPUR', 'nagpur.auditor'), sa = await login(s, 'MAIN', 'admin', 'Admin@1234'), ceo = await login(s, 'MAIN', 'ceo');
  await s.call(neha, 'location.ping', INDORE);
  for (const tok of [neha, mgr, colleague, viewer]) {
    for (const m of ['location.live', 'location.trail', 'location.meetings']) await rejects(s.call(tok, m, { userId: 'u_neha' }), 'FORBIDDEN');
  }
  for (const tok of [sa, ceo, viewer]) for (const m of ['location.ping', 'location.config', 'location.report']) await rejects(s.call(tok, m, Object.assign({ state: 'GRANTED' }, INDORE)), 'FORBIDDEN');
  await s.call(mgr, 'location.ping', { lat: 22.75, lng: 75.89 });          // a Branch Admin shares it, too
  assert.equal((await s.call(sa, 'location.live', {})).staff.find((x) => x.id === 'u_indadm').status, 'LIVE');
  assert.deepEqual((await s.call(ceo, 'location.live', { filters: { branchId: 'br_nagpur' } })).staff.map((x) => x.id), ['u_nagpur']);
  // a person's notifications / dashboards / user list never carry the position
  const users = JSON.stringify(await s.call(sa, 'users.list', { filters: {} }));
  assert.ok(!/22\.7196|75\.8577/.test(users));
});

test('location: the day route is kept in its own storage keys and the main database is not rewritten for a ping', async () => {
  const s = await fresh();
  const neha = await login(s, 'INDORE', 'neha.joshi'), sa = await login(s, 'MAIN', 'admin', 'Admin@1234');
  const rev = (await s.storage.get('db')).rev;
  const path = [[22.7196, 75.8577], [22.7196, 75.8578], [22.7300, 75.8700], [22.7500, 75.8900], [22.7500, 75.8901]];
  for (const [lat, lng] of path) { await s.call(neha, 'location.ping', { lat, lng, acc: 12, at: clockMs }); clockMs += 30000; }
  assert.equal((await s.storage.get('db')).rev, rev, 'a ping does not touch the main database');
  const t = await s.call(sa, 'location.trail', { userId: 'u_neha', date: today() });
  assert.equal(t.points.length, 3, 'tiny moves (a few metres) are not added to the route');
  assert.ok(t.km > 3 && t.km < 6, 'about 4 km: ' + t.km);
  assert.deepEqual(t.points.map((p) => p.lat), [22.7196, 22.73, 22.75]);
  assert.equal((await s.call(sa, 'location.trail', { userId: 'u_neha', date: day(-1) })).points.length, 0);
  await rejects(s.call(sa, 'location.trail', { userId: 'u_admin', date: today() }), 'NOT_FOUND');
  await rejects(s.call(sa, 'location.trail', { userId: 'u_neha', date: 'yesterday' }), 'VALIDATION');
});

test('location: a meeting keeps the place it was recorded from; only the main admin and the CEO can see that', async () => {
  const s = await fresh();
  const neha = await login(s, 'INDORE', 'neha.joshi'), mgr = await login(s, 'INDORE', 'indore.manager'), sa = await login(s, 'MAIN', 'admin', 'Admin@1234'), ceo = await login(s, 'MAIN', 'ceo');
  const t = (await s.call(neha, 'tours.create', plan())).tour;
  const g = await s.call(neha, 'tours.get', { id: t.id }), pp = g.tour.days[0].parties[0];
  const here = (await s.call(neha, 'visits.create', { tourId: t.id, plannedPartyId: pp.id, date: day(0), partyName: pp.name, address: pp.address, geo: { lat: 22.3039, lng: 70.8022, acc: 11, at: clockMs - 20000 } })).visit;
  const nowhere = (await s.call(neha, 'visits.create', { tourId: t.id, date: day(0), partyName: 'Walk-in', address: 'Somewhere', geoStatus: 'DENIED' })).visit;
  const legacy = (await s.call(neha, 'visits.create', { tourId: t.id, date: day(0), partyName: 'No info', address: 'Elsewhere' })).visit;

  // the person who recorded it only learns that a place was saved — never the coordinates
  assert.equal(here.hasLocation, true); assert.equal(nowhere.hasLocation, false);
  for (const v of [here, nowhere]) { assert.ok(!('geo' in v)); assert.ok(!('geoStatus' in v)); }
  for (const tok of [neha, mgr]) {
    const rows = (await s.call(tok, 'visits.list', {})).rows;
    assert.ok(rows.length >= 2 && rows.every((v) => !('geo' in v) && !('geoStatus' in v)), 'no coordinates for the owner and the branch admin');
    assert.ok(!JSON.stringify(await s.call(tok, 'tours.get', { id: t.id })).includes('70.8022'));
  }
  for (const tok of [sa, ceo]) {
    const rows = (await s.call(tok, 'visits.list', {})).rows, by = (n) => rows.find((v) => v.partyName === n);
    assert.deepEqual([by('Ganesh Pumps').geo.lat, by('Ganesh Pumps').geo.lng, by('Ganesh Pumps').geo.acc], [22.3039, 70.8022, 11]);
    assert.equal(by('Walk-in').geo, null); assert.equal(by('Walk-in').geoStatus, 'DENIED'); assert.equal(by('No info').geoStatus, 'UNAVAILABLE');
  }
  assert.equal(legacy.hasLocation, false);

  // the map layer
  const m = await s.call(ceo, 'location.meetings', { filters: { tourId: t.id } });
  assert.equal(m.total, 3); assert.equal(m.withLocation, 1);
  const row = m.rows.find((x) => x.partyName === 'Ganesh Pumps');
  assert.equal(row.planned, true); assert.equal(row.tourTitle, 'Gujarat dealer tour'); assert.equal(row.userName, 'Neha Joshi'); assert.equal(row.geo.stale, false);
  assert.equal((await s.call(sa, 'location.meetings', { filters: { userId: 'u_indore' } })).total, 0);
  assert.equal((await s.call(sa, 'location.trail', { userId: 'u_neha', date: today() })).meetings.length, 3);

  // it cannot be edited or faked afterwards, and a wrong position is refused
  const up = await s.call(neha, 'visits.update', { id: here.id, patch: { notes: 'corrected', geo: { lat: 10, lng: 10 } } });
  assert.equal(up.visit.hasLocation, true);
  assert.equal((await s.call(sa, 'visits.list', { filters: { q: 'Ganesh' } })).rows[0].geo.lat, 22.3039);
  await rejects(s.call(neha, 'visits.create', { tourId: t.id, date: day(0), partyName: 'Bad Geo', address: 'X Road', geo: { lat: 123, lng: 10 } }), 'VALIDATION');
  // a position that was taken long before saving is flagged
  const old = (await s.call(neha, 'visits.create', { tourId: t.id, date: day(0), partyName: 'Old fix', address: 'Y Road', geo: { lat: 22.3, lng: 70.8, at: clockMs - 30 * 60000 } })).visit;
  assert.equal((await s.call(sa, 'location.meetings', { filters: { tourId: t.id } })).rows.find((x) => x.id === old.id).geo.stale, true);
});

test('location: switch it off for everybody in Settings, change how long routes are kept; every change is in the audit trail', async () => {
  const s = await fresh();
  const neha = await login(s, 'INDORE', 'neha.joshi'), sa = await login(s, 'MAIN', 'admin', 'Admin@1234'), mgr = await login(s, 'INDORE', 'indore.manager');
  assert.equal((await s.call(sa, 'settings.get', {})).locationTracking, true);
  await rejects(s.call(mgr, 'settings.update', { locationTracking: false }), 'FORBIDDEN');
  await rejects(s.call(sa, 'settings.update', { locationKeepDays: 3 }), 'VALIDATION');
  await s.call(sa, 'settings.update', { locationTracking: false, locationKeepDays: 14 });
  const st = await s.call(sa, 'settings.get', {});
  assert.equal(st.locationTracking, false); assert.equal(st.locationKeepDays, 14);
  assert.equal((await s.call(neha, 'location.config', {})).enabled, false);
  assert.equal((await s.call(neha, 'location.ping', INDORE)).enabled, false);
  assert.equal((await s.call(sa, 'location.live', {})).enabled, false);
  assert.equal((await s.call(sa, 'location.live', {})).staff.find((x) => x.id === 'u_neha').pos, null, 'nothing was stored while it was off');
  await s.call(sa, 'settings.update', { locationTracking: true });
  assert.equal((await s.call(neha, 'location.ping', INDORE)).ok, true);

  // consent and permission changes are audited (the position itself is not)
  await s.call(neha, 'location.report', { state: 'CONSENT_DECLINED' });
  await s.call(neha, 'location.report', { state: 'CONSENT_DECLINED' });                 // the same answer again: nothing new to record
  await s.call(neha, 'location.report', { state: 'CONSENT_GIVEN' });
  const log = await s.call(sa, 'audit.list', { filters: { entity: 'LOCATION' }, pageSize: 10 });
  assert.equal(log.rows.length, 2);
  assert.equal((await s.call(sa, 'audit.list', { filters: { entity: 'SETTINGS' }, pageSize: 10 })).rows.length >= 2, true);
  assert.equal((await s.call(sa, 'audit.verify', {})).ok, true);
});

test('location: routes older than the keep period are erased; erasing a user, a branch or everything erases their location too', async () => {
  const s = await fresh();
  const neha = await login(s, 'INDORE', 'neha.joshi'), nag = await login(s, 'NAGPUR', 'nagpur.accountant'), sa = await login(s, 'MAIN', 'admin', 'Admin@1234');
  await s.call(neha, 'location.ping', INDORE); await s.call(nag, 'location.ping', { lat: 21.1458, lng: 79.0882, acc: 20 });
  await s.storage.set('trail:' + day(-40), { u_neha: [[clockMs - 40 * 864e5, 22.7, 75.8, 10]] });
  await s.storage.set('trail:' + day(-10), { u_neha: [[clockMs - 10 * 864e5, 22.7, 75.8, 10]] });
  clockMs += 864e5;                                                                      // a new day: the first route point cleans up
  await s.call(neha, 'location.ping', INDORE);
  const keys = await s.storage.keys('trail:');
  assert.ok(!keys.includes('trail:' + day(-41)) && keys.includes('trail:' + day(-11)), 'older than 30 days is gone, 10 days old stays: ' + keys.join(','));

  await s.call(sa, 'users.erase', { id: 'u_neha', reason: 'Left the company' });
  const live = await s.call(sa, 'location.live', {});
  assert.ok(!live.staff.some((x) => x.id === 'u_neha'));
  for (const k of await s.storage.keys('trail:')) assert.ok(!(await s.storage.get(k)).u_neha, 'her route is gone from ' + k);
  assert.ok((await s.storage.get('loc')).users.u_nagpur && !(await s.storage.get('loc')).users.u_neha);

  await s.call(sa, 'branches.delete', { id: 'br_nagpur', confirmCode: 'NAGPUR', reason: 'Branch closed' });
  assert.ok(!(await s.storage.get('loc')).users.u_nagpur);

  await s.call(nag, 'location.ping', INDORE).catch(() => {});                          // (her account is gone; nothing is stored)
  await s.call(sa, 'system.clear', { scope: 'EVERYTHING', confirm: 'DELETE ALL', password: 'Admin@1234' });
  assert.equal(await s.storage.get('loc'), null);
  assert.deepEqual(await s.storage.keys('trail:'), []);
});

test('demo data: the map has people in every state, routes and meetings with places', async () => {
  const s = await fresh({ tours: true, locations: true });
  const sa = await login(s, 'MAIN', 'admin', 'Admin@1234'), ceo = await login(s, 'MAIN', 'ceo');
  const live = await s.call(ceo, 'location.live', {});
  const st = Object.fromEntries(live.staff.map((x) => [x.id, x.status]));
  assert.deepEqual(st, { u_neha: 'LIVE', u_main: 'LIVE', u_indore: 'LIVE', u_nagpur: 'LIVE', u_mainadm: 'RECENT', u_indadm: 'OFF' });
  const neha = live.staff.find((x) => x.id === 'u_neha');
  assert.equal(neha.activity.tour.title, 'Malwa dealer tour'); assert.equal(neha.activity.tour.place, 'Ratlam'); assert.equal(neha.activity.meetings, 2); assert.equal(neha.activity.meetingsWithLocation, 1);
  assert.equal(neha.activity.lastMeeting.party, 'Sai Electricals'); assert.equal(neha.activity.lastMeeting.hasLocation, false);
  assert.equal(live.counts.onTour, 1); assert.equal(live.counts.live, 4); assert.equal(live.counts.off, 1);
  const tr = await s.call(sa, 'location.trail', { userId: 'u_neha', date: day(-1) });
  assert.ok(tr.points.length > 20 && tr.km > 100, 'yesterday: Indore → Dewas → Ujjain → Ratlam: ' + tr.km + ' km');
  assert.equal(tr.meetings.filter((m) => m.geo).length, 2);
  const m = await s.call(sa, 'location.meetings', { filters: { from: day(-20), to: day(1) } });
  assert.equal(m.total, 8); assert.equal(m.withLocation, 7);
  assert.equal((await s.call(sa, 'audit.verify', {})).ok, true);
  // a real ping from that person replaces the demo "minutes ago"
  const neh = await login(s, 'INDORE', 'neha.joshi');
  clockMs += 3600000;
  assert.equal((await s.call(ceo, 'location.live', {})).staff.find((x) => x.id === 'u_neha').status, 'LIVE', 'demo positions stay alive');
  await s.call(neh, 'location.ping', INDORE);
  clockMs += 3600000;
  assert.equal((await s.call(ceo, 'location.live', {})).staff.find((x) => x.id === 'u_neha').status, 'OFFLINE', 'a real position ages like any other');
});
