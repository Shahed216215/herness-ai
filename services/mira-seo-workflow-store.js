"use strict";

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const storagePath = require("../mira-storage");

const STORE_FILE = storagePath("mira-seo-workflow-records.json");
const LOCK_DIR = STORE_FILE + ".lock";
const MAX_STORE_BYTES = 10 * 1024 * 1024;
const MAX_RECORD_BYTES = 1024 * 1024;
const MAX_RECORDS = 500;

function validateStore(store) {
  if (
    !store ||
    typeof store !== "object" ||
    store.schemaVersion !== 1 ||
    !Array.isArray(store.records)
  ) {
    throw new Error("SEO_WORKFLOW_STORE_INVALID");
  }

  if (store.records.length > MAX_RECORDS) {
    throw new Error("SEO_WORKFLOW_STORE_RECORD_LIMIT");
  }

  return store;
}

function readStore() {
  try {
    const stat = fs.lstatSync(STORE_FILE);

    if (
      stat.isSymbolicLink() ||
      !stat.isFile() ||
      stat.size > MAX_STORE_BYTES
    ) {
      throw new Error("SEO_WORKFLOW_STORE_UNSAFE");
    }

    return validateStore(
      JSON.parse(fs.readFileSync(STORE_FILE, "utf8"))
    );
  } catch (error) {
    if (error.code === "ENOENT") {
      return { schemaVersion: 1, records: [] };
    }
    throw error;
  }
}

function atomicWrite(store) {
  const content = JSON.stringify(store, null, 2) + "\n";

  if (Buffer.byteLength(content, "utf8") > MAX_STORE_BYTES) {
    throw new Error("SEO_WORKFLOW_STORE_SIZE_LIMIT");
  }

  const directory = path.dirname(STORE_FILE);
  const temporary = path.join(
    directory,
    ".seo-workflow-" + process.pid + "-" +
      crypto.randomUUID() + ".tmp"
  );

  let descriptor;

  try {
    descriptor = fs.openSync(
      temporary,
      fs.constants.O_WRONLY |
        fs.constants.O_CREAT |
        fs.constants.O_EXCL,
      0o600
    );

    fs.writeFileSync(descriptor, content, "utf8");
    fs.fsyncSync(descriptor);
    fs.closeSync(descriptor);
    descriptor = undefined;

    fs.renameSync(temporary, STORE_FILE);
    fs.chmodSync(STORE_FILE, 0o600);
  } catch (error) {
    if (descriptor !== undefined) {
      try { fs.closeSync(descriptor); } catch {}
    }
    try { fs.unlinkSync(temporary); } catch {}
    throw error;
  }
}

function appendWorkflowRecord(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new TypeError("SEO_WORKFLOW_RECORD_REQUIRED");
  }

  if (
    typeof input.clientId !== "string" ||
    !input.clientId.trim() ||
    typeof input.query !== "string" ||
    !input.brief ||
    typeof input.brief !== "object" ||
    Array.isArray(input.brief)
  ) {
    throw new TypeError("SEO_WORKFLOW_RECORD_FIELDS_INVALID");
  }

  const brief = { ...input.brief };
  delete brief.clientAuthorization;

  const record = {
    id: crypto.randomUUID(),
    schemaVersion: 1,
    createdAt: new Date().toISOString(),
    clientId: input.clientId.trim(),
    brief,
    query: input.query,
    audit: input.audit,
    research: input.research,
    personas: Array.isArray(input.personas) ? input.personas : [],
    contentCalendar: Array.isArray(input.contentCalendar)
      ? input.contentCalendar
      : [],
    assetGeneration: input.assetGeneration || null,
    qualityReview: input.qualityReview || null,
    reviewVersion: 0,
    reviewHistory: [],
    checkpoint: {
      stage: "RESEARCH_COMPLETED",
      status: "AWAITING_HUMAN_REVIEW"
    }
  };

  const serialized = JSON.stringify(record);

  if (Buffer.byteLength(serialized, "utf8") > MAX_RECORD_BYTES) {
    throw new Error("SEO_WORKFLOW_RECORD_SIZE_LIMIT");
  }

  let lockAcquired = false;

  try {
    try {
      fs.mkdirSync(LOCK_DIR, { mode: 0o700 });
      lockAcquired = true;
    } catch (error) {
      if (error.code === "EEXIST") {
        throw new Error("SEO_WORKFLOW_STORE_LOCKED_REVIEW_REQUIRED");
      }
      throw error;
    }

    const store = readStore();

    if (store.records.length >= MAX_RECORDS) {
      throw new Error("SEO_WORKFLOW_STORE_FULL_REVIEW_REQUIRED");
    }

    store.records.push(record);
    atomicWrite(store);

    return {
      saved: true,
      id: record.id,
      createdAt: record.createdAt,
      recordCount: store.records.length
    };
  } finally {
    if (lockAcquired) {
      fs.rmdirSync(LOCK_DIR);
    }
  }
}


function updateWorkflowReview(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new TypeError("SEO_REVIEW_INPUT_INVALID");
  }

  const clientId = typeof input.clientId === "string"
    ? input.clientId.trim()
    : "";
  const workflowId = typeof input.workflowId === "string"
    ? input.workflowId.trim()
    : "";
  const reviewer = typeof input.reviewer === "string"
    ? input.reviewer.trim()
    : "";
  const decision = input.decision;
  const reason = typeof input.reason === "string"
    ? input.reason.trim()
    : "";
  const expectedVersion = input.expectedVersion;

  if (!clientId || clientId.length > 160 ||
      !workflowId || workflowId.length > 160 ||
      !reviewer || reviewer.length > 120 ||
      !["APPROVE", "REJECT", "REQUEST_REVISION"].includes(decision) ||
      reason.length < 10 || reason.length > 1000 ||
      !Number.isInteger(expectedVersion) || expectedVersion < 0) {
    throw new TypeError("SEO_REVIEW_FIELDS_INVALID");
  }

  let lockAcquired = false;

  try {
    try {
      fs.mkdirSync(LOCK_DIR, { mode: 0o700 });
      lockAcquired = true;
    } catch (error) {
      if (error.code === "EEXIST") {
        throw new Error("SEO_WORKFLOW_STORE_LOCKED_REVIEW_REQUIRED");
      }
      throw error;
    }

    const store = readStore();

    const record = store.records.find(item =>
      item &&
      item.id === workflowId &&
      item.clientId === clientId
    );

    if (!record) {
      throw new Error("SEO_REVIEW_WORKFLOW_NOT_FOUND");
    }

    if (!record.qualityReview ||
        !record.qualityReview.review ||
        typeof record.qualityReview.review !== "object") {
      throw new Error("SEO_REVIEW_QUALITY_REVIEW_NOT_FOUND");
    }

    const currentVersion = Number.isInteger(record.reviewVersion)
      ? record.reviewVersion
      : (Array.isArray(record.reviewHistory)
          ? record.reviewHistory.length
          : 0);

    if (currentVersion !== expectedVersion) {
      throw new Error("SEO_REVIEW_VERSION_CONFLICT");
    }

    const currentStatus = record.qualityReview.review.status;

    if (currentStatus !== "PENDING_REVIEW") {
      throw new Error("SEO_REVIEW_DECISION_ALREADY_FINAL");
    }

    const statusByDecision = {
      APPROVE: "APPROVED",
      REJECT: "REJECTED",
      REQUEST_REVISION: "REVISION_REQUESTED"
    };

    const occurredAt = new Date().toISOString();
    const previousEvents = Array.isArray(record.reviewHistory)
      ? record.reviewHistory
      : [];
    const previousHash = previousEvents.length
      ? previousEvents[previousEvents.length - 1].eventHash
      : "0".repeat(64);

    const event = {
      eventId: crypto.randomUUID(),
      version: currentVersion + 1,
      decision,
      previousStatus: currentStatus,
      resultingStatus: statusByDecision[decision],
      reviewer: {
        role: "admin",
        username: reviewer
      },
      reason,
      occurredAt,
      previousHash
    };

    event.eventHash = crypto
      .createHash("sha256")
      .update(JSON.stringify(event))
      .digest("hex");

    record.qualityReview.review = {
      ...record.qualityReview.review,
      status: statusByDecision[decision],
      decision,
      reviewer,
      reviewedAt: occurredAt,
      reason,
      approvalRequired: true,
      approvalGranted: decision === "APPROVE"
    };

    record.reviewVersion = currentVersion + 1;
    record.reviewHistory = [...previousEvents, event];

    const serializedRecord = JSON.stringify(record);
    if (Buffer.byteLength(serializedRecord, "utf8") > MAX_RECORD_BYTES) {
      throw new Error("SEO_WORKFLOW_RECORD_SIZE_LIMIT");
    }

    atomicWrite(store);

    return {
      saved: true,
      workflowId,
      clientId,
      decision,
      reviewStatus: statusByDecision[decision],
      reviewVersion: record.reviewVersion,
      eventHash: event.eventHash,
      reviewedAt: occurredAt,
      publicationAuthorized: false,
      websiteModified: false,
      contentPublished: false,
      externalActions: false
    };
  } finally {
    if (lockAcquired) {
      fs.rmdirSync(LOCK_DIR);
    }
  }
}

function listWorkflowRecords(clientId) {
  const store = readStore();
  const records = store.records.filter(record =>
    !clientId || record.clientId === clientId
  );

  return JSON.parse(JSON.stringify(records));
}

module.exports = {
  STORE_FILE,
  LOCK_DIR,
  appendWorkflowRecord,
  updateWorkflowReview,
  listWorkflowRecords
};
