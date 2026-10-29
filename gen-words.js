// Prints "paise<TAB>words" lines using the application's own amountInWords(), for the SQL parity test.
require('../../tests/load.js');
const RW = globalThis.RW;
const vals = new Set([1, 5, 9, 10, 11, 19, 20, 21, 50, 99, 100, 101, 110, 199, 2550, 10100, 100000, 100001, 123456, 500000, 1000000, 9999999, 10000000,
  12550000, 12550050, 100000000, 123456789, 1000000000, 1234567800, 1000000099, 9999999999, 10000000000, 99999999999, 1234567890123, 99999999999999]);
let x = 123456789;
const rnd = () => (x = (x * 1103515245 + 12345) % 2147483648) / 2147483648;
for (let i = 0; i < 400; i++) vals.add(1 + Math.floor(Math.pow(10, rnd() * 12.5)));
for (const v of vals) if (v > 0 && v < 1e14) console.log(v + '\t' + RW.amountInWords(v));
