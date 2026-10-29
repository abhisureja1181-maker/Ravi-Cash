const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs'), path = require('path'), os = require('os'), cp = require('child_process');
const RW = require('./load.js');
require('../app/js/export.js');

test('CSV neutralises formula injection and quotes properly', () => {
  const csv = RW.buildCsv([{ key: 'a', label: 'A' }, { key: 'b', label: 'B' }], [{ a: '=HYPERLINK("x")', b: 'He said "hi", ok' }, { a: -500, b: '+91 98' }]);
  assert.ok(csv.startsWith('﻿A,B\r\n'));
  assert.ok(csv.includes("\"'=HYPERLINK(\"\"x\"\")\""));
  assert.ok(csv.includes('"He said ""hi"", ok"'));
  assert.ok(csv.includes('-500,'));
  assert.ok(csv.includes("'+91 98"));
});

test('xlsx opens in openpyxl with correct numbers, dates and totals formula', async () => {
  const server = RW.createServer({ storage: new RW.MemoryStorage(), hashIterations: 1000 });
  await RW.seedDemo(server, {});
  const t = (await server.call(null, 'auth.login', { branchCode: 'MAIN', identifier: 'admin', password: 'Admin@1234' })).token;
  const ex = await server.call(t, 'export.vouchers', { filters: { branchId: 'br_indore', type: 'PAYMENT' } });
  const bytes = await RW.buildXlsx([{
    name: 'Vouchers', title: 'All Vouchers', subtitle: ['Branch: Indore', 'Type: Cash Payment'], columns: RW.VOUCHER_COLUMNS, rows: ex.rows,
    totals: { label: 'TOTAL', sum: ['cashIn', 'cashOut'] },
  }]);
  const f = path.join(os.tmpdir(), 'rw-test.xlsx');
  fs.writeFileSync(f, bytes);
  const py = `
import openpyxl, json
wb = openpyxl.load_workbook(r'${f}')
ws = wb['Vouchers']
rows = list(ws.iter_rows(values_only=True))
head = [i for i,r in enumerate(rows) if r[0]=='Voucher No.'][0]
data = rows[head+1:-1]; tot = rows[-1]
print(json.dumps({'title': rows[0][0], 'n': len(data), 'first': [str(x) for x in data[0][:3]], 'cashOut': data[0][8], 'totalFormula': tot[8], 'sum': round(sum(r[8] or 0 for r in data),2), 'filter': ws.auto_filter.ref, 'freeze': ws.freeze_panes}))
`;
  const out = JSON.parse(cp.execSync('python3 -c "' + py.replace(/"/g, '\\"') + '"').toString());
  assert.equal(out.title, 'All Vouchers');
  assert.equal(out.n, ex.rows.length);
  assert.match(out.first[0], /^CPV-/);
  assert.match(out.first[2], /^\d{4}-\d{2}-\d{2}/); // real date cell
  assert.ok(out.cashOut > 0);
  assert.match(out.totalFormula, /^=SUM\(I\d+:I\d+\)$/);
  assert.equal(out.sum, ex.totals.outPaise / 100);
  assert.ok(out.freeze && out.filter);
});
