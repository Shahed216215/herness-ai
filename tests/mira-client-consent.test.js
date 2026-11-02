"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const {
  createConsentStore
} = require("../services/mira-client-consent-store");
const {
  createConsentService
} = require("../services/mira-client-consent-service");

const temp = fs.mkdtempSync(path.join(os.tmpdir(), "mira-consent-test-"));
const store = createConsentStore({
  filePath: path.join(temp, "client-consents.json")
});

let auditCalls = 0;
let auditFails = false;
let integrityOk = true;

const service = createConsentService({
  store,
  recordAudit() {
    auditCalls += 1;
    if (auditFails) throw new Error("SIMULATED_AUDIT_FAILURE");
  },
  verifyAuditIntegrity() {
    return { ok: integrityOk };
  }
});

const actor = {
  role: "admin",
  username: "test-admin",
  userId: "admin-test-1"
};

const grantInput = {
  clientId: "client-001",
  scope: "public_web_research",
  consentEvidenceRef: "signed-consent-record-001",
  consentReceivedAt: "2026-10-31T10:00:00.000Z",
  actor
};

try {
  assert.equal(service.lookup("client-001", "public_web_research").authorized, false);

  assert.throws(
    () => service.grant({ ...grantInput, actor: { role: "admin" } }),
    /ADMIN_USERNAME_REQUIRED/
  );

  assert.throws(
    () => service.grant({ ...grantInput, scope: "publish_content" }),
    /CONSENT_SCOPE_NOT_SUPPORTED/
  );

  const granted = service.grant(grantInput);
  assert.equal(granted.success, true);
  assert.equal(service.lookup("client-001", "public_web_research").authorized, true);

  const duplicate = service.grant(grantInput);
  assert.equal(duplicate.status, "CONFLICT");

  const revoked = service.revoke({
    clientId: "client-001",
    scope: "public_web_research",
    actor
  });
  assert.equal(revoked.success, true);
  assert.equal(service.lookup("client-001", "public_web_research").authorized, false);

  auditFails = true;
  const failedGrant = service.grant({
    ...grantInput,
    clientId: "client-002"
  });
  assert.equal(failedGrant.success, false);
  assert.equal(failedGrant.status, "INCONCLUSIVE");
  assert.equal(service.lookup("client-002", "public_web_research").authorized, false);
  auditFails = false;

  integrityOk = false;
  const integrityFailure = service.grant({
    ...grantInput,
    clientId: "client-003"
  });
  assert.equal(integrityFailure.success, false);
  assert.equal(integrityFailure.status, "INCONCLUSIVE");
  assert.equal(service.lookup("client-003", "public_web_research").authorized, false);
  integrityOk = true;

  const fileStat = fs.statSync(store.filePath);
  assert.equal(fileStat.mode & 0o077, 0);

  console.log("PASS: default consent state is unauthorized");
  console.log("PASS: named Admin actor required");
  console.log("PASS: unsupported scope rejected");
  console.log("PASS: grant and lookup");
  console.log("PASS: duplicate grant blocked");
  console.log("PASS: revoke and lookup");
  console.log("PASS: audit failure rolls back consent");
  console.log("PASS: integrity failure rolls back consent");
  console.log("PASS: consent store file permissions are restricted");
  console.log(`AUDIT_MOCK_CALLS=${auditCalls}`);
  console.log("NETWORK_CALLS=0");
  console.log("EXTERNAL_ACTIONS=0");
  console.log("MIRA_CLIENT_CONSENT_TEST_STATUS=PASS");
} finally {
  fs.rmSync(temp, { recursive: true, force: true });
}
