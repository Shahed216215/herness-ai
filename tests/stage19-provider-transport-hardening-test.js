"use strict";

const fs = require("node:fs");
const assert = require("node:assert/strict");

const wrapper = fs.readFileSync(
  "services/security/secure-provider-request.js", "utf8"
);

const providers = [
  "providers/openrouter.js",
  "providers/deepseek.js",
  "providers/huggingface.js"
];

console.log("=== Provider transport delegation ===");

for (const file of providers) {
  const source = fs.readFileSync(file, "utf8");

  assert.ok(source.includes("../services/security/secure-provider-request"),
    `${file}: secure wrapper import missing`);
  assert.match(source, /secureProviderRequest\s*\(/,
    `${file}: wrapper call missing`);
  assert.doesNotMatch(source,
    /\bfetch\s*\(|\baxios\s*\.\s*(?:request|post|get)\s*\(/,
    `${file}: direct network call remains`);

  console.log("PASS:", file);
}

console.log("=== Central wrapper contract ===");

assert.match(wrapper, /const\s+TIMEOUT_MS\s*=\s*30000/,
  "finite 30-second timeout constant missing");
assert.match(wrapper, /timeout\s*:\s*TIMEOUT_MS/,
  "request does not use timeout constant");
assert.match(wrapper, /maxRedirects\s*:\s*0/,
  "automatic redirects must be disabled");
assert.match(wrapper, /proxy\s*:\s*false/,
  "implicit proxy routing must be disabled");
assert.match(wrapper, /createPinnedLookup\s*\(/,
  "pinned DNS lookup implementation missing");
assert.match(wrapper, /const\s+lookup\s*=\s*createPinnedLookup\s*\(/,
  "pinned lookup must be included in agent options");
assert.match(wrapper, /https\.Agent\s*\(/,
  "HTTPS agent missing");
assert.match(wrapper, /rejectUnauthorized\s*:\s*true/,
  "TLS certificate verification must remain enabled");
assert.match(wrapper, /maxContentLength\s*:\s*MAX_RESPONSE_BYTES/,
  "response size limit missing");
assert.match(wrapper, /maxBodyLength\s*:\s*MAX_RESPONSE_BYTES/,
  "request body size limit missing");
assert.match(wrapper, /if\s*\(!used\)/,
  "must verify pinned DNS lookup was actually used");
assert.match(wrapper, /agent\.destroy\s*\(/,
  "transport agent cleanup missing");

console.log("PASS: finite timeout");
console.log("PASS: redirects disabled");
console.log("PASS: proxy disabled");
console.log("PASS: pinned lookup and agent");
console.log("PASS: TLS verification");
console.log("PASS: request/response size limits");
console.log("PASS: pinned lookup use check");
console.log("PASS: agent cleanup");
console.log("STAGE19_PROVIDER_TRANSPORT_HARDENING=PASS");
