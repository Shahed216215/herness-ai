"use strict";
const assert = require("node:assert/strict");
const { createPinnedLookup } =
  require("../services/security/secure-provider-request");

const records = [
  { address: "2001:db8::1", family: 6 },
  { address: "93.184.216.34", family: 4 },
  { address: "2001:db8::2", family: 6 },
  { address: "192.0.2.20", family: 4 }
];
let passed = 0;

function test(name, fn) {
  try {
    fn();
    passed++;
    console.log("PASS=" + name);
  } catch (e) {
    console.error("FAIL=" + name + " " +
      String(e.message || e).replace(/[\r\n]+/g, " ").slice(0, 120));
  }
}

function invoke(lookup, hostname, options) {
  let result;
  lookup(hostname, options, (...args) => { result = args; });
  return result;
}

const lookup = createPinnedLookup("provider.example", records);

test("family4_returns_pinned_ipv4", () => {
  const r = invoke(lookup, "provider.example", { family: 4 });
  assert.equal(r[0], null);
  assert.equal(r[1], "93.184.216.34");
  assert.equal(r[2], 4);
});

test("family6_returns_pinned_ipv6", () => {
  const r = invoke(lookup, "provider.example", { family: 6 });
  assert.equal(r[0], null);
  assert.equal(r[1], "2001:db8::1");
  assert.equal(r[2], 6);
});

test("all_family4_filters_snapshot", () => {
  const r = invoke(lookup, "provider.example", { family: 4, all: true });
  assert.equal(r[0], null);
  assert.deepEqual(r[1].map(x => x.family), [4, 4]);
});

test("all_family6_filters_snapshot", () => {
  const r = invoke(lookup, "provider.example", { family: 6, all: true });
  assert.equal(r[0], null);
  assert.deepEqual(r[1].map(x => x.family), [6, 6]);
});

test("missing_requested_family_rejected", () => {
  const only4 = createPinnedLookup("provider.example", [
    { address: "93.184.216.34", family: 4 }
  ]);
  assert.ok(invoke(only4, "provider.example", { family: 6 })[0] instanceof Error);
});

test("unspecified_family_preserves_snapshot_order", () => {
  const r = invoke(lookup, "provider.example", {});
  assert.equal(r[0], null);
  assert.equal(r[1], "2001:db8::1");
  assert.equal(r[2], 6);
});

test("unexpected_hostname_rejected", () => {
  assert.ok(invoke(lookup, "attacker.example", { family: 4 })[0] instanceof Error);
});

console.log("LOOKUP_ASSERTIONS=" + passed + "/7");
if (passed !== 7) process.exitCode = 1;
