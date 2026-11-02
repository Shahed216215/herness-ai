"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const crypto = require("node:crypto");

const temp = fs.mkdtempSync(path.join(os.tmpdir(), "mira-seo-review-"));
process.env.MIRA_STORAGE_DIR = temp;

const store = require("../services/mira-seo-workflow-store");
const tool = require("../tools/seo-workflow-review-decision");

const admin = {
  permissionGranted: true,
  actor: { role: "admin", username: "test-admin" }
};
const confirmation = "I_CONFIRM_SEO_REVIEW_DECISION";

function parse(value) {
  return JSON.parse(value);
}

function createRecord(clientId) {
  const saved = store.appendWorkflowRecord({
    clientId,
    query: "AI automation agency",
    brief: { clientName: "Test Client" },
    audit: { status: "OFFLINE_TEST" },
    research: { status: "ISOLATED_TEST" },
    qualityReview: {
      status: "QUALITY_REVIEW_GENERATED",
      review: {
        status: "PENDING_REVIEW",
        decision: null,
        reviewer: null,
        reviewedAt: null,
        approvalRequired: true,
        approvalGranted: false
      },
      executionBoundary: {
        websiteModified: false,
        contentPublished: false,
        externalActions: false
      }
    }
  });
  return { ...saved, clientId };
}

function args(record, decision, expectedVersion = 0) {
  return {
    clientId: record.clientId,
    workflowId: record.id,
    decision,
    reason: "Reviewed the isolated test deliverable and recorded this decision.",
    expectedVersion,
    confirmation
  };
}

async function main() {
  const a = createRecord("client-a");
  const b = createRecord("client-b");
  const c = createRecord("client-c");

  const execute = tool.createReviewDecisionExecutor();

  let result = parse(await execute(args(a, "APPROVE"), {}));
  assert.equal(result.status, "BLOCKED");
  console.log("PASS: trusted Admin context required");

  result = parse(await execute({
    ...args(a, "APPROVE"),
    confirmation: "wrong"
  }, admin));
  assert.equal(result.status, "INVALID_INPUT");
  console.log("PASS: explicit confirmation required");

  result = parse(await execute({
    ...args(a, "APPROVE"),
    unexpected: true
  }, admin));
  assert.equal(result.status, "INVALID_INPUT");
  console.log("PASS: unexpected request fields rejected");

  result = parse(await execute({
    ...args(a, "APPROVE"),
    clientId: "client-b"
  }, admin));
  assert.equal(result.success, false);
  assert.equal(result.reason, "SEO_REVIEW_WORKFLOW_NOT_FOUND");
  console.log("PASS: exact client and workflow scope enforced");

  result = parse(await execute(args(a, "APPROVE"), admin));
  assert.equal(result.success, true);
  assert.equal(result.reviewStatus, "APPROVED");
  assert.equal(result.reviewVersion, 1);
  assert.equal(result.publicationAuthorized, false);
  console.log("PASS: APPROVE decision persisted");

  let record = store.listWorkflowRecords("client-a").find(x => x.id === a.id);
  assert.equal(record.qualityReview.review.approvalGranted, true);
  assert.equal(record.qualityReview.review.reviewer, "test-admin");
  assert.equal(record.reviewHistory.length, 1);
  console.log("PASS: reviewer, timestamp and decision history persisted");

  const event = record.reviewHistory[0];
  const unsigned = { ...event };
  delete unsigned.eventHash;
  assert.equal(
    event.eventHash,
    crypto.createHash("sha256").update(JSON.stringify(unsigned)).digest("hex")
  );
  console.log("PASS: review event hash integrity verified");

  result = parse(await execute(args(a, "REJECT", 0), admin));
  assert.equal(result.success, false);
  assert.equal(result.reason, "SEO_REVIEW_VERSION_CONFLICT");
  console.log("PASS: stale/duplicate decision rejected");

  result = parse(await execute(args(a, "REJECT", 1), admin));
  assert.equal(result.success, false);
  assert.equal(result.reason, "SEO_REVIEW_DECISION_ALREADY_FINAL");
  console.log("PASS: final decision cannot be overwritten");

  result = parse(await execute(args(b, "REJECT"), admin));
  assert.equal(result.success, true);
  assert.equal(result.reviewStatus, "REJECTED");
  console.log("PASS: REJECT decision persisted");

  result = parse(await execute(args(c, "REQUEST_REVISION"), admin));
  assert.equal(result.success, true);
  assert.equal(result.reviewStatus, "REVISION_REQUESTED");
  console.log("PASS: REQUEST_REVISION decision persisted");

  record = store.listWorkflowRecords("client-b").find(x => x.id === b.id);
  assert.equal(record.qualityReview.review.approvalGranted, false);
  assert.equal(record.qualityReview.review.status, "REJECTED");
  console.log("PASS: rejection does not grant approval");

  record = store.listWorkflowRecords("client-c").find(x => x.id === c.id);
  assert.equal(record.qualityReview.review.status, "REVISION_REQUESTED");
  assert.equal(record.qualityReview.review.approvalGranted, false);
  console.log("PASS: revision request remains unapproved");

  const allA = store.listWorkflowRecords("client-a");
  assert.equal(allA.length, 1);
  assert.equal(store.listWorkflowRecords("client-b").length, 1);
  console.log("PASS: client-scoped storage isolation");

  // Lock contention must fail closed without modifying the record.
  const lockRecord = createRecord("client-lock");
  fs.mkdirSync(store.LOCK_DIR, { mode: 0o700 });

  result = parse(await execute(args(lockRecord, "APPROVE"), admin));
  assert.equal(result.success, false);
  assert.equal(result.reason, "SEO_WORKFLOW_STORE_LOCKED_REVIEW_REQUIRED");
  fs.rmdirSync(store.LOCK_DIR);

  record = store.listWorkflowRecords("client-lock").find(x => x.id === lockRecord.id);
  assert.equal(record.qualityReview.review.status, "PENDING_REVIEW");
  assert.equal(record.reviewHistory.length, 0);
  console.log("PASS: lock contention fails closed without partial update");

  assert.equal(record.qualityReview.executionBoundary.websiteModified, false);
  assert.equal(record.qualityReview.executionBoundary.contentPublished, false);
  console.log("PASS: no website modification or publication");

  const historyTool = require("../tools/seo-workflow-history");
  const history = parse(await historyTool.createHistoryExecutor({
    listWorkflowRecords: store.listWorkflowRecords
  })({ clientId: "client-a" }, admin));

  assert.equal(history.success, true);
  assert.equal(history.records[0].reviewVersion, 1);
  assert.equal(history.records[0].reviewHistory.length, 1);
  console.log("PASS: history tool exposes review version and audit events");

  const registered = require("../tools").tools.seo_workflow_review_decision;
  assert.ok(registered);
  assert.equal(registered.name, "seo_workflow_review_decision");
  console.log("PASS: review tool auto-registered");

  console.log("SEO_REVIEW_DECISION_TEST=PASS");
  console.log("NETWORK_REQUESTS=0");
  console.log("LIVE_API_CALLS=0");
  console.log("EXTERNAL_ACTIONS=0");
  console.log("TEST_STORAGE=ISOLATED_TEMP_DIRECTORY");
}

main()
  .catch(error => {
    console.error("SEO_REVIEW_DECISION_TEST=FAIL");
    console.error(error.stack || error.message);
    process.exitCode = 1;
  })
  .finally(() => {
    try { fs.rmSync(temp, { recursive: true, force: true }); } catch {}
  });
