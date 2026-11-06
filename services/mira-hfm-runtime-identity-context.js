"use strict";

/*
 * Build an out-of-band actor context from authenticated server state.
 * Never derive identity from model/tool arguments, email, or display name.
 * Shared bearer credentials and legacy sessions without a stable userId
 * deliberately fail closed.
 */
function buildTrustedActorContext(req) {
  const session = req && req.session;
  const role = req && req.role;

  if (
    !session ||
    session.authenticated !== true ||
    typeof role !== "string" ||
    !role.trim() ||
    session.role !== role ||
    typeof session.userId !== "string" ||
    !session.userId.trim()
  ) {
    return Object.freeze({
      status: "IDENTITY_UNAVAILABLE",
      actor: null,
      reason: "A stable authenticated session userId is required."
    });
  }

  return Object.freeze({
    status: "ACTOR_RESOLVED",
    actor: Object.freeze({
      actorId: session.userId.trim(),
      role: role.trim(),
      authentication: "session"
    })
  });
}

module.exports = { buildTrustedActorContext };
