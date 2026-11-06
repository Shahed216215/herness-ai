"use strict";

const assert = require("node:assert/strict");
const { buildTrustedProjectContext, BINDING_VERSION } =
  require("../services/mira-hfm-project-binding-context");

const now = Date.now();
const sessionID = "trusted-project-session-001";
const principal = {
  verified: true,
  issuer: "mira.users",
  subject: "11111111-1111-4111-8111-111111111111",
  actorType: "HUMAN",
  authenticationMethod: "USER_SESSION",
  authenticationRef: sessionID,
  authenticatedAt: new Date(now - 60_000).toISOString(),
  expiresAt: new Date(now + 60 * 60_000).toISOString()
};
const actorId = "mira:mira.users:" + principal.subject;
function request(binding) {
  return {
    role: "user",
    sessionID,
    session: {
      authenticated: true,
      role: "user",
      hfmPrincipal: principal,
      ...(binding === undefined ? {} : { hfmProjectBinding: binding })
    },
    body: { actorId: "attacker", projectId: "attacker-project" }
  };
}

const missing = buildTrustedProjectContext(request());
assert.equal(missing.status, "PROJECT_CONTEXT_UNAVAILABLE");
assert.equal(missing.reason, "SERVER_VERIFIED_PROJECT_SELECTION_REQUIRED");
console.log("PROJECT_SELECTION_MISSING_FAILS_CLOSED=PASS");

const valid = buildTrustedProjectContext(request({
  verified: true,
  bindingVersion: BINDING_VERSION,
  actorId,
  projectId: "mira-project-001",
  selectedAt: new Date(now - 1000).toISOString()
}));
assert.equal(valid.status, "PROJECT_CONTEXT_RESOLVED");
assert.equal(valid.actor.actorId, actorId);
assert.equal(valid.project.projectId, "mira-project-001");
assert.equal(Object.isFrozen(valid), true);
assert.equal(Object.isFrozen(valid.actor), true);
assert.equal(Object.isFrozen(valid.project), true);
console.log("SERVER_SESSION_PROJECT_BINDING_RESOLVES=PASS");

const invalidBindings = [
  { verified: true, bindingVersion: BINDING_VERSION, actorId: "mira:other:actor", projectId: "mira-project-001", selectedAt: new Date(now - 1000).toISOString() },
  { verified: true, bindingVersion: BINDING_VERSION, actorId, projectId: "mira-project-001", selectedAt: new Date(now + 60_000).toISOString() },
  { verified: false, bindingVersion: BINDING_VERSION, actorId, projectId: "mira-project-001", selectedAt: new Date(now - 1000).toISOString() },
  { verified: true, bindingVersion: "UNKNOWN", actorId, projectId: "mira-project-001", selectedAt: new Date(now - 1000).toISOString() },
  { verified: true, bindingVersion: BINDING_VERSION, actorId, projectId: " ", selectedAt: new Date(now - 1000).toISOString() },
  { verified: true, bindingVersion: BINDING_VERSION, actorId, projectId: "mira-project-001", selectedAt: new Date(now - 1000).toISOString(), ownerActorId: actorId }
];
for (const binding of invalidBindings) {
  assert.equal(buildTrustedProjectContext(request(binding)).status, "PROJECT_CONTEXT_UNAVAILABLE");
}
console.log("ACTOR_MISMATCH_FUTURE_UNVERIFIED_UNKNOWN_AND_EXTRA_FIELDS_REJECTED=PASS");

const bodyOverride = buildTrustedProjectContext(request({
  verified: true,
  bindingVersion: BINDING_VERSION,
  actorId,
  projectId: "mira-project-001",
  selectedAt: new Date(now - 1000).toISOString()
}));
assert.equal(bodyOverride.actor.actorId, actorId);
assert.equal(bodyOverride.project.projectId, "mira-project-001");
console.log("HTTP_MODEL_ARGUMENTS_CANNOT_OVERRIDE_SESSION_BINDING=PASS");

const unauthenticated = buildTrustedProjectContext({
  role: "user", sessionID, session: { authenticated: false, role: "user" }
});
assert.equal(unauthenticated.status, "PROJECT_CONTEXT_UNAVAILABLE");
console.log("UNAUTHENTICATED_ACTOR_REJECTED=PASS");
console.log("HFM_PROJECT_BINDING_CONTEXT_TESTS=PASS");
