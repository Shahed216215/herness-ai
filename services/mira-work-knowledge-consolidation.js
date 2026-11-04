"use strict";

const fs = require("fs");
const path = require("path");
const storagePath = require('../mira-storage');
const crypto = require("crypto");
const jsonStateStore = require("./mira-json-state-store");
const { createStoreInitializationGuard } = require('./mira-store-initialization-guard');

const {
  createProposal,
  listProposals
} = require("../change-management");

const {
  recordAudit
} = require("../audit-log");

const ENGINE_VERSION = "6.2.3";

const DATA_DIR = storagePath("data");
const STORE_FILE = path.join(
  DATA_DIR,
  "work-knowledge-consolidation.json"
);
const STORE_GUARD = createStoreInitializationGuard({
  primaryFile: STORE_FILE,
  storeId: 'MIRA_WORK_KNOWLEDGE_CONSOLIDATION'
});

const MAX_ITEMS = 5000;
const MAX_SOURCES_PER_ITEM = 100;
const MAX_TEXT = 2000;
const MAX_LESSONS_PER_RECORD = 50;
const MAX_CANDIDATES_PER_RECORD = 50;

function asObject(value) {
  return (
    value &&
    typeof value === "object" &&
    !Array.isArray(value)
  )
    ? value
    : {};
}

function cleanText(value, max = MAX_TEXT) {
  if (value === null || value === undefined) {
    return "";
  }

  return String(value)
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}

function cleanList(value, maxItems = 50) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map(item => cleanText(item))
    .filter(Boolean)
    .slice(0, maxItems);
}

function sha256(value) {
  return crypto
    .createHash("sha256")
    .update(String(value), "utf8")
    .digest("hex");
}

function stableNormalize(value) {
  if (Array.isArray(value)) {
    return value.map(stableNormalize);
  }

  if (value && typeof value === "object") {
    return Object.keys(value)
      .sort()
      .reduce((result, key) => {
        result[key] = stableNormalize(value[key]);
        return result;
      }, {});
  }

  return value;
}

function stableStringify(value) {
  return JSON.stringify(stableNormalize(value));
}

function calculateIntegrityHash(store) {
  const clone = JSON.parse(JSON.stringify(store));
  delete clone.integrityHash;

  return sha256(stableStringify(clone));
}

function emptyStore() {
  const store = {
    schemaVersion: 1,
    engineVersion: ENGINE_VERSION,
    updatedAt: new Date().toISOString(),
    items: []
  };

  store.integrityHash = calculateIntegrityHash(store);

  return store;
}

function normalizeStore(raw) {
  const source = asObject(raw);

  if (!Array.isArray(source.items)) {
    throw new Error("Work knowledge consolidation store items must be an array.");
  }
  if (source.items.length > MAX_ITEMS) {
    throw new Error("Work knowledge consolidation store exceeds the supported item limit; refusing truncation.");
  }
  const items = source.items.slice();

  return {
    schemaVersion:
      Number.isInteger(source.schemaVersion)
        ? source.schemaVersion
        : 1,

    engineVersion:
      cleanText(source.engineVersion, 50) ||
      ENGINE_VERSION,

    updatedAt:
      cleanText(source.updatedAt, 100) ||
      new Date().toISOString(),

    items
  };
}

function loadStore() {
  let rawText;
  try {
    const stat = fs.lstatSync(STORE_FILE);
    if (stat.isSymbolicLink() || !stat.isFile()) {
      throw new Error("Work knowledge consolidation store is not a safe regular file.");
    }
    rawText = fs.readFileSync(STORE_FILE, "utf8");
  } catch (error) {
    if (error.code === "ENOENT") {
      if (STORE_GUARD.missingPrimaryDecision() === 'PREVIOUSLY_INITIALIZED') {
        const missing = new Error(
          'Work knowledge consolidation store was previously initialized but its primary is missing; empty reinitialization is blocked.'
        );
        missing.code = 'WORK_KNOWLEDGE_CONSOLIDATION_PRIMARY_MISSING_RESTORE_REQUIRED';
        throw missing;
      }
      return emptyStore();
    }
    throw new Error(
      `Work knowledge consolidation store cannot be read: ${error.code || error.message || "IO_ERROR"}`
    );
  }

  if (!rawText.trim()) {
    throw new Error("Work knowledge consolidation store is empty and may be corrupted.");
  }

  let raw;
  try {
    raw = JSON.parse(rawText);
  } catch {
    throw new Error("Work knowledge consolidation store contains invalid JSON.");
  }

  if (!raw || typeof raw !== "object" || Array.isArray(raw) || !Array.isArray(raw.items)) {
    throw new Error("Work knowledge consolidation store must contain an object with an items array.");
  }

  if (raw.integrityHash && raw.integrityHash !== calculateIntegrityHash(raw)) {
    throw new Error("Work knowledge consolidation integrity check failed.");
  }

  const store = normalizeStore(raw);
  store.integrityHash = calculateIntegrityHash(store);
  STORE_GUARD.ensureMarker();
  return store;
}

function saveStore(store) {
  if (!store || typeof store !== "object" || Array.isArray(store) || !Array.isArray(store.items)) {
    throw new Error("Work knowledge consolidation store must include an items array before saving.");
  }
  loadStore();
  STORE_GUARD.assertWritable();
  const normalized = normalizeStore(store);
  normalized.updatedAt = new Date().toISOString();
  normalized.integrityHash = calculateIntegrityHash(normalized);
  const result = jsonStateStore.atomicWriteJson(
    STORE_FILE,
    normalized,
    "Work knowledge consolidation"
  );
  try {
    jsonStateStore.recordStateAudit(
      "work_knowledge_consolidation_write_committed",
      "success",
      STORE_FILE,
      { stateHash: result.sha256, itemCount: normalized.items.length }
    );
  } catch (error) {
    error.code = "WORK_KNOWLEDGE_CONSOLIDATION_COMMITTED_AUDIT_FAILED";
    error.stateCommitted = true;
    throw error;
  }
  return normalized;
}

function calculateLearningRecordIntegrityHash(record) {
  const clone = JSON.parse(
    JSON.stringify(record)
  );

  delete clone.integrityHash;

  const schemaVersion =
    Number(record.schemaVersion || 1);

  return schemaVersion === 1
    ? sha256(JSON.stringify(clone))
    : sha256(stableStringify(clone));
}

function normalizeSource(record) {
  return {
    recordId:
      cleanText(record.learningId, 200),

    taskId:
      cleanText(record.taskId, 200),

    executionId:
      cleanText(record.executionId, 200),

    planId:
      cleanText(record.planId, 200),

    qaStatus:
      cleanText(
        asObject(record.qa).status,
        100
      )
  };
}

function validateLearningRecord(record) {
  if (!record || typeof record !== "object") {
    return {
      valid: false,
      reason: "learning_record_invalid"
    };
  }

  if (!record.learningId) {
    return {
      valid: false,
      reason: "learning_record_id_missing"
    };
  }

  if (!record.taskId) {
    return {
      valid: false,
      reason: "learning_record_task_id_missing"
    };
  }

  if (!record.executionId) {
    return {
      valid: false,
      reason: "learning_record_execution_id_missing"
    };
  }

  if (!record.integrityHash) {
    return {
      valid: false,
      reason: "learning_record_integrity_missing"
    };
  }

  const expectedHash =
    calculateLearningRecordIntegrityHash(record);

  const integrity = {
    learningId:
      record.learningId,

    schemaVersion:
      Number(record.schemaVersion || 1),

    valid:
      expectedHash === record.integrityHash,

    expectedHash,

    storedHash:
      record.integrityHash
  };

  if (!integrity.valid) {
    return {
      valid: false,
      reason: "learning_record_integrity_failed",
      integrity
    };
  }

  return {
    valid: true,
    integrity
  };
}

function normalizeCandidate(candidate, taskId) {
  const source = asObject(candidate);

  const lesson =
    cleanText(
      source.lesson ||
      source.content ||
      source.knowledge ||
      source.text
    );

  const topic =
    cleanText(
      source.topic ||
      source.category ||
      "general-work",
      300
    ) || "general-work";

  if (!lesson) {
    return null;
  }

  const canonicalPayload = {
    topic: topic.toLowerCase(),
    lesson: lesson.toLowerCase()
  };

  return {
    topic,
    lesson,
    candidateType:
      cleanText(
        source.candidateType,
        100
      ) || "work-derived-knowledge",
    sourceTaskId:
      cleanText(
        source.sourceTaskId || taskId,
        200
      ),
    fingerprint:
      sha256(
        stableStringify(canonicalPayload)
      )
  };
}

function deriveCandidates(record) {
  const task = asObject(record.task);

  const candidates = [];

  for (
    const candidate of Array.isArray(record.knowledgeCandidates)
      ? record.knowledgeCandidates.slice(
          0,
          MAX_CANDIDATES_PER_RECORD
        )
      : []
  ) {
    const normalized =
      normalizeCandidate(
        candidate,
        record.taskId
      );

    if (normalized) {
      candidates.push(normalized);
    }
  }

  for (
    const lesson of Array.isArray(record.lessons)
      ? record.lessons.slice(
          0,
          MAX_LESSONS_PER_RECORD
        )
      : []
  ) {
    const normalized =
      normalizeCandidate(
        {
          lesson,
          topic:
            task.type ||
            record.taskType ||
            "general-work",
          candidateType:
            "work-derived-lesson",
          sourceTaskId:
            record.taskId
        },
        record.taskId
      );

    if (normalized) {
      candidates.push(normalized);
    }
  }

  const unique = new Map();

  for (const candidate of candidates) {
    if (!unique.has(candidate.fingerprint)) {
      unique.set(
        candidate.fingerprint,
        candidate
      );
    }
  }

  return [...unique.values()];
}

function createConsolidationItem(candidate, source) {
  const now = new Date().toISOString();

  return {
    id: `wk_${candidate.fingerprint.slice(0, 24)}`,
    fingerprint: candidate.fingerprint,
    topic: candidate.topic,
    lesson: candidate.lesson,
    candidateType: candidate.candidateType,

    evidenceCount: 1,

    firstSeenAt: now,
    lastSeenAt: now,

    sourceRecords: [source],

    qaStatuses: source.qaStatus
      ? [source.qaStatus]
      : [],

    confidence: {
      score: 0.5,
      level: "initial",
      evidenceCount: 1
    },

    reusable: true,

    proposalCreated: false,
    proposalId: null
  };
}

function mergeEvidence(item, source) {
  const sourceKey =
    [
      source.recordId,
      source.taskId,
      source.executionId
    ]
      .filter(Boolean)
      .join("|");

  const alreadyKnown =
    item.sourceRecords.some(existing =>
      [
        existing.recordId,
        existing.taskId,
        existing.executionId
      ]
        .filter(Boolean)
        .join("|") === sourceKey
    );

  if (alreadyKnown) {
    return {
      item,
      duplicateEvidence: true
    };
  }

  const updated = {
    ...item,

    evidenceCount:
      Number(item.evidenceCount || 0) + 1,

    lastSeenAt:
      new Date().toISOString(),

    sourceRecords: [
      ...(Array.isArray(item.sourceRecords)
        ? item.sourceRecords
        : []),
      source
    ].slice(
      -MAX_SOURCES_PER_ITEM
    )
  };

  const statuses = new Set(
    Array.isArray(item.qaStatuses)
      ? item.qaStatuses
      : []
  );

  if (source.qaStatus) {
    statuses.add(source.qaStatus);
  }

  updated.qaStatuses = [...statuses];

  const evidenceCount =
    updated.evidenceCount;

  const score =
    Math.min(
      0.95,
      0.5 +
      Math.min(
        0.4,
        (evidenceCount - 1) * 0.15
      )
    );

  updated.confidence = {
    score,
    level:
      score >= 0.8
        ? "high"
        : score >= 0.65
          ? "medium"
          : "initial",
    evidenceCount
  };

  return {
    item: updated,
    duplicateEvidence: false
  };
}

function proposalFingerprint(item) {
  return sha256(
    stableStringify({
      type: "knowledge-consolidation",
      fingerprint: item.fingerprint,
      topic: item.topic
    })
  );
}

function findExistingProposal(item) {
  const fingerprint =
    proposalFingerprint(item);

  const proposals =
    listProposals({
      category: "self_improvement"
    });

  for (const proposal of proposals) {
    if (
      proposal &&
      proposal.metadata &&
      proposal.metadata.consolidationFingerprint ===
        fingerprint
    ) {
      return proposal;
    }
  }

  return null;
}

function createKnowledgeProposal(item) {
  const fingerprint =
    proposalFingerprint(item);

  const existing =
    findExistingProposal(item);

  if (existing) {
    return {
      created: false,
      duplicate: true,
      proposal: existing
    };
  }

  const proposal =
    createProposal({
      title:
        `Consolidated work knowledge: ${item.topic}`,

      reason:
        `Repeated work evidence supports reusable knowledge: ${item.lesson}`,

      expectedBenefit:
        `Reuse validated work-derived knowledge for future ${item.topic} tasks.`,

      category:
        "self_improvement",

      risk:
        item.confidence.level === "high"
          ? "low"
          : "medium",

      actor:
        "stage6.2.3-work-knowledge-consolidation",

      affectedResources: [
        "knowledge",
        "work-knowledge-consolidation"
      ],

      estimatedComplexity:
        "low",

      backupRequired:
        true,

      testRequired:
        true,

      metadata: {
        stage: "6.2.3",
        learningSource:
          "completed-work",
        consolidationFingerprint:
          fingerprint,
        knowledgeFingerprint:
          item.fingerprint,
        topic: item.topic,
        lesson: item.lesson,
        evidenceCount:
          item.evidenceCount,
        sourceRecords:
          item.sourceRecords,
        qaStatuses:
          item.qaStatuses,
        confidence:
          item.confidence
      }
    });

  return {
    created: true,
    duplicate: false,
    proposal
  };
}

async function consolidateLearningRecord(
  record,
  options = {}
) {
  const validation =
    validateLearningRecord(record);

  if (!validation.valid) {
    return {
      success: false,
      stage: "6.2.3",
      engineVersion: ENGINE_VERSION,
      status: validation.reason,
      error:
        validation.reason,
      integrity:
        validation.integrity || null
    };
  }

  const candidates =
    deriveCandidates(record);

  if (candidates.length === 0) {
    return {
      success: true,
      stage: "6.2.3",
      engineVersion: ENGINE_VERSION,
      status: "no_reusable_knowledge",
      recordId: record.id,
      taskId: record.taskId,
      executionId: record.executionId,
      planId: record.planId || "",
      consolidated: 0,
      proposal: null
    };
  }

  const store = loadStore();
  const source =
    normalizeSource(record);

  const results = [];
  let proposalCreated = null;

  for (const candidate of candidates) {
    const existing =
      store.items.find(
        item =>
          item &&
          item.fingerprint ===
            candidate.fingerprint
      );

    let item;

    if (!existing) {
      item =
        createConsolidationItem(
          candidate,
          source
        );

      store.items.push(item);
    } else {
      const merged =
        mergeEvidence(
          existing,
          source
        );

      item = merged.item;

      const index =
        store.items.indexOf(existing);

      if (index >= 0) {
        store.items[index] = item;
      }

      if (merged.duplicateEvidence) {
        results.push({
          fingerprint:
            candidate.fingerprint,
          status:
            "knowledge_duplicate",
          itemId: item.id
        });

        continue;
      }
    }

    results.push({
      fingerprint:
        candidate.fingerprint,
      status:
        existing
          ? "knowledge_consolidated"
          : "knowledge_created",
      itemId: item.id,
      evidenceCount:
        item.evidenceCount
    });

    const shouldCreateProposal =
      options.createImprovementProposal === true &&
      item.evidenceCount >= 2 &&
      item.confidence.level !== "initial";

    if (shouldCreateProposal) {
      const proposalResult =
        createKnowledgeProposal(item);

      if (proposalResult.created) {
        item.proposalCreated = true;
        item.proposalId =
          proposalResult.proposal?.changeId ||
          null;

        proposalCreated =
          proposalResult.proposal;
      } else if (proposalResult.duplicate) {
        item.proposalCreated = true;
        item.proposalId =
          proposalResult.proposal?.changeId ||
          item.proposalId ||
          null;
      }
    }
  }

  const saved =
    saveStore(store);

  if (typeof recordAudit === "function") {
    recordAudit({
      actorRole:
        "stage6.2.3-work-knowledge-consolidation",

      action:
        "work_knowledge_consolidated",

      resource:
        "work-knowledge-consolidation",

      resourceId:
        record.id,

      status:
        "success",

      details: {
        stage:
          "6.2.3",

        taskId:
          record.taskId,

        executionId:
          record.executionId,

        planId:
          record.planId || "",

        candidateCount:
          candidates.length,

        resultCount:
          results.length,

        proposalCreated:
          Boolean(proposalCreated)
      }
    });
  }

  return {
    success: true,
    stage: "6.2.3",
    engineVersion: ENGINE_VERSION,
    status:
      proposalCreated
        ? "proposal_created"
        : "knowledge_consolidated",

    recordId:
      record.id,

    taskId:
      record.taskId,

    executionId:
      record.executionId,

    planId:
      record.planId || "",

    qaStatus:
      asObject(record.qa).status || "",

    consolidated:
      results.filter(
        result =>
          result.status ===
            "knowledge_created" ||
          result.status ===
            "knowledge_consolidated"
      ).length,

    results,

    proposal:
      proposalCreated,

    governanceBoundary: {
      canonicalKnowledgeChanged:
        false,

      approvalRequired:
        true,

      autoApproved:
        false,

      autoApplied:
        false
    },

    storeIntegrityHash:
      saved.integrityHash
  };
}

function verifyStoreIntegrity() {
  let stat;
  try {
    stat = fs.lstatSync(STORE_FILE);
  } catch (error) {
    if (error.code === 'ENOENT' &&
        STORE_GUARD.missingPrimaryDecision() === 'PREVIOUSLY_INITIALIZED') {
      const missing = new Error(
        'Work knowledge consolidation store was previously initialized but its primary is missing; integrity verification is blocked.'
      );
      missing.code = 'WORK_KNOWLEDGE_CONSOLIDATION_PRIMARY_MISSING_RESTORE_REQUIRED';
      throw missing;
    }
    if (error.code === 'ENOENT') {
      return { valid: false, reason: 'FIRST_RUN_STORE_MISSING', itemCount: 0 };
    }
    throw error;
  }
  if (stat.isSymbolicLink() || !stat.isFile()) {
    throw new Error("Work knowledge consolidation store is not a safe regular file.");
  }
  STORE_GUARD.ensureMarker();

  const raw = JSON.parse(fs.readFileSync(STORE_FILE, "utf8"));
  if (!raw || typeof raw !== "object" || Array.isArray(raw) || !Array.isArray(raw.items)) {
    throw new Error("Work knowledge consolidation store must contain an object with an items array.");
  }

  const expected = calculateIntegrityHash(raw);
  return {
    valid: typeof raw.integrityHash === "string" && raw.integrityHash === expected,
    schemaVersion: raw.schemaVersion,
    itemCount: raw.items.length,
    integrityHash: raw.integrityHash || null,
    expectedHash: expected
  };
}

function getConsolidatedKnowledge() {
  return loadStore().items;
}

function getConsolidationStats() {
  const items =
    getConsolidatedKnowledge();

  let evidence = 0;
  let proposals = 0;

  for (const item of items) {
    evidence +=
      Number(item.evidenceCount || 0);

    if (item.proposalCreated) {
      proposals += 1;
    }
  }

  return {
    engineVersion:
      ENGINE_VERSION,

    items:
      items.length,

    totalEvidence:
      evidence,

    proposals:
      proposals
  };
}

module.exports = {
  ENGINE_VERSION,
  STORE_FILE,
  INITIALIZATION_FILE: STORE_GUARD.markerFile,

  loadStore,
  saveStore,

  validateLearningRecord,
  deriveCandidates,

  proposalFingerprint,
  findExistingProposal,
  createKnowledgeProposal,

  consolidateLearningRecord,

  verifyStoreIntegrity,
  getConsolidatedKnowledge,
  getConsolidationStats
};
