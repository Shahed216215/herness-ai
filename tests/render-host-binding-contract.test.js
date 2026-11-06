"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const source = fs.readFileSync(
  path.join(__dirname, "..", "server.js"),
  "utf8"
);
const hostDeclaration = source.match(/^const HOST = (.+);$/m);
assert.ok(hostDeclaration, "server.js must declare HOST");

const expression = hostDeclaration[1];
function resolveHost(env) {
  return vm.runInNewContext(expression, { process: { env } });
}

assert.equal(resolveHost({}), "127.0.0.1", "local default must remain loopback-only");
assert.equal(resolveHost({ RENDER: "true" }), "0.0.0.0", "Render must bind all interfaces");
assert.equal(resolveHost({ RENDER: "true", HOST: "127.0.0.1" }), "127.0.0.1",
  "explicit HOST override must take precedence");
assert.equal(resolveHost({ HOST: "0.0.0.0" }), "0.0.0.0",
  "explicit HOST override must work outside Render too");
assert.match(source, /^const PORT = Number\(process\.env\.PORT\) \|\| 3000;$/m,
  "platform PORT environment variable must remain supported");

console.log("RENDER_HOST_BINDING_CONTRACT=PASS");
console.log("LOCAL_DEFAULT_LOOPBACK=PASS");
console.log("RENDER_PUBLIC_BIND=PASS");
console.log("HOST_OVERRIDE=PASS");
console.log("PORT_ENV_COMPATIBILITY=PASS");
console.log("NETWORK_REQUESTS=0");
