"use strict";

const DEFAULT_SCOPES = Object.freeze([
  "seo_audit",
  "public_web_research"
]);

function requiredString(value, code, max = 500) {
  if (typeof value !== "string" || !value.trim() ||
      value.trim().length > max) {
    throw new TypeError(code);
  }
  return value.trim();
}

function validateActor(actor) {
  if (!actor || actor.role !== "admin") {
    throw new Error("NAMED_ADMIN_SESSION_REQUIRED");
  }
  return {
    role: "admin",
    username: requiredString(actor.username, "ADMIN_USERNAME_REQUIRED", 160),
    userId: typeof actor.userId === "string" && actor.userId.trim()
      ? actor.userId.trim().slice(0, 160)
      : null
  };
}

function createConsentService(deps = {}) {
  const store = deps.store || require("./mira-client-consent-store");
  const recordAudit = deps.recordAudit;
  const verifyAuditIntegrity = deps.verifyAuditIntegrity;

  if (typeof recordAudit !== "function" ||
      typeof verifyAuditIntegrity !== "function") {
    throw new Error("CONSENT_AUDIT_DEPENDENCIES_REQUIRED");
  }

  function audit(action, event, status) {
    recordAudit({
      actorRole: "admin",
      action,
      resource: "client_consent",
      resourceId: `${event.clientId}:${event.scope}`,
      status,
      details: {
        actorId: event.actor.userId,
        actorUsername: event.actor.username,
        clientId: event.clientId,
        scope: event.scope,
        consentEvidenceRef: event.consentEvidenceRef || null,
        consentReceivedAt: event.consentReceivedAt || null,
        eventId: event.eventId
      }
    });
  }

  function persistAudited(before, after, event, action) {
    let changed = false;
    try {
      audit(`${action}_pending`, event, "pending");
      store.write(after);
      changed = true;
      audit(`${action}_committed`, event, "success");

      const integrity = verifyAuditIntegrity();
      if (!integrity || integrity.ok !== true) {
        throw new Error("CONSENT_AUDIT_INTEGRITY_FAILED");
      }

      return {
        success: true,
        status: event.status.toUpperCase(),
        event
      };
    } catch (error) {
      if (changed) {
        try {
          store.write(before);
        } catch {
          return {
            success: false,
            status: "INCONCLUSIVE",
            reason: "CONSENT_ROLLBACK_FAILED"
          };
        }
      }

      return {
        success: false,
        status: "INCONCLUSIVE",
        reason: "CONSENT_AUDIT_OR_PERSISTENCE_FAILED"
      };
    }
  }

  function grant(input = {}) {
    const clientId = requiredString(input.clientId, "CLIENT_ID_REQUIRED", 160);
    const scope = requiredString(input.scope, "CONSENT_SCOPE_REQUIRED", 80);
    if (!DEFAULT_SCOPES.includes(scope)) {
      throw new TypeError("CONSENT_SCOPE_NOT_SUPPORTED");
    }

    const evidenceRef = requiredString(
      input.consentEvidenceRef,
      "CONSENT_EVIDENCE_REFERENCE_REQUIRED",
      500
    );
    const receivedAt = requiredString(
      input.consentReceivedAt,
      "CONSENT_RECEIVED_AT_REQUIRED",
      50
    );
    if (!Number.isFinite(Date.parse(receivedAt))) {
      throw new TypeError("CONSENT_RECEIVED_AT_INVALID");
    }

    const actor = validateActor(input.actor);
    const before = store.read();
    const latest = store.current(clientId, scope);

    if (latest && latest.status === "authorized") {
      return { success: false, status: "CONFLICT", reason: "CONSENT_ALREADY_ACTIVE" };
    }

    const event = {
      eventId: require("node:crypto").randomUUID(),
      clientId,
      scope,
      status: "authorized",
      consentEvidenceRef: evidenceRef,
      consentReceivedAt: new Date(receivedAt).toISOString(),
      recordedAt: new Date().toISOString(),
      actor
    };

    return persistAudited(
      before,
      { version: 1, events: [...before.events, event] },
      event,
      "client_consent_grant"
    );
  }

  function revoke(input = {}) {
    const clientId = requiredString(input.clientId, "CLIENT_ID_REQUIRED", 160);
    const scope = requiredString(input.scope, "CONSENT_SCOPE_REQUIRED", 80);
    if (!DEFAULT_SCOPES.includes(scope)) {
      throw new TypeError("CONSENT_SCOPE_NOT_SUPPORTED");
    }

    const actor = validateActor(input.actor);
    const before = store.read();
    const latest = store.current(clientId, scope);

    if (!latest || latest.status !== "authorized") {
      return { success: false, status: "CONFLICT", reason: "ACTIVE_CONSENT_NOT_FOUND" };
    }

    const event = {
      eventId: require("node:crypto").randomUUID(),
      clientId,
      scope,
      status: "revoked",
      previousEventId: latest.eventId,
      recordedAt: new Date().toISOString(),
      actor
    };

    return persistAudited(
      before,
      { version: 1, events: [...before.events, event] },
      event,
      "client_consent_revoke"
    );
  }

  function lookup(clientId, scope) {
    const id = requiredString(clientId, "CLIENT_ID_REQUIRED", 160);
    if (!DEFAULT_SCOPES.includes(scope)) {
      throw new TypeError("CONSENT_SCOPE_NOT_SUPPORTED");
    }
    const event = store.current(id, scope);
    return {
      authorized: Boolean(event && event.status === "authorized"),
      event: event || null
    };
  }

  function list() {
    return store.read().events.slice(-200).reverse();
  }

  return Object.freeze({ grant, revoke, lookup, list });
}

module.exports = {
  DEFAULT_SCOPES,
  createConsentService,
  validateActor
};
