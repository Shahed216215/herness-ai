"use strict";

const assert = require("node:assert/strict");
const { actorIdentity } = require("../routes/mira-research-governance");

function rejects(req, label) {
  assert.throws(
    () => actorIdentity(req),
    /Verified administrator session identity unavailable/,
    label
  );
}

const valid = actorIdentity({
  role: "admin",
  session: {
    authenticated: true,
    role: "admin",
    username: "verified-admin"
  }
});
assert.deepEqual(valid, { role: "admin", id: "verified-admin" });
console.log("VALID_ADMIN_SESSION=PASS");

rejects({}, "missing session must fail closed");
console.log("MISSING_SESSION_REJECTED=PASS");

rejects({
  role: "admin",
  session: { authenticated: false, role: "admin", username: "verified-admin" }
}, "unauthenticated session must fail closed");
console.log("UNAUTHENTICATED_SESSION_REJECTED=PASS");

rejects({
  role: "user",
  session: { authenticated: true, role: "user", username: "regular-user" }
}, "non-admin must fail closed");
console.log("NON_ADMIN_REJECTED=PASS");

rejects({
  role: "admin",
  session: { authenticated: true, role: "admin", username: "   " }
}, "blank username must fail closed");
console.log("BLANK_IDENTITY_REJECTED=PASS");

rejects({
  role: "admin",
  user: { username: "unverified-fallback" },
  sessionIdentity: { username: "unverified-fallback" }
}, "user/sessionIdentity fallbacks must not bypass session verification");
console.log("IDENTITY_FALLBACK_BYPASS_REJECTED=PASS");

console.log("NETWORK_TEST=NOT_RUN");
console.log("LIVE_API_TEST=NOT_RUN");
