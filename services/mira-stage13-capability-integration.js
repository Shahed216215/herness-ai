"use strict";

const fs = require("fs");
const path = require("path");
const storagePath = require('../mira-storage');
const crypto = require("crypto");

const ROOT = path.resolve(__dirname, "..");
const STORE_FILE = process.env.MIRA_STAGE13_CAPABILITY_INTEGRATION_STORE ||
  storagePath("data/stage13-capability-integration.json");

const learning = require("./mira-stage13-learning-governance");
const profile = require("../capability-profile");
const profileService = require("./mira-capability-profile");
const audit = require("../audit-log");

function now() { return new Date().toISOString(); }
function id(prefix) {
  return prefix + "-" + Date.now() + "-" +
    crypto.randomBytes(6).toString("hex");
}
function sha(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}
function required(value, field, max = 300) {
  if (typeof value !== "string" || !value.trim() ||
      value.trim().length > max) {
    throw new Error(field + "_invalid");
  }
  return value.trim();
}
function initial() {
  return { version: 1, requests: [], events: [], updatedAt: now() };
}
function load() {
  if (!fs.existsSync(STORE_FILE)) return initial();
  const value = JSON.parse(fs.readFileSync(STORE_FILE, "utf8"));
  if (!value || value.version !== 1 ||
      !Array.isArray(value.requests) || !Array.isArray(value.events)) {
    throw new Error("INTEGRATION_STORE_SCHEMA_INVALID");
  }
  return value;
}
function requestHash(record) {
  const { recordHash, ...content } = record;
  return sha(JSON.stringify(content));
}
function eventPayload(event) {
  return {
    eventId: event.eventId, requestId: event.requestId,
    recordHash: event.recordHash, action: event.action,
    timestamp: event.timestamp, previousHash: event.previousHash
  };
}
function checkIntegrity() {
  const store = load();
  const failures = [];
  const ids = new Set();

  for (const record of store.requests) {
    if (!record || !record.requestId || ids.has(record.requestId)) {
      failures.push("request_id_missing_or_duplicate");
      continue;
    }
    ids.add(record.requestId);
    if (!record.recordHash || requestHash(record) !== record.recordHash) {
      failures.push("request_hash_mismatch:" + record.requestId);
    }
  }

  let previousHash = "GENESIS";
  for (const event of store.events) {
    if (event.previousHash !== previousHash) {
      failures.push("event_chain_mismatch:" + event.eventId);
    }
    if (event.hash !== sha(JSON.stringify(eventPayload(event)))) {
      failures.push("event_hash_mismatch:" + event.eventId);
    }
    const record = store.requests.find(x => x.requestId === event.requestId);
    if (!record) {
      failures.push("event_request_binding_mismatch:" + event.eventId);
    }
    previousHash = event.hash;
  }

  // Each event is hash-chain protected. The latest event for each request
  // must bind to its current content hash; earlier events describe prior states.
  for (const record of store.requests) {
    const latest = [...store.events].reverse().find(
      event => event.requestId === record.requestId
    );
    if (!latest || latest.recordHash !== record.recordHash) {
      failures.push("latest_event_request_binding_mismatch:" + record.requestId);
    }
  }
  return { ok: failures.length === 0, requestCount: store.requests.length,
    eventCount: store.events.length, failures };
}
function save(store, record, action) {
  record.recordHash = requestHash(record);
  const previousHash = store.events.length
    ? store.events[store.events.length - 1].hash : "GENESIS";
  const event = {
    eventId: id("integration-event"),
    requestId: record.requestId,
    recordHash: record.recordHash,
    action,
    timestamp: now(),
    previousHash
  };
  event.hash = sha(JSON.stringify(eventPayload(event)));
  store.events.push(event);
  store.updatedAt = now();

  fs.mkdirSync(path.dirname(STORE_FILE), { recursive: true });
  const temp = STORE_FILE + "." + process.pid + ".tmp";
  fs.writeFileSync(temp, JSON.stringify(store, null, 2) + "\n", { flag: "wx" });
  fs.renameSync(temp, STORE_FILE);

  audit.recordAudit({
    actorRole: "system",
    action: "STAGE134_" + action,
    resource: "learning_capability_integration",
    resourceId: record.requestId,
    status: "success",
    details: {
      benchmarkId: record.benchmarkId,
      skillId: record.skillId,
      requestStatus: record.status
    }
  });
  return record;
}
function getSkill(skillIdOrKey) {
  return profile.getSkill(skillIdOrKey);
}
function precheckSkill(skillIdOrKey) {
  const skill = getSkill(skillIdOrKey);
  if (!skill) return { ok: false, reason: "skill_not_found" };
  if (skill.status !== "active") {
    return { ok: false, reason: "skill_not_active" };
  }
  if (!Array.isArray(skill.capabilities) || !skill.capabilities.length) {
    return { ok: false, reason: "skill_has_no_declared_capabilities" };
  }

  const capabilities = profile.listCapabilities();
  const missing = [];
  const unverified = [];
  for (const key of skill.capabilities) {
    const capability = capabilities.find(c =>
      c.capabilityId === key || c.key === key
    );
    if (!capability) missing.push(key);
    else if (capability.status !== "active" ||
             capability.verification !== "verified") {
      unverified.push(key);
    }
  }
  if (missing.length || unverified.length) {
    return { ok: false, reason: "capability_verification_blocked",
      missingCapabilities: missing, unverifiedCapabilities: unverified };
  }
  return { ok: true, skill };
}
function getBenchmark(benchmarkId) {
  const integrity = learning.verifyIntegrity();
  if (!integrity.ok) throw new Error("STAGE13_LEARNING_INTEGRITY_FAILED");
  const store = learning.loadStore();
  return store.benchmarks.find(x => x.id === benchmarkId) || null;
}
function prepareVerification(input = {}) {
  const benchmarkId = required(input.benchmarkId, "benchmarkId", 200);
  const skillRef = required(input.skillIdOrKey, "skillIdOrKey", 200);
  const benchmark = getBenchmark(benchmarkId);

  if (!benchmark) throw new Error("BENCHMARK_NOT_FOUND");
  if (benchmark.criteriaMet !== true ||
      benchmark.capabilityClaimAllowed !== true ||
      benchmark.expertClaimAllowed !== false ||
      benchmark.profileVerificationChanged !== false ||
      benchmark.approvalRequired !== true ||
      benchmark.autoApplied !== false ||
      !Array.isArray(benchmark.tests) || !benchmark.tests.length ||
      benchmark.tests.some(t => !t.passed ||
        !t.testExecution || t.testExecution.passed !== true)) {
    throw new Error("BENCHMARK_NOT_ELIGIBLE_FOR_VERIFICATION");
  }

  const skillCheck = precheckSkill(skillRef);
  if (!skillCheck.ok) throw new Error("SKILL_PRECHECK_FAILED:" + skillCheck.reason);
  if (String(benchmark.skill).trim().toLowerCase() !==
      skillCheck.skill.name.trim().toLowerCase() &&
      String(benchmark.skill).trim().toLowerCase() !==
      skillCheck.skill.key.toLowerCase()) {
    throw new Error("BENCHMARK_SKILL_MISMATCH");
  }

  const store = load();
  const integrity = checkIntegrity();
  if (!integrity.ok) throw new Error("INTEGRATION_STORE_INTEGRITY_FAILED");
  if (store.requests.some(x =>
    x.benchmarkId === benchmarkId &&
    x.skillId === skillCheck.skill.skillId &&
    ["pending_approval", "approved_verified"].includes(x.status))) {
    throw new Error("DUPLICATE_VERIFICATION_REQUEST");
  }

  const token = crypto.randomBytes(24).toString("hex");
  const record = {
    requestId: id("capability-verification"),
    benchmarkId,
    benchmarkRecordHash: benchmark.recordHash,
    skillId: skillCheck.skill.skillId,
    skillKey: skillCheck.skill.key,
    status: "pending_approval",
    challengeHash: sha(token),
    approvedBy: null,
    createdAt: now(),
    approvedAt: null,
    verificationEvidenceId: null,
    approvalRequired: true,
    autoApplied: false,
    expertClaimAllowed: false
  };
  store.requests.push(record);
  save(store, record, "VERIFICATION_REQUEST_PREPARED");

  return {
    ok: true,
    status: record.status,
    requestId: record.requestId,
    approvalChallenge: token,
    skillId: record.skillId,
    benchmarkId,
    approvalRequired: true,
    autoApplied: false,
    expertClaimAllowed: false
  };
}
function approveVerification(input = {}) {
  const requestId = required(input.requestId, "requestId", 200);
  const approver = required(input.approvedBy, "approvedBy", 200);
  const token = required(input.approvalChallenge, "approvalChallenge", 200);
  if (input.confirm !== true) throw new Error("EXPLICIT_CONFIRMATION_REQUIRED");

  const integrity = checkIntegrity();
  if (!integrity.ok) throw new Error("INTEGRATION_STORE_INTEGRITY_FAILED");
  const store = load();
  const record = store.requests.find(x => x.requestId === requestId);
  if (!record) throw new Error("VERIFICATION_REQUEST_NOT_FOUND");
  if (record.status !== "pending_approval") throw new Error("REQUEST_NOT_PENDING");
  if (sha(token) !== record.challengeHash) throw new Error("APPROVAL_CHALLENGE_INVALID");

  const benchmark = getBenchmark(record.benchmarkId);
  if (!benchmark || benchmark.recordHash !== record.benchmarkRecordHash ||
      benchmark.criteriaMet !== true ||
      benchmark.capabilityClaimAllowed !== true ||
      benchmark.expertClaimAllowed !== false ||
      benchmark.profileVerificationChanged !== false ||
      benchmark.autoApplied !== false ||
      !benchmark.tests.every(t => t.passed && t.testExecution?.passed === true)) {
    throw new Error("BENCHMARK_EVIDENCE_CHANGED_OR_INVALID");
  }

  const skillCheck = precheckSkill(record.skillId);
  if (!skillCheck.ok) throw new Error("SKILL_PRECHECK_FAILED:" + skillCheck.reason);

  const existing = skillCheck.skill;
  if (existing.verification === "verified") {
    throw new Error("SKILL_ALREADY_VERIFIED");
  }

  const result = profileService.verifyProfileSkill(record.skillId, {
    type: "stage13-benchmark",
    reference: "benchmark:" + record.benchmarkId +
      ";benchmarkHash:" + record.benchmarkRecordHash +
      ";request:" + record.requestId
  });

  if (!result || result.ok !== true) {
    record.status = "verification_blocked";
    record.failureReason = result?.status || "verification_failed";
    record.updatedAt = now();
    save(store, record, "VERIFICATION_BLOCKED");
    return { ok: false, status: record.status, reason: record.failureReason };
  }

  record.status = "approved_verified";
  record.approvedBy = approver;
  record.approvedAt = now();
  record.verificationEvidenceId = result.evidence?.evidenceId || null;
  record.updatedAt = now();
  save(store, record, "VERIFICATION_APPROVED_AND_APPLIED");

  return {
    ok: true,
    status: record.status,
    requestId,
    skillId: record.skillId,
    approvedBy: approver,
    verificationEvidenceId: record.verificationEvidenceId,
    approvalRequired: true,
    autoApplied: false,
    expertClaimAllowed: false
  };
}
function getRequest(requestId) {
  const integrity = checkIntegrity();
  if (!integrity.ok) throw new Error("INTEGRATION_STORE_INTEGRITY_FAILED");
  const record = load().requests.find(x => x.requestId === requestId);
  return record ? { ...record, challengeHash: undefined } : null;
}

module.exports = {
  STORE_FILE,
  prepareVerification,
  approveVerification,
  getRequest,
  checkIntegrity
};
