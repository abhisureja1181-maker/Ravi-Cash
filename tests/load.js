// Loads the browser scripts into Node (they attach to globalThis.RW).
const path = require('path');
const files = ['util', 'store', 'server-core', 'server-vouchers', 'server-admin', 'server-erase', 'server-tours', 'server-location', 'server-backup', 'seed'];
for (const f of files) require(path.join(__dirname, '..', 'app', 'js', f + '.js'));
module.exports = globalThis.RW;
