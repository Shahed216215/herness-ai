const engine =
  require("../services/mira-client-communication-engine");

const {
  getAuditLog,
  verifyAuditIntegrity
} = require("../audit-log");

const marker =
  "STAGE81_AUDIT_SECRET_MESSAGE_9f7c2";

const result =
  engine.processClientMessage({
    clientId:
      "client-stage81-audit-test",
    content:
      `Can you give me an update? ${marker}`
  });

if (
  !result ||
  !result.ok ||
  !result.communication
) {
  throw new Error(
    "Client communication processing failed."
  );
}

const communication =
  result.communication;

const entries =
  getAuditLog(500);

const auditEntry =
  entries.find(
    item =>
      item.action ===
        "CLIENT_COMMUNICATION_PROCESSED" &&
      item.resource ===
        "client_communication" &&
      item.resourceId ===
        communication.communicationId
  );

if (!auditEntry) {
  throw new Error(
    "Client communication audit entry was not created."
  );
}

const auditSerialized =
  JSON.stringify(auditEntry);

if (
  auditSerialized.includes(marker)
) {
  throw new Error(
    "Client message content leaked into audit details."
  );
}

const details =
  auditEntry.details || {};

if (
  details.intent !==
  communication.intent.intent
) {
  throw new Error(
    "Audit intent does not match communication intent."
  );
}

if (
  details.policyDecision !==
  communication.policy.decision
) {
  throw new Error(
    "Audit policy decision does not match communication policy."
  );
}

if (
  details.sendBoundaryStatus !==
  communication.sendBoundary.status
) {
  throw new Error(
    "Audit send boundary status does not match communication."
  );
}

if (
  details.sendAllowed !==
  communication.sendBoundary.sendAllowed
) {
  throw new Error(
    "Audit sendAllowed value does not match communication."
  );
}

if (
  details.externalSendImplemented !==
  communication.sendBoundary
    .externalSendImplemented
) {
  throw new Error(
    "Audit externalSendImplemented value does not match communication."
  );
}

const integrity =
  verifyAuditIntegrity();

if (
  !integrity ||
  integrity.ok !== true ||
  integrity.integrityFailures !== 0 ||
  integrity.chainFailures !== 0 ||
  integrity.tamperDetected !== false
) {
  throw new Error(
    "Audit integrity verification failed."
  );
}

console.log(
  "AUDIT ENTRY CREATED: PASS"
);

console.log(
  "AUDIT CONTENT SANITIZATION: PASS"
);

console.log(
  "AUDIT INTENT MATCH: PASS"
);

console.log(
  "AUDIT POLICY MATCH: PASS"
);

console.log(
  "AUDIT SEND BOUNDARY MATCH: PASS"
);

console.log(
  "AUDIT INTEGRITY: PASS"
);

console.log(
  "STAGE 8.1 AUDIT INTEGRATION TEST: PASS"
);
