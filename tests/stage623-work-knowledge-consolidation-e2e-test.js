// Stage 6.2 test-only audit isolation; production audit history is untouched.
(() => {
  const fs = require("fs");
  const path = require("path");
  const auditFile = path.join(process.cwd(), "tmp",
    "stage62-isolated-audit-" +
    path.basename(process.argv[1], ".js") + "-" + process.pid + ".json");
  fs.mkdirSync(path.dirname(auditFile), { recursive: true });
  process.env.MIRA_AUDIT_FILE = auditFile;
  process.on("exit", () => {
    for (const file of [auditFile, auditFile + ".anchor", auditFile + ".tmp"]) {
      try { fs.unlinkSync(file); } catch (_) {}
    }
  });
})();
"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const engine =
  require("../services/mira-work-knowledge-consolidation");

const knowledge =
  require("../knowledge");

const {
  verifyAuditIntegrity
} = require("../audit-log");

const LEARNING_FILE =
  path.join(
    __dirname,
    "..",
    "data",
    "work-learning-records.json"
  );

const CONSOLIDATION_FILE =
  engine.STORE_FILE;

const PROPOSAL_FILE =
  path.join(
    __dirname,
    "..",
    "change-proposals.json"
  );

const AUDIT_FILE =
  path.join(
    __dirname,
    "..",
    "audit-log.json"
  );

function readFileIfExists(file) {
  if (!fs.existsSync(file)) {
    return null;
  }

  return fs.readFileSync(file, "utf8");
}

function restoreFile(file, content) {
  if (content === null) {
    if (fs.existsSync(file)) {
      fs.unlinkSync(file);
    }
    return;
  }

  fs.writeFileSync(file, content, "utf8");
}

function deepClone(value) {
  return JSON.parse(JSON.stringify(value));
}

function sha256(value) {
  const crypto = require("crypto");

  return crypto
    .createHash("sha256")
    .update(String(value), "utf8")
    .digest("hex");
}

function loadLearningRecords() {
  return JSON.parse(
    fs.readFileSync(
      LEARNING_FILE,
      "utf8"
    )
  );
}

function createLearningRecord({
  id,
  taskId,
  executionId,
  planId,
  topic,
  lesson,
  qaStatus = "qa_failed"
}) {
  const record = {
    schemaVersion: 1,

    learningId: id,

    taskId,

    executionId,

    planId,

    taskType: topic,

    task: {
      id: taskId,
      type: topic,
      title: `Stage 6.2.3 ${topic}`,
      description:
        "Controlled work-learning consolidation test."
    },

    execution: {
      success: true,
      status: "execution_completed",
      taskId,
      planId
    },

    qa: {
      status: qaStatus,
      finalAcceptance:
        qaStatus === "qa_passed"
    },

    lessons: [
      lesson
    ],

    knowledgeCandidates: [
      {
        topic,
        lesson,
        candidateType:
          "work-derived-knowledge",
        sourceTaskId: taskId
      }
    ],

    skillUpdateCandidates: [],

    feedback: {
      positive: [],
      negative: []
    },

    proposalCreated: false,

    createdAt:
      new Date().toISOString()
  };

  const legacyRecord =
    deepClone(record);

  delete legacyRecord.integrityHash;

  record.integrityHash =
    sha256(
      JSON.stringify(legacyRecord)
    );

  return record;
}

const snapshots = {
  consolidation:
    readFileIfExists(
      CONSOLIDATION_FILE
    ),

  proposals:
    readFileIfExists(
      PROPOSAL_FILE
    ),

  audit:
    readFileIfExists(
      AUDIT_FILE
    )
};

const originalKnowledge =
  deepClone(
    typeof knowledge.getKnowledge === "function"
      ? knowledge.getKnowledge()
      : []
  );

const originalKnowledgeHash =
  sha256(
    JSON.stringify(originalKnowledge)
  );

let passed = 0;

function pass(message) {
  passed += 1;
  console.log(`PASS: ${message}`);
}

async function main() {
  console.log(
    "STAGE 6.2.3 WORK KNOWLEDGE CONSOLIDATION E2E TEST"
  );

  try {
    if (fs.existsSync(CONSOLIDATION_FILE)) {
      fs.unlinkSync(CONSOLIDATION_FILE);
    }

    const recordA =
      createLearningRecord({
        id: "stage623-record-a",
        taskId: "stage623-task-a",
        executionId:
          "stage623-execution-a",
        planId: "stage623-plan-a",
        topic: "research",
        lesson:
          "Verify every requirement explicitly before final acceptance."
      });

    const first =
      await engine.consolidateLearningRecord(
        recordA,
        {
          createImprovementProposal: false
        }
      );

    assert.strictEqual(
      first.success,
      true
    );

    assert.strictEqual(
      first.stage,
      "6.2.3"
    );

    assert.strictEqual(
      first.consolidated,
      1
    );

    assert.strictEqual(
      first.governanceBoundary
        .canonicalKnowledgeChanged,
      false
    );

    pass(
      "Valid learning evidence was consolidated without changing canonical knowledge"
    );

    let store =
      engine.loadStore();

    assert.strictEqual(
      store.items.length,
      1
    );

    assert.strictEqual(
      store.items[0].evidenceCount,
      1
    );

    assert.strictEqual(
      store.items[0].sourceRecords.length,
      1
    );

    assert.strictEqual(
      store.items[0].sourceRecords[0].taskId,
      "stage623-task-a"
    );

    assert.strictEqual(
      store.items[0].sourceRecords[0].executionId,
      "stage623-execution-a"
    );

    assert.strictEqual(
      store.items[0].sourceRecords[0].planId,
      "stage623-plan-a"
    );

    pass(
      "Task/execution/plan provenance was preserved"
    );

    const duplicate =
      await engine.consolidateLearningRecord(
        recordA,
        {
          createImprovementProposal: false
        }
      );

    assert.strictEqual(
      duplicate.success,
      true
    );

    assert.strictEqual(
      duplicate.results[0].status,
      "knowledge_duplicate"
    );

    store =
      engine.loadStore();

    assert.strictEqual(
      store.items.length,
      1
    );

    assert.strictEqual(
      store.items[0].evidenceCount,
      1
    );

    pass(
      "Duplicate learning evidence is idempotent and does not inflate evidence"
    );

    const recordB =
      createLearningRecord({
        id: "stage623-record-b",
        taskId: "stage623-task-b",
        executionId:
          "stage623-execution-b",
        planId: "stage623-plan-b",
        topic: "research",
        lesson:
          "Verify every requirement explicitly before final acceptance."
      });

    const second =
      await engine.consolidateLearningRecord(
        recordB,
        {
          createImprovementProposal: false
        }
      );

    assert.strictEqual(
      second.success,
      true
    );

    store =
      engine.loadStore();

    assert.strictEqual(
      store.items.length,
      1
    );

    assert.strictEqual(
      store.items[0].evidenceCount,
      2
    );

    assert.strictEqual(
      store.items[0].sourceRecords.length,
      2
    );

    assert.ok(
      store.items[0].confidence.score >
        0.5
    );

    assert.notStrictEqual(
      store.items[0].confidence.level,
      "initial"
    );

    pass(
      "Independent work evidence was consolidated into one reusable knowledge item"
    );

    const sourceIds =
      store.items[0].sourceRecords.map(
        source => source.recordId
      );

    assert.ok(
      sourceIds.includes(
        "stage623-record-a"
      )
    );

    assert.ok(
      sourceIds.includes(
        "stage623-record-b"
      )
    );

    pass(
      "Multiple source record IDs remain traceable"
    );

    const knowledgeAfter =
      deepClone(
        knowledge.getKnowledge()
      );

    assert.strictEqual(
      sha256(
        JSON.stringify(knowledgeAfter)
      ),
      originalKnowledgeHash
    );

    assert.deepStrictEqual(
      knowledgeAfter,
      originalKnowledge
    );

    pass(
      "Canonical knowledge store remained unchanged"
    );

    const proposalBefore =
      fs.existsSync(PROPOSAL_FILE)
        ? readFileIfExists(PROPOSAL_FILE)
        : null;

    const proposalRun =
      await engine.consolidateLearningRecord(
        createLearningRecord({
          id: "stage623-record-c",
          taskId: "stage623-task-c",
          executionId:
            "stage623-execution-c",
          planId: "stage623-plan-c",
          topic: "research",
          lesson:
            "Verify every requirement explicitly before final acceptance."
        }),
        {
          createImprovementProposal: true
        }
      );

    assert.strictEqual(
      proposalRun.success,
      true
    );

    assert.strictEqual(
      proposalRun.status,
      "proposal_created"
    );

    assert.ok(
      proposalRun.proposal,
      "Expected a consolidation proposal to be created."
    );

    assert.strictEqual(
      proposalRun.proposal.category,
      "self_improvement"
    );

    assert.strictEqual(
      proposalRun.proposal.metadata.stage,
      "6.2.3"
    );

    assert.strictEqual(
      proposalRun.proposal.metadata.learningSource,
      "completed-work"
    );

    assert.strictEqual(
      proposalRun.proposal.metadata.evidenceCount,
      3
    );

    assert.ok(
      proposalRun.proposal.metadata.consolidationFingerprint,
      "Expected consolidation fingerprint in proposal metadata."
    );

    const proposalAfter =
      readFileIfExists(PROPOSAL_FILE);

    assert.notStrictEqual(
      proposalAfter,
      proposalBefore
    );

    pass(
      "Repeated work evidence created one governed 4.17 knowledge-consolidation proposal"
    );

    const proposalCountAfterFirst =
      Array.isArray(
        require("../change-management").listProposals({
          category: "self_improvement"
        })
      )
        ? require("../change-management").listProposals({
            category: "self_improvement"
          }).length
        : 0;

    const duplicateProposalRun =
      await engine.consolidateLearningRecord(
        createLearningRecord({
          id: "stage623-record-d",
          taskId: "stage623-task-d",
          executionId:
            "stage623-execution-d",
          planId: "stage623-plan-d",
          topic: "research",
          lesson:
            "Verify every requirement explicitly before final acceptance."
        }),
        {
          createImprovementProposal: true
        }
      );

    assert.strictEqual(
      duplicateProposalRun.success,
      true
    );

    const proposalCountAfterDuplicate =
      require("../change-management").listProposals({
        category: "self_improvement"
      }).length;

    assert.strictEqual(
      proposalCountAfterDuplicate,
      proposalCountAfterFirst
    );

    pass(
      "Duplicate consolidation evidence did not create a second 4.17 proposal"
    );

    const tampered =
      deepClone(recordA);

    tampered.lessons = [
      "Tampered lesson that was not part of the signed learning record."
    ];

    const invalid =
      await engine.consolidateLearningRecord(
        tampered,
        {
          createImprovementProposal: true
        }
      );

    assert.strictEqual(
      invalid.success,
      false
    );

    assert.strictEqual(
      invalid.status,
      "learning_record_integrity_failed"
    );

    pass(
      "Tampered learning evidence was rejected"
    );

    const missingProvenance =
      deepClone(recordA);

    missingProvenance.learningId =
      "";

    const missing =
      await engine.consolidateLearningRecord(
        missingProvenance
      );

    assert.strictEqual(
      missing.success,
      false
    );

    assert.strictEqual(
      missing.status,
      "learning_record_id_missing"
    );

    pass(
      "Learning evidence without required provenance was rejected"
    );

    const integrity =
      engine.verifyStoreIntegrity();

    assert.strictEqual(
      integrity.valid,
      true
    );

    assert.strictEqual(
      integrity.itemCount,
      engine.getConsolidatedKnowledge().length
    );

    pass(
      "Consolidation store integrity verified"
    );

    const stats =
      engine.getConsolidationStats();

    assert.strictEqual(
      stats.engineVersion,
      "6.2.3"
    );

    assert.ok(
      stats.items >= 1
    );

    assert.ok(
      stats.totalEvidence >= 2
    );

    pass(
      "Consolidation statistics are consistent"
    );

    assert.strictEqual(
      proposalRun.governanceBoundary
        .approvalRequired,
      true
    );

    assert.strictEqual(
      proposalRun.governanceBoundary
        .autoApproved,
      false
    );

    assert.strictEqual(
      proposalRun.governanceBoundary
        .autoApplied,
      false
    );

    pass(
      "4.17 governance approval boundary remains enforced"
    );

    const auditIntegrity =
      verifyAuditIntegrity();

    assert.strictEqual(
      auditIntegrity.ok,
      true
    );

    pass(
      "Audit integrity verified"
    );

    console.log(
      `STAGE6_2_3_WORK_KNOWLEDGE_CONSOLIDATION_E2E_TEST: PASS (${passed} checks)`
    );
  } finally {
    restoreFile(
      CONSOLIDATION_FILE,
      snapshots.consolidation
    );

    restoreFile(
      PROPOSAL_FILE,
      snapshots.proposals
    );

    restoreFile(
      AUDIT_FILE,
      snapshots.audit
    );

    const finalKnowledge =
      deepClone(
        knowledge.getKnowledge()
      );

    assert.deepStrictEqual(
      finalKnowledge,
      originalKnowledge
    );

    console.log(
      "PASS: Production/local state restored"
    );
  }
}

main().catch(error => {
  console.error(
    "STAGE6_2_3_WORK_KNOWLEDGE_CONSOLIDATION_E2E_TEST: FAIL"
  );
  console.error(
    error && error.stack
      ? error.stack
      : error
  );

  process.exitCode = 1;
});
