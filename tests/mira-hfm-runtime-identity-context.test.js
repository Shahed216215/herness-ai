"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { buildTrustedActorContext } = require("../services/mira-hfm-runtime-identity-context");

const registered = buildTrustedActorContext({
  role: "user",
  session: { authenticated: true, role: "user", userId: "user-uuid-001", username: "display-name" }
});
assert.equal(registered.status, "ACTOR_RESOLVED");
assert.deepEqual(registered.actor, { actorId: "user-uuid-001", role: "user", authentication: "session" });
assert.equal(Object.isFrozen(registered), true);
assert.equal(Object.isFrozen(registered.actor), true);

for (const req of [
  null, {},
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

const modelArgs = { actorId: "attacker-controlled", projectId: "project-other" };
const trusted = buildTrustedActorContext({
  role: "user",
  session: { authenticated: true, role: "user", userId: "trusted-user-001" }
});
assert.equal(trusted.actor.actorId, "trusted-user-001");
assert.equal(Object.hasOwn(trusted.actor, "projectId"), false);
assert.equal(modelArgs.actorId, "attacker-controlled");

const read = p => fs.readFileSync(path.join(__dirname, "..", p), "utf8");
assert.ok(read("server.js").includes("trustedContext: buildTrustedActorContext(req)"));
assert.ok(read("services/mira-work-execution-engine.js").includes("options.trustedContext || null"));
assert.ok(read("services/tool-runner.js").includes("executeTool(name, args, trustedContext)"));
assert.ok(read("tools/index.js").includes("tools[name].execute(args, trustedContext)"));
console.log("HFM_RUNTIME_IDENTITY_CONTEXT_TESTS=PASS");
