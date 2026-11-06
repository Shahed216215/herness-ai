"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const { resolveServerBindHost } = require("../services/mira-server-bind-host");

const root = path.resolve(__dirname, "..");
const serverPath = path.join(root, "server.js");
const source = fs.readFileSync(serverPath, "utf8");

execFileSync(process.execPath, ["--check", serverPath], {
  cwd: root,
  stdio: "pipe"
});

const declarationCount = (
  source.match(/const\s+registerFacebookGroupMemoryImportRoutes\s*=/g) || []
).length;
const mountCount = (
  source.match(/registerFacebookGroupMemoryImportRoutes\(\s*app,\s*requireAdminPermission,\s*PERMISSIONS\s*\);/g) || []
).length;

assert.equal(declarationCount, 1, "Facebook Group import route must be declared once.");
assert.equal(mountCount, 1, "Facebook Group import route must be mounted once.");

const productionModeDeclaration = source.indexOf(
  'const IS_PRODUCTION = process.env.NODE_ENV === "production";'
);
const bindHostResolverImport = source.indexOf(
  'const { resolveServerBindHost } = require("./services/mira-server-bind-host");'
);
const hostDeclaration = source.indexOf(
  "const HOST = resolveServerBindHost(process.env);"
);
const portDeclaration = source.indexOf(
  'const PORT = Number(process.env.PORT) || 3000;'
);
assert.notEqual(productionModeDeclaration, -1, "Production mode must be declared.");
assert.notEqual(bindHostResolverImport, -1, "Server bind-host resolver must be imported.");
assert.notEqual(hostDeclaration, -1, "Server host must be declared through the shared resolver.");
assert.notEqual(portDeclaration, -1, "Server port must be declared.");
assert.ok(
  bindHostResolverImport < productionModeDeclaration &&
  productionModeDeclaration < hostDeclaration &&
  hostDeclaration < portDeclaration,
  "IS_PRODUCTION must be initialized before HOST and PORT to avoid the const temporal dead zone."
);

assert.match(
  source,
  /const HOST\\s*=\\s*resolveServerBindHost\\(process\\.env\\)\\s*;/,
  "Server must use the shared environment-aware bind-host resolver."
);
assert.match(source, /const PORT\s*=\s*Number\(process\.env\.PORT\)\s*\|\|\s*3000;/);

assert.equal(resolveServerBindHost({ NODE_ENV: "production" }), "0.0.0.0");
assert.equal(resolveServerBindHost({ NODE_ENV: "development" }), "127.0.0.1");
assert.equal(resolveServerBindHost({}), "127.0.0.1");

console.log("SERVER_JAVASCRIPT_SYNTAX=PASS");
console.log("FACEBOOK_GROUP_ROUTE_SINGLE_DECLARATION=PASS");
console.log("FACEBOOK_GROUP_ROUTE_SINGLE_MOUNT=PASS");
console.log("PRODUCTION_MODE_INITIALIZATION_ORDER=PASS");
console.log("PRODUCTION_BIND_HOST_CONTRACT=PASS");
console.log("LOCAL_LOOPBACK_BIND_CONTRACT=PASS");
console.log("SERVER_STARTUP_CONTRACT_TEST=PASS");
console.log("LIVE_PROVIDER_REQUESTS=0");
console.log("PRODUCTION_SERVER_START=0");