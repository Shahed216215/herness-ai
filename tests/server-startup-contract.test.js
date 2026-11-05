"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

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
const hostDeclaration = source.indexOf(
  'const HOST = IS_PRODUCTION ? "0.0.0.0" : "127.0.0.1";'
);
const portDeclaration = source.indexOf(
  'const PORT = Number(process.env.PORT) || 3000;'
);
assert.notEqual(productionModeDeclaration, -1, "Production mode must be declared.");
assert.notEqual(hostDeclaration, -1, "Server host must be declared.");
assert.notEqual(portDeclaration, -1, "Server port must be declared.");
assert.ok(
  productionModeDeclaration < hostDeclaration &&
  productionModeDeclaration < portDeclaration,
  "IS_PRODUCTION must be initialized before HOST and PORT to avoid the const temporal dead zone."
);

assert.match(
  source,
  /const HOST\s*=\s*IS_PRODUCTION\s*\?\s*["']0\.0\.0\.0["']\s*:\s*["']127\.0\.0\.1["']\s*;/,
  "Production must bind to the Render-reachable interface while local development remains loopback-only."
);
assert.match(source, /const PORT\s*=\s*Number\(process\.env\.PORT\)\s*\|\|\s*3000;/);

console.log("SERVER_JAVASCRIPT_SYNTAX=PASS");
console.log("FACEBOOK_GROUP_ROUTE_SINGLE_DECLARATION=PASS");
console.log("FACEBOOK_GROUP_ROUTE_SINGLE_MOUNT=PASS");
console.log("PRODUCTION_MODE_INITIALIZATION_ORDER=PASS");
console.log("PRODUCTION_BIND_HOST_CONTRACT=PASS");
console.log("LOCAL_LOOPBACK_BIND_CONTRACT=PASS");
console.log("SERVER_STARTUP_CONTRACT_TEST=PASS");
console.log("LIVE_PROVIDER_REQUESTS=0");
console.log("PRODUCTION_SERVER_START=0");