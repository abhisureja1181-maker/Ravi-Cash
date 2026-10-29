// Generates sample PDFs for visual inspection:  node tests/pdf-sample.js <outdir>
const fs = require('fs'), path = require('path');
const RW = require('./load.js');
require('../app/js/pdf.js'); require('../app/js/voucher.js'); require('../app/js/pdf-docs.js');
RW.assetLoader = async (p) => new Uint8Array(fs.readFileSync(path.join(__dirname, '..', 'app', p)));
(async () => {
  const out = process.argv[2] || '.';
  const server = RW.createServer({ storage: new RW.MemoryStorage(), hashIterations: 1000 });
  await RW.seedDemo(server, {});
  const tok = (await server.call(null, 'auth.login', { branchCode: 'INDORE', identifier: 'indore.accountant', password: 'Ravi@1234' })).token;
  const company = (await server.call(tok, 'settings.get', {})).company;
  const created = await server.call(tok, 'vouchers.create', { type: 'PAYMENT', partyName: 'Shree Ganesh Hardware & Sanitary Traders', particulars: 'Purchase of GI pipes, sockets and fittings for the Dewas road borewell installation site as per bill no. 4471 dated 10 Oct 2026', amount: '12550.50' });
  const d = await server.call(tok, 'vouchers.get', { id: created.voucher.id });
  const jpeg = new Uint8Array(fs.readFileSync(path.join(out, 'receipt.jpg')));
  const pdf = await RW.buildVoucherPdf({ voucher: d.voucher, company }, { images: [{ name: 'receipt-photo.jpg', jpeg }, { name: 'bill.pdf', jpeg: null }] });
  fs.writeFileSync(path.join(out, 'voucher.pdf'), pdf);
  const rec = await server.call(tok, 'vouchers.create', { type: 'RECEIPT', partyName: 'Kisan Agro Service', particulars: 'Cash received against Invoice RWP/2627/0412', amount: '125500' });
  fs.writeFileSync(path.join(out, 'receipt-voucher.pdf'), await RW.buildVoucherPdf({ voucher: rec.voucher, company }));
  const st = await server.call(tok, 'statements.generate', { period: 'MONTH' });
  fs.writeFileSync(path.join(out, 'statement.pdf'), await RW.buildStatementPdf(st));
  const yr = await server.call(tok, 'statements.generate', { period: 'YEAR' });
  fs.writeFileSync(path.join(out, 'statement-year.pdf'), await RW.buildStatementPdf(yr));
  console.log('month rows', st.rows.length, 'year rows', yr.rows.length);
})().catch((e) => { console.error(e); process.exit(1); });
