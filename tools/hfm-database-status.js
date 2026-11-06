"use strict";

const { inspectDatabase } = require("../services/mira-hfm-postgres");

function isTrustedAdmin(context) {
  const actor = context && context.actor;
  const principal = actor && actor.principal;
  return context &&
    context.status === "ACTOR_RESOLVED" &&
    actor &&
    actor.role === "admin" &&
    typeof actor.actorId === "string" &&
    actor.actorId.startsWith("mira:mira.admins:") &&
    principal &&
    principal.actorId === actor.actorId &&
    principal.actorType === "HUMAN" &&
    principal.authenticationMethod === "ADMIN_SUBJECT";
}

module.exports = {
  name: "hfm_database_status",
  declaration: {
    name: "hfm_database_status",
    description: "Read-only inspection of the configured Mira HFM Neon PostgreSQL database. Requires a verified canonical admin-subject session. Returns database/schema/table metadata only; never reads table rows, runs migrations, or writes data.",
    parameters: {
      type: "object",
      properties: {}
    }
  },
  execute: async (_args, trustedContext) => {
    if (!isTrustedAdmin(trustedContext)) {
      return JSON.stringify({
        status: "BLOCKED",
        reason: "VERIFIED_ADMIN_SESSION_REQUIRED",
        readOnly: true,
        dataAccessed: false
      });
    }
    return JSON.stringify(await inspectDatabase(), null, 2);
  }
};
