// Tour plans (advance, date-wise) and tour details (meetings with party name, address, phone and photos).
const test = require('node:test');
const assert = require('node:assert/strict');
const RW = require('./load.js');

// A tiny valid JPEG (data URL) — the server only checks type and size.
const JPG = 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=';
const PHOTO = (n) => ({ name: 'meeting-' + (n || 1) + '.jpg', mime: 'image/jpeg', dataUrl: JPG });

let clockMs;
async function fresh() {
  clockMs = Date.now();
  const storage = new RW.MemoryStorage();
  const server = RW.createServer({ storage, hashIterations: 1000, now: () => clockMs });
  await RW.seedDemo(server, { adminActions: true, tours: false });
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

const plan = (over) => Object.assign({
  title: 'Gujarat dealer tour', purpose: 'Meet dealers and collect pending payments', startDate: day(0), endDate: day(2),
  days: [
    { date: day(0), place: 'Rajkot', notes: 'Reach by 9 am', parties: [
      { name: 'Shree Ganesh Pumps', address: 'Gondal Road, Rajkot', phone: '9876543210', purpose: 'Collect payment' },
      { name: 'Patel Agro Traders', address: 'Market Yard, Rajkot', phone: '', purpose: 'New order' } ] },
    { date: day(1), place: 'Jamnagar, Morbi', notes: '', parties: [{ name: 'Morbi Ceramics', address: 'Highway, Morbi', phone: '+91 281 2345678', purpose: '' }] },
    { date: day(2), place: 'Ahmedabad', notes: '', parties: [] },
  ],
}, over || {});

test('tour plan: date-wise places and parties are saved, checked and shown back', async () => {
  const s = await fresh();
  const u = await login(s, 'INDORE', 'neha.joshi'), sa = await login(s, 'MAIN', 'admin', 'Admin@1234');
  const { tour } = await s.call(u, 'tours.create', plan());
  assert.equal(tour.phase, 'ONGOING');
  assert.equal(tour.dayCount, 3);
  assert.equal(tour.plannedParties, 3);
  assert.deepEqual(tour.places, ['Rajkot', 'Jamnagar', 'Morbi', 'Ahmedabad']);

  const g = await s.call(u, 'tours.get', { id: tour.id });
  assert.equal(g.tour.days.length, 3);
  assert.equal(g.tour.days[0].parties[0].name, 'Shree Ganesh Pumps');
  assert.equal(g.tour.days[0].parties[0].state, 'PENDING');
  assert.ok(/^pp_/.test(g.tour.days[0].parties[0].id));
  assert.equal(g.canEdit, false, 'the person who made the plan cannot change it'); assert.equal(g.canRecord, true); assert.equal(g.canClose, true);
  assert.equal(g.tour.approval, 'PENDING');

  // validation
  const bad = (over, msg) => assert.rejects(s.call(u, 'tours.create', plan(over)), (e) => { assert.equal(e.code, 'VALIDATION'); if (msg) assert.match(e.message, msg); return true; });
  await bad({ title: 'ab' }, /Tour name/);
  await bad({ endDate: day(-1) }, /end date/);
  await bad({ days: [] }, /at least one day/);
  await bad({ days: [{ date: day(5), place: 'Surat', parties: [] }] }, /within the tour/);
  await bad({ days: [{ date: day(0), place: 'A1', parties: [] }, { date: day(0), place: 'B1', parties: [] }] }, /twice/);
  await bad({ days: [{ date: day(0), place: '', parties: [] }] }, /place/);
  await bad({ days: [{ date: day(0), place: 'Surat', parties: [{ name: '', address: 'x' }] }] }, /party name/);
  await bad({ days: [{ date: day(0), place: 'Surat', parties: [{ name: 'Ok Party', phone: 'call me' }] }] }, /phone/);
  await bad({ startDate: day(400), endDate: day(401), days: [{ date: day(400), place: 'Far', parties: [] }] }, /start date/);
  await bad({ startDate: day(0), endDate: day(90) }, /at most/);

  // update (only the main admin, while the plan is waiting for approval): add a party, change a place
  const days = g.tour.days.map((d) => ({ date: d.date, place: d.place, notes: d.notes, parties: d.parties.map((p) => ({ id: p.id, name: p.name, address: p.address, phone: p.phone, purpose: p.purpose })) }));
  days[2].parties.push({ name: 'Ahmedabad Hardware', address: 'CG Road', phone: '079 2222 3333', purpose: 'Demo' });
  days[2].place = 'Ahmedabad, Sanand';
  await rejects(s.call(u, 'tours.update', { id: tour.id, patch: { days } }), 'FORBIDDEN');
  const up = await s.call(sa, 'tours.update', { id: tour.id, patch: { days } });
  assert.equal(up.tour.plannedParties, 4);
  const again = await s.call(u, 'tours.get', { id: tour.id });
  assert.equal(again.tour.days[0].parties[0].id, g.tour.days[0].parties[0].id, 'party ids stay the same when the plan is saved again');
  assert.equal(again.tour.version, 2);
});

test('tour detail: meeting with party, address, phone and photos; plan shows which parties were met', async () => {
  const s = await fresh();
  const u = await login(s, 'INDORE', 'neha.joshi');
  const { tour } = await s.call(u, 'tours.create', plan());
  const g0 = await s.call(u, 'tours.get', { id: tour.id });
  const pp = g0.tour.days[0].parties[0];

  const v = (await s.call(u, 'visits.create', {
    tourId: tour.id, plannedPartyId: pp.id, date: day(0), time: '10:30', partyName: pp.name, address: pp.address, phone: '9876543210',
    contactPerson: 'Mr. Mehta', notes: 'Will pay ₹40,000 on Friday', photos: [PHOTO(1), PHOTO(2)],
  })).visit;
  assert.equal(v.photoCount, 2);
  assert.equal(v.partyName, 'Shree Ganesh Pumps');
  assert.equal(v.canEdit, true);

  const g = await s.call(u, 'tours.get', { id: tour.id });
  assert.equal(g.tour.days[0].parties[0].state, 'MET');
  assert.deepEqual(g.tour.days[0].parties[0].visitIds, [v.id]);
  assert.equal(g.tour.days[0].parties[1].state, 'PENDING');
  assert.equal(g.tour.metPlanned, 1);
  assert.equal(g.tour.visitCount, 1);
  assert.equal(g.tour.photoCount, 2);

  // a meeting that was not in the plan
  const extra = (await s.call(u, 'visits.create', { tourId: tour.id, date: day(0), partyName: 'Walk-in Customer', address: 'Station Road, Rajkot', phone: '' })).visit;
  assert.equal(extra.plannedPartyId, null);
  assert.equal((await s.call(u, 'tours.get', { id: tour.id })).tour.visitCount, 2);

  // the photo can be opened
  const ph = await s.call(u, 'attachments.get', { id: v.photos[0].id });
  assert.equal(ph.mime, 'image/jpeg'); assert.equal(ph.dataUrl, JPG);

  // validation
  const bad = (over, msg) => assert.rejects(s.call(u, 'visits.create', Object.assign({ tourId: tour.id, date: day(0), partyName: 'Some Party', address: 'Some Road' }, over)), (e) => { assert.equal(e.code, 'VALIDATION', e.message); if (msg) assert.match(e.message, msg); return true; });
  await bad({ partyName: '' }, /Party name/);
  await bad({ address: '' }, /Address/);
  await bad({ phone: '12ab' }, /Phone/);
  await bad({ date: day(1) }, /future/);
  await bad({ date: day(-1) }, /within the tour/);
  await bad({ time: '25:00' }, /time/);
  await bad({ plannedPartyId: 'pp_deadbeefdeadbeef' }, /not in the tour plan/);
  await bad({ photos: [PHOTO(1), PHOTO(2), PHOTO(3), PHOTO(4), PHOTO(5)] }, /up to 4/);
  await bad({ photos: [{ name: 'bill.pdf', dataUrl: 'data:application/pdf;base64,JVBERi0xLjQK' }] }, /Only photos/);
  await bad({ photos: [{ name: 'x', dataUrl: 'not-a-data-url' }] }, /Invalid attachment/);

  // a meeting without any tour (recorded within the allowed back-dating)
  const solo = (await s.call(u, 'visits.create', { date: day(0), partyName: 'Local Dealer', address: 'Vijay Nagar, Indore', phone: '0731 2555000' })).visit;
  assert.equal(solo.tourId, null);

  // lists
  const l = await s.call(u, 'visits.list', { filters: { tourId: tour.id } });
  assert.equal(l.total, 2);
  assert.equal((await s.call(u, 'visits.list', { filters: { q: 'walk-in' } })).total, 1);
  assert.equal((await s.call(u, 'visits.list', {})).total, 3);
  assert.equal((await s.call(u, 'tours.list', { filters: { q: 'morbi' } })).total, 1, 'search finds a planned party');
  assert.equal((await s.call(u, 'tours.list', { filters: { q: 'walk-in' } })).total, 1, 'and a recorded meeting');
});

test('tour detail: a meeting can be corrected for 48 hours, then it is locked (only the main admin can change it)', async () => {
  const s = await fresh();
  const u = await login(s, 'INDORE', 'neha.joshi'), sa = await login(s, 'MAIN', 'admin', 'Admin@1234');
  const { tour } = await s.call(u, 'tours.create', plan());
  const v = (await s.call(u, 'visits.create', { tourId: tour.id, date: day(0), partyName: 'Typo Party', address: 'Old Address', phone: '9000000001', photos: [PHOTO(1)] })).visit;

  const e1 = await s.call(u, 'visits.update', { id: v.id, patch: { address: 'New Address, Rajkot', notes: 'corrected' } });
  assert.equal(e1.visit.address, 'New Address, Rajkot');
  const p2 = await s.call(u, 'visits.addPhoto', { id: v.id, photo: PHOTO(2) });
  assert.ok(p2.photo.id);
  await s.call(u, 'visits.removePhoto', { id: v.id, photoId: p2.photo.id });
  await rejects(s.call(u, 'attachments.get', { id: p2.photo.id }), 'NOT_FOUND');
  assert.equal(await s.storage.get('att:' + p2.photo.id), null, 'the removed photo file is erased');

  clockMs += 49 * 3600 * 1000;                                               // two days later
  await rejects(s.call(u, 'visits.update', { id: v.id, patch: { address: 'Sneaky change' } }), 'LOCKED');
  await rejects(s.call(u, 'visits.addPhoto', { id: v.id, photo: PHOTO(3) }), 'LOCKED');
  await rejects(s.call(u, 'visits.removePhoto', { id: v.id, photoId: v.photos[0].id }), 'LOCKED');
  await rejects(s.call(u, 'visits.delete', { id: v.id }), 'LOCKED');
  const fixed = await s.call(sa, 'visits.update', { id: v.id, patch: { partyName: 'Corrected Party' } });
  assert.equal(fixed.visit.partyName, 'Corrected Party');
  assert.equal((await s.call(u, 'visits.list', {})).rows[0].canEdit, false);
  assert.equal((await s.call(sa, 'visits.list', {})).rows[0].canEdit, true);

  // colleagues and the branch admin cannot change it, either
  const colleague = await login(s, 'INDORE', 'indore.accountant'), mgr = await login(s, 'INDORE', 'indore.manager');
  await rejects(s.call(colleague, 'visits.update', { id: v.id, patch: { notes: 'x' } }), 'NOT_FOUND');
  await rejects(s.call(mgr, 'visits.update', { id: v.id, patch: { notes: 'x' } }), 'FORBIDDEN');
  await rejects(s.call(mgr, 'visits.delete', { id: v.id }), 'FORBIDDEN');
  // the main admin deleting somebody else's meeting must give a reason
  await rejects(s.call(sa, 'visits.delete', { id: v.id }), 'VALIDATION');
  await s.call(sa, 'visits.delete', { id: v.id, reason: 'Duplicate entry' });
  assert.equal((await s.call(sa, 'visits.list', {})).total, 0);
  await rejects(s.call(sa, 'attachments.get', { id: v.photos[0].id }), 'NOT_FOUND');
});

test('tours: visibility of photos and read-only roles', async () => {
  const s = await fresh();
  const neha = await login(s, 'INDORE', 'neha.joshi'), colleague = await login(s, 'INDORE', 'indore.accountant'), mgr = await login(s, 'INDORE', 'indore.manager');
  const nag = await login(s, 'NAGPUR', 'nagpur.accountant'), viewer = await login(s, 'NAGPUR', 'nagpur.auditor');
  const ceo = await login(s, 'NAGPUR', 'ceo'), sa = await login(s, 'MAIN', 'admin', 'Admin@1234');
  const t1 = (await s.call(neha, 'tours.create', plan({ title: 'Neha tour' }))).tour;
  const t2 = (await s.call(colleague, 'tours.create', plan({ title: 'Colleague tour' }))).tour;
  const t3 = (await s.call(nag, 'tours.create', plan({ title: 'Nagpur tour' }))).tour;
  await s.call(mgr, 'tours.create', plan({ title: 'Manager tour' }));                        // a Branch Admin plans his own tours too
  const v1 = (await s.call(neha, 'visits.create', { tourId: t1.id, date: day(0), partyName: 'Neha Party', address: 'Indore', photos: [PHOTO()] })).visit;
  await s.call(nag, 'visits.create', { tourId: t3.id, date: day(0), partyName: 'Nagpur Party', address: 'Nagpur' });

  const titles = async (tok, f) => (await s.call(tok, 'tours.list', { filters: f || {} })).rows.map((t) => t.title).sort();
  assert.deepEqual(await titles(neha), ['Neha tour'], 'a User sees only own tours');
  assert.deepEqual(await titles(colleague), ['Colleague tour']);
  assert.deepEqual(await titles(mgr), ['Colleague tour', 'Manager tour', 'Neha tour'], 'a Branch Admin sees the branch');
  assert.deepEqual(await titles(viewer), ['Nagpur tour'], 'a Viewer sees the branch');
  assert.deepEqual(await titles(ceo), ['Colleague tour', 'Manager tour', 'Nagpur tour', 'Neha tour'], 'the CEO sees every branch');
  assert.deepEqual(await titles(sa), ['Colleague tour', 'Manager tour', 'Nagpur tour', 'Neha tour']);
  assert.deepEqual(await titles(ceo, { branchId: 'br_nagpur' }), ['Nagpur tour']);
  assert.equal((await s.call(ceo, 'visits.list', {})).total, 2);
  assert.equal((await s.call(mgr, 'visits.list', {})).total, 1);
  assert.equal((await s.call(neha, 'tours.list', {})).canCreate, true);
  assert.equal((await s.call(ceo, 'tours.list', {})).canCreate, false);

  await rejects(s.call(colleague, 'tours.get', { id: t1.id }), 'NOT_FOUND');
  await rejects(s.call(nag, 'attachments.get', { id: v1.photos[0].id }), 'NOT_FOUND');
  await rejects(s.call(viewer, 'attachments.get', { id: v1.photos[0].id }), 'NOT_FOUND');
  await rejects(s.call(colleague, 'attachments.get', { id: v1.photos[0].id }), 'NOT_FOUND');
  for (const tok of [neha, mgr, ceo, sa]) assert.equal((await s.call(tok, 'attachments.get', { id: v1.photos[0].id })).dataUrl, JPG);

  // nobody else can record on or change somebody's tour
  await rejects(s.call(colleague, 'visits.create', { tourId: t1.id, date: day(0), partyName: 'Intruder', address: 'Nowhere' }), 'NOT_FOUND');
  await rejects(s.call(mgr, 'visits.create', { tourId: t1.id, date: day(0), partyName: 'Manager visit', address: 'Indore' }), 'FORBIDDEN');
  await rejects(s.call(sa, 'visits.create', { tourId: t1.id, date: day(0), partyName: 'Admin visit', address: 'Indore' }), 'FORBIDDEN');
  await rejects(s.call(colleague, 'tours.update', { id: t1.id, patch: { title: 'Hijacked' } }), 'FORBIDDEN');
  await rejects(s.call(colleague, 'tours.setStatus', { id: t1.id, status: 'CANCELLED', reason: 'Not my tour' }), 'NOT_FOUND');
  await rejects(s.call(mgr, 'tours.update', { id: t1.id, patch: { title: 'Hijacked' } }), 'FORBIDDEN');
  await rejects(s.call(mgr, 'tours.setStatus', { id: t1.id, status: 'COMPLETED' }), 'FORBIDDEN');
  await rejects(s.call(mgr, 'tours.delete', { id: t1.id }), 'FORBIDDEN');
  assert.equal((await s.call(sa, 'tours.update', { id: t1.id, patch: { title: 'Neha tour (corrected)' } })).tour.title, 'Neha tour (corrected)', 'the main admin may correct any plan');

  // read-only roles cannot write anything
  for (const tok of [viewer, ceo]) {
    for (const [m, a] of [['tours.create', plan()], ['tours.update', { id: t3.id, patch: { title: 'No' } }], ['tours.setStatus', { id: t3.id, status: 'COMPLETED' }], ['tours.delete', { id: t3.id }],
      ['visits.create', { tourId: t3.id, date: day(0), partyName: 'No Party', address: 'No' }], ['visits.update', { id: v1.id, patch: { notes: 'x' } }], ['visits.addPhoto', { id: v1.id, photo: PHOTO() }], ['visits.delete', { id: v1.id }]]) {
      await rejects(s.call(tok, m, a), 'FORBIDDEN');
    }
  }
  assert.ok(t2.id);
});

test('tour status: the user can only cancel or complete; reopen and delete are the main admin\'s — and what a plan edit may not break', async () => {
  const s = await fresh();
  const u = await login(s, 'INDORE', 'neha.joshi'), sa = await login(s, 'MAIN', 'admin', 'Admin@1234');
  const future = (await s.call(u, 'tours.create', plan({ title: 'Future tour', startDate: day(10), endDate: day(11), days: [{ date: day(10), place: 'Surat', parties: [] }] }))).tour;
  assert.equal(future.phase, 'UPCOMING');
  await rejects(s.call(u, 'tours.setStatus', { id: future.id, status: 'COMPLETED' }), 'VALIDATION');           // has not started
  await rejects(s.call(u, 'tours.setStatus', { id: future.id, status: 'CANCELLED' }), 'VALIDATION');           // reason needed
  const c = await s.call(u, 'tours.setStatus', { id: future.id, status: 'CANCELLED', reason: 'Dealer meeting moved' });   // the user may cancel, even while waiting for approval
  assert.equal(c.tour.phase, 'CANCELLED'); assert.equal(c.tour.cancelReason, 'Dealer meeting moved'); assert.equal(c.tour.awaiting, false);
  await rejects(s.call(sa, 'tours.update', { id: future.id, patch: { title: 'Edit while cancelled' } }), 'LOCKED');
  await rejects(s.call(sa, 'tours.approve', { id: future.id }), 'LOCKED');                                      // a cancelled tour cannot be approved
  await rejects(s.call(u, 'visits.create', { tourId: future.id, date: day(0), partyName: 'X Party', address: 'X Road' }), 'LOCKED');
  await rejects(s.call(u, 'tours.setStatus', { id: future.id, status: 'PLANNED' }), 'FORBIDDEN');              // reopening is the main admin's
  await rejects(s.call(u, 'tours.setStatus', { id: future.id, status: 'COMPLETED' }), 'LOCKED');
  assert.equal((await s.call(sa, 'tours.setStatus', { id: future.id, status: 'PLANNED' })).tour.phase, 'UPCOMING', 'reopened by the main admin');
  await rejects(s.call(u, 'tours.delete', { id: future.id }), 'FORBIDDEN');                                     // even with no meetings the user cannot delete
  await s.call(sa, 'tours.delete', { id: future.id });
  assert.equal((await s.call(u, 'tours.list', { filters: { q: 'future' } })).total, 0);

  const { tour } = await s.call(u, 'tours.create', plan());
  const g = await s.call(sa, 'tours.get', { id: tour.id });
  const pp = g.tour.days[0].parties[0];
  const v = (await s.call(u, 'visits.create', { tourId: tour.id, plannedPartyId: pp.id, date: day(0), partyName: pp.name, address: pp.address, photos: [PHOTO()] })).visit;   // meetings can be recorded before approval
  const clone = () => g.tour.days.map((d) => ({ date: d.date, place: d.place, notes: d.notes, parties: d.parties.map((p) => ({ id: p.id, name: p.name, address: p.address, phone: p.phone, purpose: p.purpose })) }));
  const noParty = clone(); noParty[0].parties = noParty[0].parties.filter((p) => p.id !== pp.id);
  await rejects(s.call(sa, 'tours.update', { id: tour.id, patch: { days: noParty } }), 'VALIDATION');           // a met party cannot be dropped
  await rejects(s.call(sa, 'tours.update', { id: tour.id, patch: { startDate: day(1), days: clone().slice(1) } }), 'VALIDATION');   // a meeting would fall outside the dates
  assert.equal((await s.call(sa, 'tours.update', { id: tour.id, patch: { endDate: day(3), days: clone().concat([{ date: day(3), place: 'Vadodara', parties: [] }]) } })).tour.dayCount, 4, 'extending is fine');
  await s.call(sa, 'tours.approve', { id: tour.id });

  assert.equal((await s.call(u, 'tours.setStatus', { id: tour.id, status: 'COMPLETED' })).tour.phase, 'COMPLETED');
  assert.equal((await s.call(u, 'tours.list', { filters: {} })).counts.COMPLETED, 1);
  await s.call(u, 'visits.create', { tourId: tour.id, date: day(1) > today() ? today() : day(1), partyName: 'Late Entry', address: 'Late Road' });   // a late entry after completing is still allowed
  await rejects(s.call(u, 'tours.delete', { id: tour.id }), 'FORBIDDEN');                // only the main admin deletes
  await rejects(s.call(sa, 'tours.delete', { id: tour.id }), 'VALIDATION');             // ... and with a reason when there are meetings
  await s.call(sa, 'tours.delete', { id: tour.id, reason: 'Test tour removed' });
  assert.equal((await s.call(sa, 'visits.list', {})).total, 0, 'meetings go with the tour');
  await rejects(s.call(sa, 'attachments.get', { id: v.photos[0].id }), 'NOT_FOUND');
  assert.equal(await s.storage.get('att:' + v.photos[0].id), null, 'and so do their photo files');
});

test('tour approval: a new plan waits for the main admin; only he can change it; after approval it is final and the user can only cancel', async () => {
  const s = await fresh();
  const u = await login(s, 'INDORE', 'neha.joshi'), sa = await login(s, 'MAIN', 'admin', 'Admin@1234'), mgr = await login(s, 'INDORE', 'indore.manager');
  const ceo = await login(s, 'MAIN', 'ceo'), viewer = await login(s, 'NAGPUR', 'nagpur.auditor');
  const { tour } = await s.call(u, 'tours.create', plan());
  assert.equal(tour.approval, 'PENDING'); assert.equal(tour.awaiting, true);

  // who sees what
  const mine = await s.call(u, 'tours.get', { id: tour.id }), his = await s.call(sa, 'tours.get', { id: tour.id });
  assert.deepEqual([mine.canEdit, mine.canApprove, mine.canClose, mine.canReopen, mine.canDelete, mine.canRecord], [false, false, true, false, false, true]);
  assert.deepEqual([his.canEdit, his.canApprove, his.canClose, his.canReopen, his.canDelete, his.canRecord], [true, true, true, false, true, false]);
  const wait = await s.call(sa, 'tours.list', { filters: { approval: 'PENDING' } });
  assert.equal(wait.total, 1); assert.equal(wait.counts.PENDING_APPROVAL, 1);
  assert.equal((await s.call(u, 'tours.list', {})).counts.PENDING_APPROVAL, 1);

  // the main admin is told, the person who planned is not
  const n = (await s.call(sa, 'notifications.list', {})).rows.find((x) => x.kind === 'TOUR_PENDING');
  assert.ok(n && n.important && /Neha Joshi/.test(n.body), 'the main admin gets an approval request');
  assert.ok(!(await s.call(u, 'notifications.list', {})).rows.some((x) => x.kind === 'TOUR_PENDING'));
  const d1 = await s.call(ceo, 'ceo.dashboard', { range: 'month' });
  assert.equal(d1.tours.pendingApproval, 1);
  assert.ok(d1.alerts.some((a) => /waiting for the main admin/.test(a.title) && a.href === '#/tours?approval=1'), 'the CEO sees it too');

  // nobody but the main admin may change or approve a plan
  for (const [who, tok] of [['owner', u], ['branch admin', mgr], ['ceo', ceo], ['viewer', viewer]]) {
    await rejects(s.call(tok, 'tours.update', { id: tour.id, patch: { title: 'Changed by ' + who } }), 'FORBIDDEN');
    await rejects(s.call(tok, 'tours.approve', { id: tour.id }), 'FORBIDDEN');
  }

  // the main admin changes it while it is waiting; the owner is told and it is still waiting
  const ed = await s.call(sa, 'tours.update', { id: tour.id, patch: { title: 'Gujarat dealer tour (admin edit)' }, reason: 'Title corrected' });
  assert.equal(ed.tour.awaiting, true);
  const told = (await s.call(u, 'notifications.list', {})).rows.find((x) => x.kind === 'TOUR_EDITED');
  assert.ok(told && /^Super Admin changed your tour plan/.test(told.body), 'the owner is told the admin changed the plan');

  // approve → final
  const ap = await s.call(sa, 'tours.approve', { id: tour.id });
  assert.equal(ap.tour.approval, 'APPROVED'); assert.equal(ap.tour.awaiting, false); assert.equal(ap.tour.approvedBy, 'Super Admin'); assert.ok(ap.tour.approvedAt);
  await rejects(s.call(sa, 'tours.approve', { id: tour.id }), 'VALIDATION');
  await rejects(s.call(sa, 'tours.update', { id: tour.id, patch: { title: 'Too late' } }), 'LOCKED');           // not even the main admin
  await rejects(s.call(u, 'tours.update', { id: tour.id, patch: { title: 'Too late' } }), 'FORBIDDEN');
  const after = await s.call(sa, 'tours.get', { id: tour.id });
  assert.equal(after.canEdit, false); assert.equal(after.canApprove, false);
  assert.equal((await s.call(sa, 'tours.list', { filters: { approval: 'PENDING' } })).total, 0);
  assert.ok((await s.call(u, 'notifications.list', {})).rows.some((x) => x.kind === 'TOUR_APPROVED'), 'the owner is told it was approved');
  assert.equal((await s.call(ceo, 'ceo.dashboard', { range: 'month' })).tours.pendingApproval, 0);

  // the user can still record meetings on an approved tour, and can only cancel it
  await s.call(u, 'visits.create', { tourId: tour.id, date: day(0), partyName: 'After Approval', address: 'Rajkot' });
  await rejects(s.call(u, 'tours.delete', { id: tour.id }), 'FORBIDDEN');
  const gone = await s.call(u, 'tours.setStatus', { id: tour.id, status: 'CANCELLED', reason: 'Trip postponed by the dealer' });
  assert.equal(gone.tour.phase, 'CANCELLED');
  await rejects(s.call(u, 'tours.setStatus', { id: tour.id, status: 'PLANNED' }), 'FORBIDDEN');
  assert.ok((await s.call(sa, 'notifications.list', {})).rows.some((x) => x.kind === 'TOUR_CANCELLED' && /postponed/.test(x.body)), 'the main admin is told about a cancelled tour');

  const log = (await s.call(sa, 'audit.list', { filters: { entity: 'TOUR' }, pageSize: 20 })).rows.map((a) => a.action).sort();
  assert.deepEqual(log, ['APPROVE', 'CREATE', 'EDIT', 'STATUS']);
  assert.equal((await s.call(sa, 'audit.verify', {})).ok, true);
});

test('tour approval: the main admin\'s own plan also needs approval; a plan saved before approvals existed counts as final', async () => {
  const s = await fresh();
  const sa = await login(s, 'MAIN', 'admin', 'Admin@1234'), u = await login(s, 'INDORE', 'neha.joshi');
  const mine = (await s.call(sa, 'tours.create', plan({ title: 'Admin tour' }))).tour;
  assert.equal(mine.awaiting, true);
  assert.ok(!(await s.call(sa, 'notifications.list', {})).rows.some((x) => x.kind === 'TOUR_PENDING' && /Admin tour/.test(x.body)), 'no request to himself');
  await s.call(sa, 'tours.update', { id: mine.id, patch: { purpose: 'Check the plan once more' } });
  assert.equal((await s.call(sa, 'tours.approve', { id: mine.id })).tour.approval, 'APPROVED');
  await rejects(s.call(sa, 'tours.update', { id: mine.id, patch: { purpose: 'No more changes' } }), 'LOCKED');
  assert.equal((await s.call(sa, 'tours.setStatus', { id: mine.id, status: 'CANCELLED', reason: 'Trip dropped' })).tour.phase, 'CANCELLED');

  const old = (await s.call(u, 'tours.create', plan({ title: 'Old tour' }))).tour;
  const db = await s.storage.get('db', true);
  delete db.tours.find((t) => t.id === old.id).approval;
  await s.storage.set('db', db);
  const g = await s.call(sa, 'tours.get', { id: old.id });
  assert.equal(g.tour.approval, 'APPROVED'); assert.equal(g.canEdit, false); assert.equal(g.canApprove, false);
  await rejects(s.call(sa, 'tours.update', { id: old.id, patch: { title: 'Rewrite' } }), 'LOCKED');
  assert.equal((await s.call(sa, 'tours.list', { filters: { approval: 'PENDING' } })).total, 0);
});

test('tours: audit trail, notification, dashboard summary and the hash chain stay intact', async () => {
  const s = await fresh();
  const u = await login(s, 'INDORE', 'neha.joshi'), sa = await login(s, 'MAIN', 'admin', 'Admin@1234'), ceo = await login(s, 'MAIN', 'ceo');
  const { tour } = await s.call(u, 'tours.create', plan());
  await s.call(u, 'visits.create', { tourId: tour.id, date: day(0), partyName: 'Audit Party', address: 'Audit Road', phone: '9000000002', photos: [PHOTO()] });
  await s.call(sa, 'tours.update', { id: tour.id, patch: { title: 'Gujarat dealer tour (v2)' } });
  const log = await s.call(sa, 'audit.list', { filters: { entity: 'TOUR' }, pageSize: 10 });
  assert.deepEqual(log.rows.map((a) => a.action).sort(), ['CREATE', 'EDIT']);
  assert.equal((await s.call(sa, 'audit.list', { filters: { entity: 'VISIT' }, pageSize: 10 })).rows[0].action, 'CREATE');
  const n = await s.call(sa, 'notifications.list', {});
  assert.ok(n.rows.some((x) => x.kind === 'TOUR_PENDING' && /Gujarat dealer tour/.test(x.body)), 'admins are asked to approve a new tour plan');
  const d = await s.call(ceo, 'ceo.dashboard', { range: 'month' });
  assert.equal(d.tours.onTour.length, 1);
  assert.equal(d.tours.onTour[0].userName, 'Neha Joshi');
  assert.equal(d.tours.onTour[0].todayPlace, 'Rajkot');
  assert.equal(d.tours.meetings, 1);
  assert.equal((await s.call(sa, 'audit.verify', {})).ok, true);
});

test('tours: erasing a user or a branch takes their tours, meetings and photos along; "clear transactions" keeps them', async () => {
  const s = await fresh();
  const neha = await login(s, 'INDORE', 'neha.joshi'), nag = await login(s, 'NAGPUR', 'nagpur.accountant'), sa = await login(s, 'MAIN', 'admin', 'Admin@1234');
  const t1 = (await s.call(neha, 'tours.create', plan({ title: 'Neha tour' }))).tour, t3 = (await s.call(nag, 'tours.create', plan({ title: 'Nagpur tour' }))).tour;
  const v1 = (await s.call(neha, 'visits.create', { tourId: t1.id, date: day(0), partyName: 'A Party', address: 'A Road', photos: [PHOTO(), PHOTO(2)] })).visit;
  const v3 = (await s.call(nag, 'visits.create', { tourId: t3.id, date: day(0), partyName: 'B Party', address: 'B Road', photos: [PHOTO()] })).visit;
  const pre = await s.call(sa, 'erase.preview', {});
  assert.equal(pre.tours, 2); assert.equal(pre.visits, 2);
  assert.equal((await s.call(sa, 'erase.preview', { userId: 'u_neha' })).tours, 1);

  // clearing transactions does not touch tours: their photos stay readable
  await s.call(sa, 'system.clear', { scope: 'TRANSACTIONS', confirm: 'DELETE ALL', password: 'Admin@1234' });
  assert.equal((await s.call(sa, 'tours.list', {})).total, 2);
  assert.equal((await s.call(sa, 'attachments.get', { id: v1.photos[0].id })).dataUrl, JPG);
  assert.equal((await s.call(sa, 'vouchers.list', { pageSize: 1 })).total, 0);

  // erasing Neha removes her tour, meeting and both photos — Nagpur's stay
  const r = await s.call(sa, 'users.erase', { id: 'u_neha', reason: 'Left the company' });
  assert.equal(r.ok, true);
  assert.deepEqual((await s.call(sa, 'tours.list', {})).rows.map((t) => t.title), ['Nagpur tour']);
  for (const p of v1.photos) assert.equal(await s.storage.get('att:' + p.id), null);
  assert.equal((await s.call(sa, 'attachments.get', { id: v3.photos[0].id })).dataUrl, JPG);

  // deleting the Nagpur branch removes the rest
  await s.call(sa, 'branches.delete', { id: 'br_nagpur', confirmCode: 'NAGPUR', reason: 'Branch closed' });
  assert.equal((await s.call(sa, 'tours.list', {})).total, 0);
  assert.equal((await s.call(sa, 'visits.list', {})).total, 0);
  assert.equal(await s.storage.get('att:' + v3.photos[0].id), null);
  assert.equal((await s.call(sa, 'audit.verify', {})).ok, true);
});

test('tours: a database saved by an older version (no tours yet) still works', async () => {
  const s = await fresh();
  const db = await s.storage.get('db', true);
  delete db.tours; delete db.visits; delete db.seq.tour; delete db.seq.visit;
  await s.storage.set('db', db);
  const u = await login(s, 'INDORE', 'neha.joshi');
  assert.equal((await s.call(u, 'tours.list', {})).total, 0);
  assert.equal((await s.call(u, 'visits.list', {})).total, 0);
  const { tour } = await s.call(u, 'tours.create', plan());
  assert.equal(tour.seq, 1);
  assert.equal((await s.call(u, 'visits.create', { tourId: tour.id, date: day(0), partyName: 'Old DB Party', address: 'Somewhere' })).visit.seq, 1);
});

test('demo data: ships with sample tours and meetings that follow the rules', async () => {
  const storage = new RW.MemoryStorage();
  const s = RW.createServer({ storage, hashIterations: 1000 });
  await RW.seedDemo(s, { adminActions: true });
  const sa = await login(s, 'MAIN', 'admin', 'Admin@1234'), neha = await login(s, 'INDORE', 'neha.joshi'), ceo = await login(s, 'MAIN', 'ceo');
  const all = await s.call(sa, 'tours.list', {});
  assert.deepEqual(all.rows.map((t) => t.title).sort(), ['Bhopal stockist review', 'Malwa dealer tour', 'Saurashtra payment collection', 'Vidarbha dealer visit']);
  assert.equal(all.counts.ONGOING, 1); assert.equal(all.counts.COMPLETED, 1); assert.equal(all.counts.UPCOMING, 1); assert.equal(all.counts.CANCELLED, 1);
  assert.equal(all.counts.PENDING_APPROVAL, 1, 'the Vidarbha plan is waiting for approval');
  assert.deepEqual(all.rows.filter((t) => t.awaiting).map((t) => t.title), ['Vidarbha dealer visit']);
  const mine = await s.call(neha, 'tours.list', {});
  assert.equal(mine.total, 1);
  const g = await s.call(neha, 'tours.get', { id: mine.rows[0].id });
  assert.equal(g.tour.metPlanned, 3); assert.equal(g.tour.visitCount, 4);
  assert.equal(g.tour.approval, 'APPROVED'); assert.equal(g.canEdit, false); assert.equal(g.canClose, true);
  assert.ok(g.tour.days.some((d) => d.parties.some((p) => p.state === 'PENDING')), 'a party of tomorrow is still to be met');
  const d = await s.call(ceo, 'ceo.dashboard', { range: 'month' });
  assert.equal(d.tours.onTour.length, 1); assert.equal(d.tours.upcoming.length, 1); assert.equal(d.tours.pendingApproval, 1);
  assert.equal((await s.call(sa, 'audit.verify', {})).ok, true);
});
