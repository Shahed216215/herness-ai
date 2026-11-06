"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const source = fs.readFileSync(
  path.join(__dirname, "..", "server.js"),
  "utf8"
);

const hostDeclaration = source.match(/^const HOST = (.+);$/m);
assert.ok(hostDeclaration, "server.js must declare HOST");

const expression = hostDeclaration[1];
assert.match(expression, /process\\.env\\.HOST/, "explicit HOST override must be supported");
assert.match(
  expression,
  /process\\.env\\.RENDER\\s*\\?\\s*"0\\.0\\.0\\.0"\\s*:\\s*"127\\.0\\.0\\.1"/,
  "Render must bind publicly while local default remains loopback-only"
);

console.log("RENDER_HOST_BINDING_CONTRACT=PASS");
console.log("LOCAL_DEFAULT_LOOPBACK=PASS");
console.log("RENDER_PUBLIC_BIND=PASS");
console.log("NETWORK_REQUESTS=0");
