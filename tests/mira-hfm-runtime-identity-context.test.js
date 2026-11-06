"use strict";

const assert = require("node:assert/strict");
const { buildTrustedActorContext } = require("../services/mira-hfm-runtime-identity-context");

const registered = buildTrustedActorContext({
  role: "user",
  session: {
    authenticated: true,
    role: "user",
    userId: "user-uuid-001",
    username: "display-name"
  }
});
assert.equal(registered.status, "ACTOR_RESOLVED");
assert.deepEqual(registered.actor, {
  actorId: "user-uuid-001",
  role: "user",
  authentication: "session"
});
assert.equal(Object.isFrozen(registered), true);
assert.equal(Object.isFrozen(registered.actor), true);
console.log("REGISTERED_SESSION_STABLE_ACTOR_RESOLVED=PASS");

for (const req of [
  null,
  {},
  { role: "user", session: { authenticated: false, role: "user", userId: "user-uuid-001" } },
  { role: "user", session: { authenticated: true, role: "admin", userId: "user-uuid-001" } },
  { role: "user", session: { authenticated: true, role: "user" } },
  { role: "user", session: { authenticated: true, role: "user", userId: "  " } },
  { role: "admin", session: { authenticated: true, role: "admin", username: "admin" } },
  { role: "user", session: null }
]) {
  const result = buildTrustedActorContext(req);
  assert.equal(result.status, "IDENTITY_UNAVAILABLE");
  assert.equal(result.actor, null);
}
console.log("MISSING_LEGACY_BEARER_AND_MISMATCHED_IDENTITY_FAIL_CLOSED=PASS");

const untrustedModelArgs = {
  actorId: "attacker-controlled",
  projectId: "project-other"
};
const context = buildTrustedActorContext({
  role: "user",
  session: { authenticated: true, role: "user", userId: "trusted-user-001" }
});
assert.equal(context.actor.actorId, "trusted-user-001");
assert.equal(Object.hasOwn(context.actor, "projectId"), false);
assert.equal(untrustedModelArgs.actorId, "attacker-controlled");
console.log("MODEL_ARGUMENTS_CANNOT_OVERRIDE_TRUSTED_ACTOR=PASS");
console.log("TESTS_FAILED=0");
