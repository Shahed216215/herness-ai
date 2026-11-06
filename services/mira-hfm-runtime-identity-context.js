"use strict";

const PRINCIPAL_ISSUER = "mira-local-session-auth";
const SESSION_MAX_AGE_MS = 1000 * 60 * 60 * 8;
const STABLE_SUBJECT_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function unavailable(reason) {
  return Object.freeze({
    status: "IDENTITY_UNAVAILABLE",
    actor: null,
    reason
  });
}

/*
 * Resolve a canonical principal envelope only from server-issued session state.
 * Never derive identity from model/tool arguments, email, display name, or role alone.
 * Shared bearer credentials and legacy sessions deliberately fail closed.
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
  if (principal.issuer !== PRINCIPAL_ISSUER ||
      principal.actorType !== role ||
      principal.authenticationMethod !== "password_session" ||
      typeof principal.subject !== "string" ||
      !STABLE_SUBJECT_PATTERN.test(principal.subject) ||
      typeof sessionId !== "string" || !sessionId ||
      principal.authenticationRef !== sessionId) {
    return unavailable("PRINCIPAL_ENVELOPE_INVALID");
  }

  const authenticatedAt = Date.parse(principal.authenticatedAt);
  const expiresAt = Date.parse(principal.expiresAt);
  const now = Date.now();
  if (!Number.isFinite(authenticatedAt) || !Number.isFinite(expiresAt) ||
      authenticatedAt > now + 60000 || expiresAt <= now ||
      expiresAt <= authenticatedAt ||
      expiresAt - authenticatedAt > SESSION_MAX_AGE_MS) {
    return unavailable("PRINCIPAL_VALIDITY_WINDOW_INVALID");
  }

  const canonicalPrincipal = Object.freeze({
    issuer: principal.issuer,
    subject: principal.subject,
    actorType: principal.actorType,
    authenticationMethod: principal.authenticationMethod,
    authenticationRef: principal.authenticationRef,
    authenticatedAt: new Date(authenticatedAt).toISOString(),
    expiresAt: new Date(expiresAt).toISOString()
  });

  return Object.freeze({
    status: "ACTOR_RESOLVED",
    actor: Object.freeze({
      actorId: canonicalPrincipal.subject,
      role,
      authentication: "session",
      principal: canonicalPrincipal
    })
  });
}

module.exports = { buildTrustedActorContext };
