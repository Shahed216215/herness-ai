"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const roots = ["services", "routes", "tools", "providers", "scripts"];
const files = [];

function walk(p) {
  if (!fs.existsSync(p)) return;
  const stat = fs.statSync(p);
  if (stat.isFile()) {
    if (p.endsWith(".js")) files.push(p);
    return;
  }
  for (const name of fs.readdirSync(p)) walk(path.join(p, name));
}
roots.forEach(walk);

const rawSink = /https?\.request\s*\(|https?\.get\s*\(|axios(?:\.request|\.(?:get|post|put|patch|delete))?\s*\(|\bfetch\s*\(|new WebSocket\s*\(|net\.connect\s*\(|tls\.connect\s*\(/g;
const hits = [];

for (const file of files) {
  const source = fs.readFileSync(file, "utf8");
  for (const match of source.matchAll(rawSink)) {
    hits.push({ file, index: match.index, expression: match[0] });
  }
}

const expected = new Set([
  "services/security/secure-provider-request.js",
  "scripts/mira-doctor.js",
  "tools/mira-server-control.js"
]);
const actual = new Set(hits.map(hit => hit.file));

for (const file of actual) {
  assert.ok(expected.has(file), `Unreviewed direct outbound sink: ${file}`);
}
for (const file of expected) {
  assert.ok(actual.has(file), `Expected direct outbound sink not found: ${file}`);
}

const wrapper = fs.readFileSync("services/security/secure-provider-request.js", "utf8");
const doctor = fs.readFileSync("scripts/mira-doctor.js", "utf8");
const controller = fs.readFileSync("tools/mira-server-control.js", "utf8");
assert.match(wrapper, /maxRedirects\s*:\s*0/);
assert.match(wrapper, /rejectUnauthorized\s*:\s*true/);
assert.match(wrapper, /createPinnedLookup/);
assert.match(doctor, /createPinnedLookup\("api\.groq\.com"/);
assert.match(doctor, /servername\s*:\s*"api\.groq\.com"/);
assert.match(controller, /hostname:\s*"127\.0\.0\.1"/);
assert.match(controller, /port:\s*PORT/);
assert.match(controller, /path:\s*"\/"/);

console.log(`OUTBOUND_DIRECT_SINKS=${hits.length}`);
for (const hit of hits) console.log(`REVIEWED_SINK=${hit.file}:${hit.expression}`);
console.log("STAGE19_OUTBOUND_SINK_INVENTORY=PASS");
console.log("NOTE=Static inventory only; this is not complete runtime coverage proof.");
