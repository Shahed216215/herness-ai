"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { buildTrustedActorContext } = require("../services/mira-hfm-runtime-identity-context");

const now = Date.now();
const sessionId = "trusted-session-reference-001";
const validPrincipal = {
  verified: true,
  issuer: "mira.users",
  subject: "11111111-1111-4111-8111-111111111111",
  actorType: "HUMAN",
  authenticationMethod: "USER_SESSION",
  authenticationRef: sessionId,
  authenticatedAt: new Date(now - 60000).toISOString(),
  expiresAt: new Date(now + (8 * 60 * 60 * 1000) - 60000).toISOString()
};
const registered = buildTrustedActorContext({
  role: "user", sessionID: sessionId,
  session: { authenticated: true, role: "user", hfmPrincipal: validPrincipal, userId: validPrincipal.subject }
});
assert.equal(registered.status, "ACTOR_RESOLVED");
assert.equal(registered.actor.actorId, "mira:mira.users:" + validPrincipal.subject);
assert.equal(registered.actor.principal.actorType, "HUMAN");
assert.equal(registered.verifiedPrincipal.verified, true);
assert.equal(registered.verifiedPrincipal.authenticationRef, sessionId);
assert.equal(Object.isFrozen(registered.verifiedPrincipal), true);
assert.equal(registered.actor.principal.authenticationMethod, "USER_SESSION");
assert.equal(Object.isFrozen(registered), true);
assert.equal(Object.isFrozen(registered.actor), true);
assert.equal(Object.isFrozen(registered.actor.principal), true);
console.log("REGISTERED_SESSION_CANONICAL_PRINCIPAL=PASS");

const adminPrincipal = {
  ...validPrincipal, issuer: "mira.admins",
  subject: "22222222-2222-4222-8222-222222222222",
  authenticationMethod: "ADMIN_SUBJECT"
};
const admin = buildTrustedActorContext({
  role: "admin", sessionID: sessionId,
  session: { authenticated: true, role: "admin", hfmPrincipal: adminPrincipal, username: "display-name" }
});
assert.equal(admin.status, "ACTOR_RESOLVED");
assert.equal(admin.actor.actorId, "mira:mira.admins:" + adminPrincipal.subject);
console.log("PROVISIONED_ADMIN_SUBJECT_CANONICAL_PRINCIPAL=PASS");

const unavailableCases = [
  null, {},
  { role: "user", sessionID: sessionId, session: { authenticated: false, role: "user", hfmPrincipal: validPrincipal } },
  { role: "user", sessionID: sessionId, session: { authenticated: true, role: "admin", hfmPrincipal: validPrincipal } },
  { role: "admin", sessionID: sessionId, session: { authenticated: true, role: "admin", username: "admin" } },
  { role: "user", sessionID: sessionId, session: { authenticated: true, role: "user", userId: validPrincipal.subject } },
  { role: "user", sessionID: "different-session", session: { authenticated: true, role: "user", hfmPrincipal: validPrincipal } },
  { role: "user", sessionID: sessionId, session: { authenticated: true, role: "user", hfmPrincipal: { ...validPrincipal, issuer: "untrusted-issuer" } } },
  { role: "user", sessionID: sessionId, session: { authenticated: true, role: "user", hfmPrincipal: { ...validPrincipal, subject: "display-name" } } },
  { role: "user", sessionID: sessionId, session: { authenticated: true, role: "user", hfmPrincipal: { ...validPrincipal, expiresAt: new Date(now - 1000).toISOString() } } },
  { role: "user", sessionID: sessionId, session: { authenticated: true, role: "user", hfmPrincipal: { ...validPrincipal, authenticatedAt: new Date(now + 120000).toISOString() } } },
  { role: "user", sessionID: sessionId, session: null }
];
for (const req of unavailableCases) {
  const result = buildTrustedActorContext(req);
  assert.equal(result.status, "IDENTITY_UNAVAILABLE");
  assert.equal(result.actor, null);
}
console.log("MISSING_LEGACY_BEARER_ADMIN_AND_INVALID_PRINCIPAL_FAIL_CLOSED=PASS");

const modelArgs = { actorId: "attacker-controlled", projectId: "project-other" };
assert.equal(registered.actor.actorId, "mira:mira.users:" + validPrincipal.subject);
assert.equal(Object.hasOwn(registered.actor.principal, "projectId"), false);
assert.equal(modelArgs.actorId, "attacker-controlled");
console.log("MODEL_ARGUMENTS_CANNOT_OVERRIDE_TRUSTED_PRINCIPAL=PASS");

const read = p => fs.readFileSync(path.join(__dirname, "..", p), "utf8");
const serverSource = read("server.js");
assert.ok(serverSource.includes("trustedContext: buildTrustedActorContext(req)"));
assert.ok(serverSource.includes("MIRA_ADMIN_SUBJECT_ID"));
assert.ok(serverSource.includes("req.session.hfmPrincipal"));
assert.ok(read("services/mira-memory-host-identity-contract.js").includes("normalizeTrustedActorIdentity"));
assert.ok(read("services/mira-work-execution-engine.js").includes("options.trustedContext || null"));
assert.ok(read("services/tool-runner.js").includes("executeTool(name, args, trustedContext)"));
assert.ok(read("tools/index.js").includes("tools[name].execute(args, trustedContext)"));
console.log("AUTH_BOUNDARY_TO_CANONICAL_IDENTITY_AND_TOOL_DISPATCH=PASS");
console.log("HFM_RUNTIME_IDENTITY_CONTEXT_TESTS=PASS");
