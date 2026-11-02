"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

const serverPath = require.resolve("../server");
const serverSource = fs.readFileSync(serverPath, "utf8");

const start = serverSource.indexOf(
  "function requireAdminPermission(permission) {"
);
const end = serverSource.indexOf(
  "\nfunction buildMemoryStats()",
  start
);

assert.notEqual(start, -1, "admin middleware function must exist");
assert.notEqual(end, -1, "admin middleware end marker must exist");

const middlewareSource = serverSource.slice(start, end);
assert.match(middlewareSource, /Permission denied\./);
assert.match(middlewareSource, /Admin access required\./);

const sandbox = {
  module: { exports: null },
  ROLES: { ADMIN: "admin" },
  sessionIdentity(req) {
    return req.__sessionIdentity || null;
  },
  authenticate(req, res, next) {
    if (req.__auth) {
      req.role = req.__auth.role;
      if (Object.hasOwn(req.__auth, "permissions")) {
        req.permissions = req.__auth.permissions;
      }
    }
    next();
  },
  getPermissions(role) {
    return role === "admin" ? ["SYSTEM_ADMIN"] : [];
  }
};

vm.runInNewContext(
  middlewareSource + "\nmodule.exports = requireAdminPermission;",
  sandbox,
  { filename: "server.js:requireAdminPermission" }
);

const requireAdminPermission = sandbox.module.exports;
const middleware = requireAdminPermission("SYSTEM_ADMIN");

function check(name, identity, auth, expectedStatus, expectedNext) {
  const req = {
    __sessionIdentity: identity,
    __auth: auth
  };

  const res = {
    code: 200,
    body: null,
    status(code) {
      this.code = code;
      return this;
    },
    json(body) {
      this.body = body;
      return this;
    }
  };

  let nextCalls = 0;
  middleware(req, res, () => {
    nextCalls += 1;
  });

  assert.equal(res.code, expectedStatus, name + ": HTTP status");
  assert.equal(nextCalls, expectedNext ? 1 : 0, name + ": next calls");

  if (expectedStatus === 403) {
    assert.equal(res.body.success, false, name + ": denial response");
  }

  console.log("PASS: " + name);
}

check(
  "session user denied even if permission is supplied",
  { role: "user", permissions: ["SYSTEM_ADMIN"] },
  null,
  403,
  false
);

check(
  "session admin without required permission denied",
  { role: "admin", permissions: [] },
  null,
  403,
  false
);

check(
  "session admin with required permission allowed",
  { role: "admin", permissions: ["SYSTEM_ADMIN"] },
  null,
  200,
  true
);

check(
  "authenticated non-admin denied",
  null,
  { role: "user", permissions: [] },
  403,
  false
);

check(
  "authenticated admin with explicit empty permissions denied",
  null,
  { role: "admin", permissions: [] },
  403,
  false
);

check(
  "authenticated admin uses role permissions when not explicitly supplied",
  null,
  { role: "admin" },
  200,
  true
);

assert.match(
  serverSource,
  /app\.use\(\s*["']\/api\/admin\/mira-provider-evolution["']\s*,\s*requireAdminPermission\(PERMISSIONS\.SYSTEM_ADMIN\)\s*,\s*miraProviderEvolutionRouter\s*\)/
);
console.log("PASS: provider route is mounted behind SYSTEM_ADMIN middleware");

console.log("ADMIN_PERMISSION_MIDDLEWARE_OFFLINE_TEST=PASS");
console.log("NETWORK_REQUESTS=0");
console.log("PROVIDER_ACTIVATION=NOT_RUN");
console.log("SCOPE=EXTRACTED_MIDDLEWARE_WITH_MOCK_AUTH_DEPENDENCIES");
