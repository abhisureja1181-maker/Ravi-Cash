/* Ravi Cash — realistic demo data (90 days, 3 branches, 8 users). Demo mode only. */
(function (g) {
  'use strict';
  const RW = (g.RW = g.RW || {});

  const PAY = [
    ['Shree Ganesh Hardware', 'Purchase of GI pipes, sockets and fittings', 1800, 9500],
    ['Patel Transport Co.', 'Freight charges for pump consignment', 1200, 8500],
    ['Mahalaxmi Electricals', 'Purchase of motor winding wire and capacitors', 2200, 14000],
    ['Bharat Petroleum Pump', 'Diesel for delivery vehicle', 1500, 5200],
    ['Ramesh Kumar (Fitter)', 'Labour charges – borewell pump installation', 900, 4500],
    ['Jay Ambe Tea Stall', 'Tea and refreshments for office and customers', 150, 650],
    ['Sharma Stationers', 'Stationery and printing – invoice and bill books', 350, 2400],
    ['State Electricity Board', 'Electricity bill – godown and workshop', 2800, 9800],
    ['Kisan Spare Parts', 'Purchase of mechanical seals and bearings for monoblock pumps', 1600, 11500],
    ['Mukesh Verma', 'Salary advance – workshop helper', 2000, 6000],
    ['Om Packaging', 'Packing material and cartons for dispatch', 600, 3200],
    ['DTDC Courier', 'Courier charges – warranty spare parts', 180, 950],
    ['Anand Auto Garage', 'Repair and servicing of delivery pickup', 1200, 7800],
    ['Municipal Corporation', 'Local tax and trade licence renewal', 1500, 6500],
  ];
  const REC = [
    ['Kisan Agro Service', (n) => 'Cash received against Invoice RWP/2627/' + n + ' – 2 HP monoblock pump', 6500, 38000],
    ['Shri Hari Irrigation', () => 'Advance received for 5 HP submersible pump order', 10000, 60000],
    ['Mohan Lal & Sons', (n) => 'Part payment against Invoice RWP/2627/' + n + ' – borewell motor', 8000, 55000],
    ['Walk-in Customer', () => 'Cash sale – pump spare parts counter', 400, 6500],
    ['Gayatri Farm Equipments', (n) => 'Cash received for pump repair, Job Card #' + n, 1200, 9500],
    ['Sai Krupa Dairy Farm', () => 'Payment for 3 HP pump set with starter panel', 18000, 85000],
    ['Balaji Borewell Works', (n) => 'Cash received against Invoice RWP/2627/' + n + ' – 7.5 HP submersible set', 25000, 90000],
  ];
  const BANK = { MAIN: 'State Bank of India – Rajkot', INDORE: 'Bank of Baroda – Indore', NAGPUR: 'HDFC Bank – Nagpur' };

  RW.seedDemo = async function (server, o) {
    o = o || {};
    const H = server.helpers;
    const s = H.emptyState();
    const today = o.today || H.todayIst();
    const nowMs = H.clock();
    const rnd = RW.prng(o.seed || 20261012);
    const pick = (a) => a[Math.floor(rnd() * a.length)];
    const R = (a, b) => a + Math.floor(rnd() * (b - a + 1));
    const iso = (date, hour) => new Date(Date.parse(date + 'T00:00:00Z') + hour * 3600000 - 19800000).toISOString();
    const round = (x, step) => Math.max(step, Math.round(x / step) * step);

    /* -------- branches */
    const mkBranch = (id, code, name, address, contact) => ({ id, code, regPrefix: H.makeRegPrefix(s, code), name, address, contact, status: 'ACTIVE', createdAt: iso(RW.addDays(today, -700), 9) });
    s.branches.push(mkBranch('br_main', 'MAIN', 'Ravi Water Flow Pump', 'Main Road, Rajkot, Gujarat 360001', '+91 281 000 0001'));
    s.branches.push(mkBranch('br_indore', 'INDORE', 'Ravi Water Flow Pump - Indore', 'Industrial Area, Indore, Madhya Pradesh 452001', '+91 731 000 0002'));
    s.branches.push(mkBranch('br_nagpur', 'NAGPUR', 'Ravi Water Flow Pump - Nagpur', 'Butibori MIDC, Nagpur, Maharashtra 441122', '+91 712 000 0003'));

    /* -------- users (+ one cash register each, except the viewer) */
    const PW = { admin: 'Admin@1234', other: 'Ravi@1234' };
    const defs = [
      ['u_admin', 'Super Admin', 'admin', 'SUPER_ADMIN', 'br_main', 'System Administrator', 0, '9800000001'],
      ['u_main', 'Suresh Mehta', 'main.accountant', 'USER', 'br_main', 'Main Accountant', 15000000, '9800000002'],
      ['u_mainadm', 'Kiran Shah', 'main.manager', 'BRANCH_ADMIN', 'br_main', 'Branch Manager', 1000000, '9800000003'],
      ['u_indore', 'Rahul Patel', 'indore.accountant', 'USER', 'br_indore', 'Indore Accountant', 8000000, '9800000004'],
      ['u_neha', 'Neha Joshi', 'neha.joshi', 'USER', 'br_indore', 'Cashier', 2500000, '9800000005'],
      ['u_indadm', 'Vikram Chauhan', 'indore.manager', 'BRANCH_ADMIN', 'br_indore', 'Branch Manager', 2000000, '9800000006'],
      ['u_nagpur', 'Amit Deshmukh', 'nagpur.accountant', 'USER', 'br_nagpur', 'Nagpur Accountant', 6000000, '9800000007'],
      ['u_auditor', 'Pooja Kulkarni', 'nagpur.auditor', 'VIEWER', 'br_nagpur', 'Branch Auditor', 0, '9800000008'],
    ];
    const bal = {};
    for (const [id, fullName, username, role, branchId, designation, opening, mobile] of defs) {
      const creds = await H.makeCredentials(role === 'SUPER_ADMIN' ? PW.admin : PW.other);
      const u = Object.assign({
        id, fullName, username, email: username.replace(/\./g, '') + '@raviwaterflow.example', mobile, designation, branchId, role, status: 'ACTIVE',
        joiningDate: RW.addDays(today, -R(200, 900)), createdAt: iso(RW.addDays(today, -R(150, 600)), 10), createdBy: 'u_admin', mustChangePassword: false,
        deleted: false, lastLoginAt: null, lastActivityAt: null,
      }, creds);
      s.users.push(u);
      if (role !== 'VIEWER') {
        s.registers.push({ id: H.nextRegisterId(s, s.branches.find((b) => b.id === branchId), fullName), userId: id, branchId, openingPaise: opening, createdAt: u.createdAt });
        bal[id] = opening;
      }
    }

    // the CEO: reads everything in every branch, changes nothing, has no cash register (made without the random generator, so the demo data above is unchanged)
    s.users.push(Object.assign({
      id: 'u_ceo', fullName: 'Rajesh Agarwal', username: 'ceo', email: 'ceo@raviwaterflow.example', mobile: '9800000009', designation: 'Chief Executive Officer',
      branchId: 'br_main', role: 'CEO', status: 'ACTIVE', joiningDate: RW.addDays(today, -700), createdAt: iso(RW.addDays(today, -500), 10), createdBy: 'u_admin',
      mustChangePassword: false, deleted: false, lastLoginAt: null, lastActivityAt: null,
    }, await H.makeCredentials(PW.other)));

    /* -------- 90 days of vouchers */
    const staff = defs.filter((d) => d[3] !== 'VIEWER');
    const pending = [];
    const days = 90;
    for (let i = days - 1; i >= 0; i--) {
      const d = RW.addDays(today, -i);
      const dow = RW.dow(d);
      for (const [id, , , role, branchId] of staff) {
        const isToday = i === 0;
        let n;
        if (role === 'USER') n = dow === 0 && !isToday ? (rnd() < 0.1 ? 1 : 0) : R(isToday ? 1 : 0, 3);
        else if (role === 'BRANCH_ADMIN') n = rnd() < 0.3 ? 1 : 0;
        else n = rnd() < 0.1 ? 1 : 0;
        const items = [];
        for (let k = 0; k < n; k++) {
          const receipt = rnd() < 0.38;
          const hour = 10 + rnd() * 8;
          items.push({ receipt, hour });
        }
        // weekly bank deposit of surplus cash keeps registers realistic
        if (role === 'USER' && dow === 6 && bal[id] > 6000000) items.push({ bank: true, hour: 17.5 });
        items.sort((a, b) => a.hour - b.hour);
        for (const it of items) {
          let createdMs = Date.parse(iso(d, it.hour));
          if (createdMs > nowMs - 60000) createdMs = nowMs - 60000 - R(0, 3) * 600000;
          if (it.bank) {
            const amt = Math.floor((bal[id] * 0.8) / 100000) * 100000;
            if (amt < 1000000) continue;
            bal[id] -= amt;
            pending.push({ type: 'PAYMENT', userId: id, branchId, date: d, createdMs, partyName: BANK[s.branches.find((b) => b.id === branchId).code], particulars: 'Cash deposited in bank account – surplus cash', amountPaise: amt });
            continue;
          }
          if (it.receipt) {
            const t = pick(REC);
            const amt = round(R(t[2], t[3]), 50) * 100;
            bal[id] += amt;
            pending.push({ type: 'RECEIPT', userId: id, branchId, date: d, createdMs, partyName: t[0], particulars: t[1](R(100, 980)), amountPaise: amt });
          } else {
            const t = pick(PAY);
            let amt = round(rnd() < 0.04 ? R(52000, 120000) : R(t[2], t[3]), 10) * 100;
            if (amt > bal[id]) amt = Math.floor((bal[id] * 0.5) / 1000) * 1000;
            if (amt < 10000) continue;
            bal[id] -= amt;
            pending.push({ type: 'PAYMENT', userId: id, branchId, date: d, createdMs, partyName: t[0], particulars: t[1], amountPaise: amt });
          }
        }
      }
    }
    pending.sort((a, b) => a.createdMs - b.createdMs);

    const settings = s.settings;
    let attached = 0;
    const lastN = pending.length - 14;
    for (let idx = 0; idx < pending.length; idx++) {
      const p = pending[idx];
      const u = s.users.find((x) => x.id === p.userId);
      const nm = settings.numbering[p.type];
      const number = nm.prefix + '-' + String(++s.counters[p.type]).padStart(nm.pad, '0');
      const at = new Date(p.createdMs).toISOString();
      const v = {
        id: 'v_' + String(idx + 1).padStart(5, '0'), seq: ++s.seq.voucher, number, type: p.type, branchId: p.branchId, userId: p.userId, date: p.date,
        partyName: p.partyName, particulars: p.particulars, notes: '', amountPaise: p.amountPaise, amountInWords: RW.amountInWords(p.amountPaise),
        attachmentIds: [], status: 'ACTIVE', locked: true, createdAt: at, createdBy: p.userId, updatedAt: at, updatedBy: p.userId, version: 1, clientId: null, voidReason: '',
      };
      s.vouchers.push(v);
      const ctx = { state: s, user: u, meta: { device: o.device || 'Demo seed', ip: 'demo' } };
      await H.audit(ctx, { at, entity: 'VOUCHER', entityId: v.id, entityLabel: number, action: 'CREATE', branchId: v.branchId, new: { number, type: v.type, date: v.date, partyName: v.partyName, particulars: v.particulars, amount: v.amountPaise / 100 } });
      if (o.makeReceiptImage && attached < (o.maxImages || 36) && rnd() < 0.16) {
        const dataUrl = await o.makeReceiptImage(v, s.branches.find((b) => b.id === v.branchId).name);
        if (dataUrl) {
          const id = 'at_' + String(++attached).padStart(5, '0');
          s.attachments.push({ id, voucherId: v.id, branchId: v.branchId, userId: v.userId, name: 'receipt-' + number + '.jpg', mime: dataUrl.slice(5, dataUrl.indexOf(';')), size: Math.floor((dataUrl.length * 3) / 4), addedAt: at, addedBy: u.id });
          v.attachmentIds.push(id);
          await server.helpers.storage.set('att:' + id, dataUrl);
          await H.audit(ctx, { at, entity: 'VOUCHER', entityId: v.id, entityLabel: number, action: 'ATTACH', branchId: v.branchId, new: { name: 'receipt-' + number + '.jpg' } });
        }
      }
      if (idx >= lastN) {
        const big = v.type === 'PAYMENT' && v.amountPaise >= settings.largePaymentAlertPaise;
        H.notify(ctx, {
          at, kind: v.type === 'PAYMENT' ? 'VOUCHER_CREATED' : 'RECEIPT_CREATED', title: v.type === 'PAYMENT' ? (big ? 'Large payment voucher created' : 'New voucher created') : 'New cash receipt created',
          body: 'Voucher amount ' + RW.fmtINR(v.amountPaise) + ' created by ' + u.fullName.split(' ')[0] + ' · ' + number, branchId: v.branchId, voucherId: v.id, important: big,
        });
      }
    }

    /* -------- branch transfers: head office sends cash to Indore (received) and to Nagpur (still on the way) */
    if (o.transfers !== false) {
      const vno = (type) => { const nm = settings.numbering[type]; return nm.prefix + '-' + String(++s.counters[type]).padStart(nm.pad, '0'); };
      const put = async (userId, x) => {
        const u = s.users.find((w) => w.id === userId);
        const at = iso(x.date, x.hour);
        const v = Object.assign({
          id: 'v_x' + String(s.vouchers.length + 1).padStart(4, '0'), seq: ++s.seq.voucher, branchId: u.branchId, userId, notes: '', attachmentIds: [], status: 'ACTIVE', locked: true,
          createdAt: at, createdBy: userId, updatedAt: at, updatedBy: userId, version: 1, clientId: null, voidReason: '', amountInWords: RW.amountInWords(x.amountPaise),
        }, x.v);
        s.vouchers.push(v);
        await H.audit({ state: s, user: u, meta: { device: o.device || 'Demo seed', ip: 'demo' } }, { at, entity: 'VOUCHER', entityId: v.id, entityLabel: v.number || 'Cash Received', action: 'CREATE', branchId: v.branchId, new: { number: v.number, type: v.type, date: v.date, partyName: v.partyName, amount: v.amountPaise / 100, transfer: x.label } });
        return v;
      };
      const sent1 = await put('u_main', { date: RW.addDays(today, -3), hour: 11, amountPaise: 2500000, label: 'Transfer to Indore', v: { number: vno('PAYMENT'), type: 'PAYMENT', date: RW.addDays(today, -3), partyName: 'Ravi Water Flow Pump - Indore · Rahul Patel', particulars: 'Cash transfer to Indore for the monthly float', amountPaise: 2500000, transfer: { toBranchId: 'br_indore', toUserId: 'u_indore', settled: false }, review: 'VALID', reviewReason: '', reviewedAt: iso(RW.addDays(today, -3), 15), reviewedBy: 'u_admin' } });
      await put('u_indore', { date: RW.addDays(today, -3), hour: 16, amountPaise: 2500000, label: 'Transfer from Main', v: { number: '', kind: 'RECEIVED', type: 'RECEIPT', date: RW.addDays(today, -3), partyName: 'Ravi Water Flow Pump · Suresh Mehta', particulars: 'Cash transfer received from head office (' + sent1.number + ')', amountPaise: 2500000, transfer: { fromBranchId: 'br_main', fromUserId: 'u_main', link: sent1.id } } });
      await put('u_main', { date: RW.addDays(today, -1), hour: 12, amountPaise: 1200000, label: 'Transfer to Nagpur', v: { number: vno('PAYMENT'), type: 'PAYMENT', date: RW.addDays(today, -1), partyName: 'Ravi Water Flow Pump - Nagpur', particulars: 'Cash transfer to Nagpur for stock purchase', amountPaise: 1200000, transfer: { toBranchId: 'br_nagpur', toUserId: '', settled: false } } });
    }

    /* -------- outstanding (dates relative to today so the demo never goes stale) */
    const os = (branchId, party, direction, amount, dueOffset, ref, settled, by) => {
      const o2 = {
        id: 'os_' + String(++s.seq.outstanding).padStart(3, '0'), branchId, partyName: party, direction, amountPaise: amount * 100, settledPaise: 0, dueDate: RW.addDays(today, dueOffset),
        reference: ref, notes: '', status: 'OPEN', createdBy: by, createdAt: iso(RW.addDays(today, Math.min(dueOffset, 0) - 30), 11), settlements: [],
      };
      if (settled) { o2.settledPaise = settled * 100; o2.settlements.push({ id: 'sl_' + o2.id, at: iso(RW.addDays(today, -4), 15), amountPaise: settled * 100, voucherNumber: '', note: 'Part payment received in cash', by }); }
      s.outstanding.push(o2);
    };
    os('br_main', 'Krishna Borewell Contractors', 'RECEIVABLE', 185000, -21, 'INV RWP/2627/0412', 60000, 'u_main');
    os('br_main', 'Rajkot Municipal Water Works', 'RECEIVABLE', 320000, -6, 'INV RWP/2627/0455', 0, 'u_mainadm');
    os('br_main', 'Shree Hari Agro Stores', 'RECEIVABLE', 72500, 3, 'INV RWP/2627/0481', 0, 'u_main');
    os('br_main', 'Kisan Spare Parts', 'PAYABLE', 96000, 5, 'PO-2627-118', 0, 'u_mainadm');
    os('br_main', 'Patel Transport Co.', 'PAYABLE', 38500, 15, 'Freight Sep-26', 0, 'u_main');
    os('br_indore', 'Malwa Irrigation Traders', 'RECEIVABLE', 154000, -12, 'INV IND/2627/0207', 40000, 'u_indore');
    os('br_indore', 'Narmada Farm Solutions', 'RECEIVABLE', 88000, 0, 'INV IND/2627/0233', 0, 'u_indadm');
    os('br_indore', 'Bhopal Motor Winding Works', 'PAYABLE', 52000, -3, 'Bill 7741', 0, 'u_indadm');
    os('br_indore', 'Om Packaging', 'PAYABLE', 14200, 18, 'Bill 2208', 0, 'u_indore');
    os('br_nagpur', 'Vidarbha Cotton Growers Society', 'RECEIVABLE', 241000, -9, 'INV NAG/2627/0118', 0, 'u_nagpur');
    os('br_nagpur', 'Orange City Irrigation', 'RECEIVABLE', 67500, 6, 'INV NAG/2627/0131', 25000, 'u_nagpur');
    os('br_nagpur', 'Butibori Steel Traders', 'PAYABLE', 118000, 11, 'PO-2627-044', 0, 'u_admin');

    /* -------- tours: plans and meetings (data only — no random numbers, so the vouchers above stay exactly as before) */
    if (o.tours !== false) {
      s.tours = s.tours || []; s.visits = s.visits || []; s.seq.tour = s.seq.tour || 0; s.seq.visit = s.seq.visit || 0;
      let pn = 0, photos = 0;
      const hex = (base, n) => (base + n).toString(16);
      const P = (name, address, phone, purpose) => ({ id: 'pp_' + hex(0xde000000, ++pn), name, address, phone, purpose });
      const who = (id) => s.users.find((x) => x.id === id);
      const stamp = (date, hm) => new Date(Date.parse(date + 'T' + hm + ':00+05:30')).toISOString();
      const tour = async (userId, title, purpose, startOff, endOff, status, days, extra) => {
        const u = who(userId), at = iso(RW.addDays(today, startOff - 4), 10);
        const t = Object.assign({
          id: 'tr_' + hex(0xde100000, s.seq.tour + 1), seq: ++s.seq.tour, userId, branchId: u.branchId, title, purpose, startDate: RW.addDays(today, startOff), endDate: RW.addDays(today, endOff), status,
          days: days.map((d) => ({ date: RW.addDays(today, d.off), place: d.place, notes: d.notes || '', parties: d.parties })), createdAt: at, updatedAt: at, version: 1, approval: 'PENDING',
        }, extra || {});
        s.tours.push(t);
        const parties = t.days.reduce((n, d) => n + d.parties.length, 0);
        const ctx = { state: s, user: u, meta: { device: o.device || 'Demo seed', ip: 'demo' } };
        await H.audit(ctx, { at, entity: 'TOUR', entityId: t.id, entityLabel: title, action: 'CREATE', branchId: t.branchId, new: { title, from: t.startDate, to: t.endDate, days: t.days.length, parties } });
        const rangeTxt = RW.fmtDateShort(t.startDate) + ' – ' + RW.fmtDateShort(t.endDate);
        if (t.approval === 'APPROVED') {
          // the main admin approved it a few hours after it was planned; the plan is final from then on
          t.approvedAt = iso(RW.addDays(today, startOff - 4), 15); t.approvedBy = 'u_admin';
          const sa = who('u_admin');
          await H.audit({ state: s, user: sa, meta: { device: o.device || 'Demo seed', ip: 'demo' } }, { at: t.approvedAt, entity: 'TOUR', entityId: t.id, entityLabel: title, action: 'APPROVE', branchId: t.branchId, old: { approval: 'PENDING' }, new: { approval: 'APPROVED' } });
        } else if (t.status === 'PLANNED') {
          H.notify(ctx, { at, kind: 'TOUR_PENDING', title: 'Tour plan waiting for approval', important: true, branchId: t.branchId, body: u.fullName + ' sent "' + title + '" (' + rangeTxt + ') — ' + t.days.length + ' days, ' + parties + ' parties to meet. Only the main admin can change or approve it.' });
        }
        return t;
      };
      const meet = async (t, off, hm, planned, f) => {
        const u = who(t.userId), date = RW.addDays(today, off), at = stamp(date, hm);
        const v = { id: 'vs_' + hex(0xde200000, s.seq.visit + 1), seq: ++s.seq.visit, tourId: t.id, plannedPartyId: planned ? planned.id : null, userId: t.userId, branchId: t.branchId, date, time: hm,
          partyName: f.name || planned.name, address: f.address || planned.address, phone: f.phone !== undefined ? f.phone : planned ? planned.phone : '', contactPerson: f.contact || '', notes: f.notes || '', photoIds: [], createdAt: at, updatedAt: at, version: 1 };
        if (f.geo) v.geo = { lat: f.geo[0], lng: f.geo[1], acc: f.acc || 14, at };          // where the phone was when the meeting was saved
        else v.geoStatus = f.geoStatus || 'DENIED';
        if (f.photo && o.makeReceiptImage && photos < 8) {
          const dataUrl = await o.makeReceiptImage({ seq: 900 + s.seq.visit, partyName: v.partyName, particulars: 'Order slip / visiting card', amountPaise: 2500000 + s.seq.visit * 137000, date }, s.branches.find((b) => b.id === v.branchId).name);
          if (dataUrl) {
            const id = 'ph_' + hex(0xde300000, ++photos);
            s.attachments.push({ id, visitId: v.id, tourId: t.id, branchId: v.branchId, userId: v.userId, name: 'meeting-' + v.seq + '.jpg', mime: dataUrl.slice(5, dataUrl.indexOf(';')), size: Math.floor((dataUrl.length * 3) / 4), addedAt: at, addedBy: u.id });
            v.photoIds.push(id);
            await server.helpers.storage.set('att:' + id, dataUrl);
          }
        }
        s.visits.push(v);
        await H.audit({ state: s, user: u, meta: { device: o.device || 'Demo seed', ip: 'demo' } }, { at, entity: 'VISIT', entityId: v.id, entityLabel: v.partyName + ' · ' + t.title, action: 'CREATE', branchId: v.branchId,
          new: { party: v.partyName, address: v.address, phone: v.phone, contact: v.contactPerson, date, time: hm, notes: v.notes, photos: v.photoIds.length } });
      };

      const mahakal = P('Mahakal Agro Traders', 'Ujjain Road, Dewas', '9826012345', 'Collect pending payment'), krishna = P('Shree Krishna Pump House', 'Freeganj, Ujjain', '9893022334', 'New order for 1 HP pumps');
      const jain = P('Jain Irrigation Stores', 'Station Road, Ratlam', '9425198765', 'Product demo'), ratlam = P('Ratlam Hardware Mart', 'Sailana Bus Stand Road, Ratlam', '07412 231456', 'Collect payment');
      const neemuch = P('Neemuch Agro Centre', 'Kanawati Road, Neemuch', '9926044556', 'Meet as a new dealer');
      const t1 = await tour('u_neha', 'Malwa dealer tour', 'Collect pending payments and meet new dealers', -1, 1, 'PLANNED', [
        { off: -1, place: 'Dewas, Ujjain', notes: 'Leave by 8 am', parties: [mahakal, krishna] }, { off: 0, place: 'Ratlam', parties: [jain, ratlam] }, { off: 1, place: 'Mandsaur, Neemuch', parties: [neemuch] }], { approval: 'APPROVED' });
      await meet(t1, -1, '10:40', mahakal, { contact: 'Mr. Sharma', notes: 'Promised ₹35,000 by Friday. Wants a better rate on 2 HP pumps.', photo: true, geo: [22.9688, 76.0521], acc: 9 });
      await meet(t1, -1, '14:15', krishna, { contact: 'Mr. Gupta', notes: 'Placed an order for 6 pumps (1 HP). Delivery next week.', photo: true, geo: [23.1741, 75.7912], acc: 12 });
      await meet(t1, 0, '11:05', jain, { contact: 'Mrs. Jain', notes: 'Demo done. Will decide after the monsoon season.', photo: true, geo: [23.3347, 75.0389], acc: 11 });
      await meet(t1, 0, '12:30', null, { name: 'Sai Electricals', address: 'Sailana Road, Ratlam', phone: '9300112233', notes: 'Walk-in. Asked for the price list.', geoStatus: 'DENIED' });   // location was blocked on the phone

      const ganesh = P('Shree Ganesh Pumps', 'Gondal Road, Rajkot', '9876501234', 'Collect payment'), borewell = P('Krishna Borewell Contractors', 'Aji GIDC, Rajkot', '9879012345', 'Collect ₹1,25,000');
      const patel = P('Patel Agro Traders', 'Digjam Circle, Jamnagar', '9898123456', 'New order'), morbi = P('Morbi Ceramics Pvt Ltd', 'Highway, Morbi', '02822 245678', 'Demo of the new motor');
      const t2 = await tour('u_main', 'Saurashtra payment collection', 'Collect old dues from the Rajkot, Jamnagar and Morbi parties', -14, -12, 'COMPLETED', [
        { off: -14, place: 'Rajkot', parties: [ganesh, borewell] }, { off: -13, place: 'Jamnagar', parties: [patel] }, { off: -12, place: 'Morbi', parties: [morbi] }], { approval: 'APPROVED', completedAt: iso(RW.addDays(today, -12), 19) });
      await meet(t2, -14, '10:15', ganesh, { contact: 'Mr. Mehta', notes: 'Paid ₹40,000. Balance next month.', photo: true, geo: [22.2810, 70.7770], acc: 16 });
      await meet(t2, -14, '15:30', borewell, { contact: 'Mr. Joshi', notes: 'Will send a cheque of ₹60,000 this week.', geo: [22.2860, 70.8060], acc: 20 });
      await meet(t2, -13, '11:20', patel, { contact: 'Mr. Patel', notes: 'Order for 10 pumps.', photo: true, geo: [22.4655, 70.0600], acc: 10 });
      await meet(t2, -12, '12:00', morbi, { contact: 'Mr. Dave', notes: 'Demo given to the plant engineer.', geo: [22.8260, 70.8450], acc: 18 });

      await tour('u_nagpur', 'Vidarbha dealer visit', 'Meet the Amravati and Akola dealers about the winter stock', 4, 5, 'PLANNED', [
        { off: 4, place: 'Amravati', parties: [P('Amravati Krishi Kendra', 'Rajkamal Chowk, Amravati', '9423123456', 'Winter stock')] }, { off: 5, place: 'Akola', parties: [P('Akola Irrigation Store', 'Tower Chowk, Akola', '9822334455', 'Collect payment')] }]);
      await tour('u_indadm', 'Bhopal stockist review', 'Review sales with the Bhopal stockists', 9, 9, 'CANCELLED', [
        { off: 9, place: 'Bhopal', parties: [P('MP Pump Centre', 'Hamidia Road, Bhopal', '9406123456', 'Sales review')] }], { cancelReason: 'Stockist meeting was moved to next month' });
    }

    s.rev = 1;
    await server.replaceState(s);

    /* -------- live locations and the routes of today and yesterday (demo: "minutes ago" keeps the map alive) */
    if (o.locations !== false) {
      const nowMs = Date.now(), rnd = (i) => Math.sin(i * 12.9898) * 43758.5453 % 1;
      const route = (wps, ms0, ms1, n) => {
        if (ms1 <= ms0) ms0 = ms1 - 3600000;
        const out = [];
        for (let i = 0; i <= n; i++) {
          const pos = (i / n) * (wps.length - 1), k = Math.min(wps.length - 2, Math.floor(pos)), fr = pos - k;
          out.push([Math.round(ms0 + ((ms1 - ms0) * i) / n), +(wps[k][0] + (wps[k + 1][0] - wps[k][0]) * fr + rnd(i) * 0.0008).toFixed(6), +(wps[k][1] + (wps[k + 1][1] - wps[k][1]) * fr + rnd(i + 99) * 0.0008).toFixed(6), 12 + Math.round(Math.abs(rnd(i + 7)) * 20)]);
        }
        return out;
      };
      const at = (day, hm) => Date.parse(day + 'T' + hm + ':00+05:30');
      const yday = RW.addDays(today, -1);
      const endToday = Math.max(at(today, '06:00'), Math.min(nowMs - 60000, at(today, '17:30')));
      const doc = { users: {
        u_neha: { lat: 23.3340, lng: 75.0380, acc: 12, at: new Date(nowMs - 60000).toISOString(), perm: 'GRANTED', consent: 'GIVEN', consentAt: iso(RW.addDays(today, -5), 10), demoAgeMin: 1 },
        u_main: { lat: 22.3041, lng: 70.8019, acc: 18, at: new Date(nowMs - 120000).toISOString(), perm: 'GRANTED', consent: 'GIVEN', consentAt: iso(RW.addDays(today, -9), 10), demoAgeMin: 2 },
        u_mainadm: { lat: 22.3037, lng: 70.8025, acc: 25, at: new Date(nowMs - 11 * 60000).toISOString(), perm: 'GRANTED', consent: 'GIVEN', consentAt: iso(RW.addDays(today, -9), 10), demoAgeMin: 11 },
        u_indore: { lat: 22.7533, lng: 75.8937, acc: 15, at: new Date(nowMs - 60000).toISOString(), perm: 'GRANTED', consent: 'GIVEN', consentAt: iso(RW.addDays(today, -8), 10), demoAgeMin: 1 },
        u_indadm: { lat: 22.7196, lng: 75.8577, acc: 30, at: new Date(nowMs - 180 * 60000).toISOString(), perm: 'DENIED', permAt: iso(today, 9), consent: 'GIVEN', consentAt: iso(RW.addDays(today, -8), 10), demoAgeMin: 180 },
        u_nagpur: { lat: 21.1458, lng: 79.0882, acc: 20, at: new Date(nowMs - 120000).toISOString(), perm: 'GRANTED', consent: 'GIVEN', consentAt: iso(RW.addDays(today, -7), 10), demoAgeMin: 2 },
      } };
      await H.storage.set('loc', doc);
      await H.storage.set('trail:' + yday, {
        u_neha: route([[22.7196, 75.8577], [22.9688, 76.0521], [23.1741, 75.7912], [23.4560, 75.4180], [23.3340, 75.0380]], at(yday, '08:00'), at(yday, '19:30'), 70),
        u_main: route([[22.3039, 70.8022], [22.3100, 70.8120], [22.3039, 70.8022]], at(yday, '10:00'), at(yday, '18:00'), 14),
      });
      await H.storage.set('trail:' + today, {
        u_neha: route([[23.3340, 75.0380], [23.3347, 75.0389], [23.3320, 75.0300], [23.3340, 75.0380]], at(today, '09:00'), endToday, 40),
        u_main: route([[22.3039, 70.8022], [22.3041, 70.8019]], at(today, '09:30'), endToday, 8),
        u_indore: route([[22.7196, 75.8577], [22.7390, 75.8800], [22.7533, 75.8937]], at(today, '09:15'), endToday, 24),
        u_nagpur: route([[21.1458, 79.0882], [21.1500, 79.0950], [21.1458, 79.0882]], at(today, '09:40'), endToday, 12),
      });
    }

    /* -------- a couple of real admin actions so audit log, timeline and notifications have content */
    if (o.adminActions !== false) {
      const login = await server.call(null, 'auth.login', { branchCode: 'MAIN', identifier: 'admin', password: PW.admin }, { device: 'Demo seed' });
      const t = login.token;
      const st = await server.load();
      const target = st.vouchers.filter((v) => v.userId === 'u_indore' && v.type === 'PAYMENT' && v.status === 'ACTIVE' && v.date <= RW.addDays(today, -3)).pop();
      if (target) await server.call(t, 'vouchers.edit', { id: target.id, patch: { amount: (target.amountPaise + 5000) / 100, particulars: target.particulars + ' (bill no. 4471)' }, reason: 'Amount corrected as per supplier bill' }, { device: 'Demo seed' });
      const dup = st.vouchers.filter((v) => v.userId === 'u_nagpur' && v.status === 'ACTIVE' && v.date <= RW.addDays(today, -2) && v.id !== (target && target.id)).pop();
      if (dup) await server.call(t, 'vouchers.void', { id: dup.id, reason: 'Duplicate entry – same bill recorded twice' }, { device: 'Demo seed' });
      await server.call(t, 'auth.logout', {}, { device: 'Demo seed' });
    }
    const final = await server.load();
    return { branches: final.branches.length, users: final.users.length, vouchers: final.vouchers.length, attachments: final.attachments.length, outstanding: final.outstanding.length, audit: final.audit.length, passwords: PW };
  };
})(typeof window !== 'undefined' ? window : globalThis);
