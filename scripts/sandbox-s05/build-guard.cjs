/* eslint-disable @typescript-eslint/no-require-imports -- CJS --require preload must run before application imports. */
// Defense in depth inside the S03 private network namespace, inherited by Node workers.
const fs = require('node:fs');
const Module = require('node:module');
const deny = () => {
  fs.appendFileSync(process.env.S05_DENIAL_JOURNAL, 'DENIED\n', { mode: 0o600 });
  throw new Error('S05_BUILD_IO_DENIED');
};
require('node:net').Socket.prototype.connect = deny;
require('node:tls').connect = deny;
require('node:dgram').createSocket = deny;
require('node:dns').lookup = deny;
globalThis.fetch = deny;
const load = Module._load;
Module._load = function (id, ...args) {
  const value = load.call(this, id, ...args);
  if (/^mysql2(?:\/promise)?$/.test(id)) {
    for (const key of ['createPool', 'createConnection']) if (value[key]) value[key] = deny;
  }
  return value;
};
