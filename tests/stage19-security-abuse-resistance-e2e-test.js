"use strict";

const fs = require("fs");
const path = require("path");
const assert = require("assert/strict");

const root = path.resolve(__dirname, "..");
const auditFile = process.env.MIRA_AUDIT_FILE;

if (!auditFile) {
  throw new Error("MIRA_AUDIT_FILE must point to an isolated test file");
}

const audit = require(path.join(root, "audit-log.js"));
let passed = 0;
let failed = 0;
let gaps = 0;

function check(name, fn) {
  try {
    fn();
    passed++;
    console.log("PASS: " + name);
  } catch (error) {
    failed++;
    console.log("FAIL: " + name + " :: " + error.message);
  }
}

function gap(name, detail) {
  gaps++;
  console.log("GAP: " + name + " :: " + detail);
}

function readSource(rel) {
  const file = path.join(root, rel);
  return fs.existsSync(file) ? fs.readFileSync(file, "utf8") : "";
}

console.log("--- A. Isolated audit redaction and integrity tests ---");

const marker = "STAGE19_SECRET_MARKER_DO_NOT_LEAK";
let baseline = [];

check("audit API exposes recordAudit/loadAuditLog/saveAuditLog", () => {
  assert.equal(typeof audit.recordAudit, "function");
  assert.equal(typeof audit.loadAuditLog, "function");
  assert.equal(typeof audit.saveAuditLog, "function");
  assert.equal(typeof audit.verifyAuditIntegrity, "function");
  assert.equal(typeof audit.calculateIntegrityHash, "function");
});

check("sensitive nested values are redacted before persistence", () => {
  audit.saveAuditLog([]);

  audit.recordAudit({
    actorRole: "stage19-test",
    action: "security.redaction.test",
    resource: "isolated-fixture",
    status: "success",
    details: {
      apiKey: marker,
      nested: {
        password: marker,
        refresh_token: marker,
        authorization: marker,
        credentialValue: marker
      },
      safeLabel: "non-secret-fixture"
    }
  });

  const entries = audit.loadAuditLog();
  assert.equal(entries.length, 1);
  const serialized = JSON.stringify(entries);

  assert.equal(serialized.includes(marker), false);
  assert.equal(entries[0].details.apiKey, "[REDACTED]");
  assert.equal(entries[0].details.nested.password, "[REDACTED]");
  assert.equal(entries[0].details.nested.refresh_token, "[REDACTED]");
  assert.equal(entries[0].details.nested.authorization, "[REDACTED]");
  assert.equal(entries[0].details.nested.credentialValue, "[REDACTED]");
  assert.equal(entries[0].details.safeLabel, "non-secret-fixture");
});

check("fresh audit chain verifies successfully", () => {
  audit.recordAudit({
    actorRole: "stage19-test",
    action: "security.chain.second",
    resource: "isolated-fixture",
    details: { phase: "valid-chain" }
  });

  const result = audit.verifyAuditIntegrity();
  assert.equal(result.ok, true);
  assert.equal(result.tamperDetected, false);
  assert.equal(result.integrityFailures, 0);
  assert.equal(result.chainFailures, 0);

  baseline = audit.loadAuditLog();
});

check("modified audit content is detected", () => {
  const altered = JSON.parse(JSON.stringify(baseline));
  altered[0].details.safeLabel = "TAMPERED_VALUE";
  audit.saveAuditLog(altered);

  const result = audit.verifyAuditIntegrity();
  assert.equal(result.ok, false);
  assert.equal(result.tamperDetected, true);
  assert.ok(result.integrityFailures > 0);
});

check("rehashed entry with broken previousHash is detected", () => {
  const altered = JSON.parse(JSON.stringify(baseline));
  assert.ok(altered.length >= 2);

  altered[1].previousHash = "0".repeat(64);
  altered[1].integrityHash = audit.calculateIntegrityHash(altered[1]);
  audit.saveAuditLog(altered);

  const result = audit.verifyAuditIntegrity();
  assert.equal(result.ok, false);
  assert.equal(result.tamperDetected, true);
  assert.ok(result.chainFailures > 0);
});

// Restore only the isolated fixture.
audit.saveAuditLog(baseline);
check("isolated audit fixture restored and verifies", () => {
  assert.equal(audit.verifyAuditIntegrity().ok, true);
});

console.log("--- B. File boundary control inspection ---");

const snapshot = readSource("snapshot-manager.js");
const staging = readSource("staging-manager.js");

check("snapshot manager contains lexical traversal and sensitive-file guards", () => {
  assert.match(snapshot, /path\.resolve/);
  assert.match(snapshot, /Path traversal blocked/);
  assert.match(snapshot, /BLOCKED_FILES/);
});

check("staging manager contains traversal and allowed-root guards", () => {
  assert.match(staging, /path\.resolve/);
  assert.match(staging, /Artifact path traversal blocked/);
  assert.match(staging, /ALLOWED_ARTIFACT_ROOTS/);
});

// Static source inspection is evidence of a guard, not a substitute
// for testing every filesystem operation or symlink edge case.
if (
  !/realpathSync|lstatSync|symlink/i.test(snapshot + "\n" + staging)
) {
  gap(
    "filesystem symlink boundary",
    "No obvious realpath/lstat/symlink defense found in the inspected managers; review before claiming symlink traversal is blocked."
  );
}

console.log("--- C. Prompt, URL and attachment entry-point inventory ---");

const scanRoots = ["server.js", "routes", "services"];
const files = [];

function walk(rel) {
  const full = path.join(root, rel);
  if (!fs.existsSync(full)) return;

  const stat = fs.statSync(full);
  if (stat.isFile() && rel.endsWith(".js")) {
    files.push(rel);
    return;
  }

  if (!stat.isDirectory()) return;

  for (const name of fs.readdirSync(full)) {
    if (name === "node_modules" || name === "tmp" || name === "backups") continue;
    walk(path.join(rel, name));
  }
}

for (const rel of scanRoots) walk(rel);

const all = files.map(rel => ({
  rel,
  text: readSource(rel)
}));

const matches = (regex) => all
  .filter(item => regex.test(item.text))
  .map(item => item.rel);

const promptFiles = matches(
  /role\s*:\s*["']system["']|systemPrompt|system prompt|untrusted data|ignore previous instructions|prompt injection/i
);
const urlFiles = matches(
  /new\s+URL\s*\(|fetch\s*\(|axios\.(?:get|post|request)\s*\(|https?\.request\s*\(|https?\.get\s*\(/i
);
const attachmentFiles = matches(
  /multer|upload\.(?:single|array|fields)\s*\(|req\.(?:file|files)\b|multipart\/form-data|attachment/i
);

console.log("PROMPT_RELATED_FILES=" + (promptFiles.join(",") || "NONE_FOUND"));
console.log("URL_OR_NETWORK_ENTRY_FILES=" + (urlFiles.join(",") || "NONE_FOUND"));
console.log("ATTACHMENT_OR_UPLOAD_FILES=" + (attachmentFiles.join(",") || "NONE_FOUND"));


const promptTestPassed =
  process.env.MIRA_STAGE19_PROMPT_TEST_PASS === "1";
const socketTestPassed =
  process.env.MIRA_STAGE19_SOCKET_TEST_PASS === "1";
const ssrfTestPassed =
  process.env.MIRA_STAGE19_SSRF_TEST_PASS === "1";

console.log("PROMPT_CONSTRUCTION_TEST_EVIDENCE=" +
  (promptTestPassed ? "PASS_FROM_CANONICAL_RUNNER" : "NOT_VERIFIED"));
console.log("LOCAL_SOCKET_TEST_EVIDENCE=" +
  (socketTestPassed ? "PASS_FROM_CANONICAL_RUNNER" : "NOT_VERIFIED"));
console.log("LOCAL_SSRF_REDIRECT_TEST_EVIDENCE=" +
  (ssrfTestPassed ? "PASS_FROM_CANONICAL_RUNNER" : "NOT_VERIFIED"));

if (!promptFiles.length) {
  gap(
    "prompt entry-point coverage",
    "No obvious prompt-related files were detected; manual input-to-model flow review remains necessary."
  );
} else if (!promptTestPassed) {
  gap(
    "prompt construction regression",
    "The canonical runner did not confirm a passing hostile-input prompt-construction test."
  );
} else {
  console.log("EVIDENCE: hostile-input prompt-construction regression passed.");
  console.log("LIMIT: model-level prompt-injection resistance is not proven by prompt construction.");
  gap(
    "model-level prompt injection",
    "Construction regression passed, but model behavior under adversarial inputs has not been established."
  );
}

if (!urlFiles.length) {
  gap(
    "URL/network surface coverage",
    "No obvious URL/network entry point was detected in the scanned application folders; review scan coverage manually."
  );
} else if (!socketTestPassed || !ssrfTestPassed) {
  gap(
    "SSRF runtime evidence",
    "Both successful local socket-pinning and local redirect-rejection test results are required; at least one is unverified."
  );
} else {
  console.log("EVIDENCE: local HTTPS socket pinning and SSRF redirect rejection both passed.");
  console.log("LIMIT: this does not prove every network call site is routed through the secure request helper.");
}

if (!attachmentFiles.length) {
  console.log("ATTACHMENT_SURFACE=NO_OBVIOUS_UPLOAD_HANDLER_DETECTED");
  console.log("ATTACHMENT_LIMIT=SOURCE_SCAN_IS_NOT_PROOF_THAT_NO_INGESTION_PATH_EXISTS");
} else {
  gap(
    "attachment ingestion security",
    "Attachment/upload-related source exists; validation, size limits, storage boundaries and hostile-file handling need targeted runtime tests."
  );
}

console.log("--- D. Summary ---");
console.log("ASSERTIONS_PASSED=" + passed);
console.log("ASSERTIONS_FAILED=" + failed);
console.log("SECURITY_GAPS_REMAINING=" + gaps);

if (failed > 0) {
  console.log("STAGE19_SECURITY_E2E=FAIL");
  process.exitCode = 1;
} else if (gaps > 0) {
  console.log("STAGE19_SECURITY_E2E=PARTIAL_GAPS_REMAIN");
} else {
  console.log("STAGE19_SECURITY_E2E=PASS");
}
