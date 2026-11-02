"use strict";
const assert = require("node:assert/strict");
const { createPinnedLookup } = require("../services/security/doctor-pinned-lookup");

function lookup(fn, host, options) {
  return new Promise(resolve => fn(host, options, (...args) => resolve(args)));
}

(async () => {
  const records = [
    { address: "8.8.8.8", family: 4 },
    { address: "2001:4860:4860::8888", family: 6 }
  ];
  const fn = createPinnedLookup("api.groq.com", records);

  let r = await lookup(fn, "api.groq.com", { family: 4 });
  assert.equal(r[0], null);
  assert.equal(r[1], "8.8.8.8");
  assert.equal(r[2], 4);

  r = await lookup(fn, "api.groq.com", { family: 6 });
  assert.equal(r[0], null);
  assert.equal(r[1], "2001:4860:4860::8888");
  assert.equal(r[2], 6);

  r = await lookup(fn, "api.groq.com", { all: true });
  assert.equal(r[0], null);
  assert.equal(r[1].length, 2);

  r = await lookup(fn, "attacker.example", {});
  assert.ok(r[0] instanceof Error);

  assert.throws(() => createPinnedLookup("api.groq.com", []), /resolved addresses/);
  console.log("PASS: doctor pinned lookup IPv4/IPv6/all/hostname/empty cases");
})().catch(e => {
  console.error(e.stack || e);
  process.exitCode = 1;
});
