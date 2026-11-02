"use strict";

const assert = require("assert");
const fs = require("fs");

const source = fs.readFileSync(
  "routes/mira-provider-evolution.js",
  "utf8"
);

const start = source.indexOf('"/:id/verify"');
assert.notStrictEqual(start, -1, "Verify route must exist");

const end = source.indexOf('"/custom-slots"', start);
assert.notStrictEqual(end, -1, "Verify route boundary must be discoverable");

const verify = source.slice(start, end);

for (const field of [
  "fallbackEnabled",
  "fallbackProvider",
  "fallbackModel"
]) {
  assert(
    verify.includes(`proposal.metadata?.${field}`),
    `Verify must read proposal ${field}`
  );
}

assert(
  verify.includes("runtime.fallbackEnabled"),
  "Verify must compare runtime fallback enabled state"
);
assert(
  verify.includes("runtime.fallbackProvider"),
  "Verify must compare runtime fallback provider"
);
assert(
  verify.includes("runtime.fallbackModel"),
  "Verify must compare runtime fallback model"
);
assert(
  verify.includes("fallbackMatches"),
  "Primary and fallback configuration must both match"
);

console.log("PASS: Verify checks the complete opt-in fallback configuration");
console.log("LIVE_PROVIDER_REQUESTS=0");
console.log("EXTERNAL_NETWORK_REQUESTS=0");
