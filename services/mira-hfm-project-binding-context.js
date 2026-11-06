"use strict";

const { buildTrustedActorContext } = require("./mira-hfm-runtime-identity-context");

const PROJECT_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{2,127}$/;
const BINDING_VERSION = "HFM_PROJECT_BINDING_V1";

function unavailable(reason) {
  return Object.freeze({
    status: "PROJECT_CONTEXT_UNAVAILABLE",
    actor: null,
    project: null,
    reason
  });
}

/*
 * Resolves only a server-issued project selection attached to the authenticated
 * session. This module does not select a project, provision ownership, query the
 * database, or accept project/actor identifiers from model or HTTP arguments.
 *
 * A future selection endpoint must set session.hfmProjectBinding only after it
 * verifies the actor's active membership against the authoritative database.
 */
function buildTrustedProjectContext(req) {
  const identity = buildTrustedActorContext(req);
  if (identity.status !== "ACTOR_RESOLVED") {
    return unavailable("AUTHENTICATED_ACTOR_REQUIRED");
  }

  const binding = req && req.session && req.session.hfmProjectBinding;
  if (!binding || typeof binding !== "object" || Array.isArray(binding)) {
    return unavailable("SERVER_VERIFIED_PROJECT_SELECTION_REQUIRED");
  }

  const keys = Object.keys(binding).sort();
  const expectedKeys = [
    "actorId", "bindingVersion", "projectId", "selectedAt", "verified"
  ].sort();
  if (keys.length !== expectedKeys.length ||
      keys.some((key, index) => key !== expectedKeys[index]) ||
      binding.verified !== true ||
      binding.bindingVersion !== BINDING_VERSION ||
      binding.actorId !== identity.actor.actorId ||
      typeof binding.projectId !== "string" ||
      !PROJECT_ID_PATTERN.test(binding.projectId) ||
      typeof binding.selectedAt !== "string" ||
      !Number.isFinite(Date.parse(binding.selectedAt)) ||
      Date.parse(binding.selectedAt) > Date.now()) {
    return unavailable("SERVER_PROJECT_BINDING_INVALID");
  }

  return Object.freeze({
    status: "PROJECT_CONTEXT_RESOLVED",
    actor: identity.actor,
    project: Object.freeze({
      projectId: binding.projectId,
      bindingVersion: BINDING_VERSION,
      selectedAt: new Date(Date.parse(binding.selectedAt)).toISOString()
    })
  });
}

module.exports = Object.freeze({
  BINDING_VERSION,
  buildTrustedProjectContext
});
