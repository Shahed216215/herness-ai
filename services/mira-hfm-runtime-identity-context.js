"use strict";

const { normalizeTrustedActorIdentity } = require("./mira-memory-host-identity-contract");
const STABLE_SUBJECT_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function unavailable(reason) {
  return Object.freeze({ status: "IDENTITY_UNAVAILABLE", actor: null, reason });
}

/*
 * Resolve a canonical principal only from server-issued authenticated session state.
 * This does not authenticate bearer tokens or authorize project operations.
 * Model/tool arguments, email, display name, and role-only claims are never identity.
 */
function buildTrustedActorContext(req) {
  const session = req && req.session;
  const role = req && req.role;
  const principal = session && session.hfmPrincipal;
  const sessionId = req && req.sessionID;

  if (!session || session.authenticated !== true ||
      (role !== "user" && role !== "admin") || session.role !== role) {
    return unavailable("AUTHENTICATED_SESSION_REQUIRED");
  }
  if (!principal || typeof principal !== "object" || Array.isArray(principal)) {
    return unavailable("SERVER_ISSUED_PRINCIPAL_REQUIRED");
  }

  const expectedIssuer = role === "admin" ? "mira.admins" : "mira.users";
  const expectedMethod = role === "admin" ? "ADMIN_SUBJECT" : "USER_SESSION";
  if (principal.verified !== true ||
      principal.issuer !== expectedIssuer ||
      principal.actorType !== "HUMAN" ||
      principal.authenticationMethod !== expectedMethod ||
      typeof principal.subject !== "string" ||
      !STABLE_SUBJECT_PATTERN.test(principal.subject) ||
      typeof sessionId !== "string" || !sessionId ||
      principal.authenticationRef !== sessionId) {
    return unavailable("PRINCIPAL_ENVELOPE_INVALID");
  }

  let normalized;
  try {
    normalized = normalizeTrustedActorIdentity({
      verifiedPrincipal: principal,
      now: new Date()
    });
  } catch (_error) {
    return unavailable("PRINCIPAL_NORMALIZATION_FAILED");
  }

  return Object.freeze({
    status: "ACTOR_RESOLVED",
    verifiedPrincipal: Object.freeze({ ...principal }),
    actor: Object.freeze({
      actorId: normalized.actorId,
      role,
      authentication: "session",
      principal: normalized
    })
  });
}

module.exports = { buildTrustedActorContext };
