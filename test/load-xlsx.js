// Loads the vendored bundle the way the browser does (plain script, global XLSX).
// Under require() it reaches for ./cpexcel.js, which is only needed for legacy codepages we never write.
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const file = path.join(__dirname, '..', 'vendor', 'xlsx-js-style-1.2.0.min.js');
const sandbox = { Buffer, Uint8Array, ArrayBuffer, DataView, Date, Math, console };
sandbox.self = sandbox;
vm.runInNewContext(fs.readFileSync(file, 'utf8'), sandbox, { filename: file });

module.exports = sandbox.XLSX;
