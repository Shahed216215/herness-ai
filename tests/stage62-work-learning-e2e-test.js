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

const PROJECT_ROOT =
  path.resolve(__dirname, "..");

const LEARNING_FILE =
  path.join(
    PROJECT_ROOT,
    "data",
    "work-learning-records.json"
  );

const CHANGE_FILE =
  path.join(
    PROJECT_ROOT,
    "change-proposals.json"
  );

const AUDIT_FILE =
  path.join(
    PROJECT_ROOT,
    "audit-log.json"
  );

const SNAPSHOT_ROOT =
  path.join(
    PROJECT_ROOT,
    ".runtime"
  );

const learning =
  require("../services/mira-work-learning-engine");

const changeManagement =
  require("../change-management");

const audit =
  require("../audit-log");

function readJson(file) {
  return JSON.parse(
    fs.readFileSync(
      file,
      "utf8"
    )
  );
}

function writeJson(file, value) {
  fs.writeFileSync(
    file,
    JSON.stringify(
      value,
      null,
      2
    ) + "\n",
    "utf8"
  );
}

function snapshotFile(
  source,
  destination
) {
  fs.copyFileSync(
    source,
    destination
  );
}

function restoreFile(
  snapshot,
  destination
) {
  fs.copyFileSync(
    snapshot,
    destination
  );
}

function fileExists(file) {
  return fs.existsSync(file);
}

function makeTask(
  id,
  overrides = {}
) {
  return {
    id,
    title:
      overrides.title ||
      "Stage 6.2 controlled work task",
    description:
      overrides.description ||
      "Controlled task used by Stage 6.2 E2E verification.",
    type:
      overrides.type ||
      "writing",
    requirements:
      overrides.requirements ||
      [
        "Follow the supplied requirements."
      ],
    deliverables:
      overrides.deliverables ||
      [
        "Completed controlled result."
      ],
    requiredSkills:
      overrides.requiredSkills ||
      [
        "writing"
      ],
    risk:
      overrides.risk ||
      "low",
    status:
      "completed"
  };
}

function makeExecution(
  task,
  executionId,
  overrides = {}
) {
  return {
    success:
      overrides.success !== false,
    stage:
      "5.4",
    status:
      overrides.status ||
      "execution_completed",
    executionStarted:
      true,
    taskId:
      task.id,
    planId:
      overrides.planId ||
      `${task.id}-plan`,
    executionId,
    autonomousApproval:
      true,
    results:
      overrides.results ||
      [
        {
          type:
            "text",
          status:
            "completed",
          output:
            "Controlled execution result."
        }
      ],
    recoveryRequired:
      overrides.recoveryRequired === true,
    recoveryReason:
      overrides.recoveryReason ||
      "",
    startedAt:
      "2026-10-04T18:00:00.000Z",
    completedAt:
      "2026-10-04T18:03:00.000Z"
  };
}

function makeQA(
  task,
  overrides = {}
) {
  const failed =
    overrides.status ===
      "qa_failed" ||
    overrides.success === false;

  return {
    success:
      !failed,
    status:
      failed
        ? "qa_failed"
        : "qa_passed",
    stage:
      "6.1",
    engineVersion:
      "6.1.0",
    taskId:
      task.id,
    planId:
      `${task.id}-plan`,
    checks:
      failed
        ? [
            {
              name:
                "requirements",
              passed:
                false,
              reason:
                "A requirement was missed."
            }
          ]
        : [
            {
              name:
                "requirements",
              passed:
                true,
              reason:
                ""
            },
            {
              name:
                "deliverables",
              passed:
                true,
              reason:
                ""
            }
          ],
    failedChecks:
      failed
        ? [
            "requirements"
          ]
        : [],
    reasons:
      failed
        ? [
            "A requirement verification step was missed."
          ]
        : [],
    reworkRequired:
      failed,
    recoveryRequired:
      false,
    finalAcceptance:
      !failed,
    reworkContext:
      failed
        ? {
            reason:
              "Requirement verification failed."
          }
        : null,
    evaluatedAt:
      "2026-10-04T18:03:00.000Z"
  };
}

function proposalIdOf(
  proposal
) {
  return (
    proposal?.changeId ||
    proposal?.id ||
    null
  );
}

function assertGovernanceSafe(
  result
) {
  assert.ok(
    result &&
    result.record &&
    result.record.governance
  );

  assert.strictEqual(
    result.record.governance
      .approvalRequired,
    true
  );

  assert.strictEqual(
    result.record.governance
      .autoApplied,
    false
  );

  if (result.proposal) {
    assert.notStrictEqual(
      result.proposal.status,
      "approved"
    );

    assert.notStrictEqual(
      result.proposal.status,
      "applied"
    );
  }
}

function assertStatsDelta(
  before,
  after,
  field,
  minimumDelta
) {
  assert.ok(
    after[field] >=
      before[field] +
        minimumDelta,
    `${field} delta is below expected minimum`
  );
}

function main() {
  console.log(
    "STAGE 6.2.1 WORK LEARNING E2E TEST"
  );

  fs.mkdirSync(
    SNAPSHOT_ROOT,
    {
      recursive: true
    }
  );

  const snapshotDir =
    path.join(
      SNAPSHOT_ROOT,
      `stage62-e2e-${Date.now()}`
    );

  fs.mkdirSync(
    snapshotDir,
    {
      recursive: true
    }
  );

  const snapshotLearning =
    path.join(
      snapshotDir,
      "work-learning-records.json"
    );

  const snapshotChanges =
    path.join(
      snapshotDir,
      "change-proposals.json"
    );

  const snapshotAudit =
    path.join(
      snapshotDir,
      "audit-log.json"
    );

  const files = [
    [
      LEARNING_FILE,
      snapshotLearning
    ],
    [
      CHANGE_FILE,
      snapshotChanges
    ],
    [
      AUDIT_FILE,
      snapshotAudit
    ]
  ];

  let snapshotsReady =
    false;

  try {
    for (const [
      source,
      destination
    ] of files) {
      assert.ok(
        fileExists(source),
        `Required file missing: ${source}`
      );

      snapshotFile(
        source,
        destination
      );
    }

    snapshotsReady =
      true;

    console.log(
      "PASS: Production/local state snapshot created"
    );

    const baselineStats =
      learning.getLearningStats();

    const baselineAudit =
      audit.getAuditLog();

    const baselineProposals =
      changeManagement.listProposals();

    /*
     * 1. Successful QA with no actionable
     * improvement must create learning evidence
     * but no improvement proposal.
     */
    const successTask =
      makeTask(
        "task-stage62-1-success-a"
      );

    const successExecution =
      makeExecution(
        successTask,
        "execution-stage62-success-a"
      );

    const successQA =
      makeQA(
        successTask
      );

    const successLearning =
      learning.learnFromWork({
        task:
          successTask,
        executionResult:
          successExecution,
        qaResult:
          successQA,
        feedback: {
          summary:
            "The controlled result was accepted.",
          positive: [
            "Requirements were clear."
          ],
          negative: [],
          requestedChanges: []
        }
      });

    assert.strictEqual(
      successLearning.success,
      true
    );

    assert.strictEqual(
      successLearning.status,
      "no_improvement_proposed"
    );

    assert.strictEqual(
      successLearning.proposal,
      null
    );

    assert.strictEqual(
      successLearning.record
        .governance
        .proposalCreated,
      false
    );

    assert.strictEqual(
      successLearning.record
        .governance
        .approvalRequired,
      true
    );

    assert.strictEqual(
      successLearning.record
        .governance
        .autoApplied,
      false
    );

    assertGovernanceSafe(
      successLearning
    );

    console.log(
      "PASS: Successful QA with no actionable improvement creates no proposal"
    );

    /*
     * 2. Failed QA must produce learning evidence
     * and an approval-gated improvement proposal.
     */
    const failedTask =
      makeTask(
        "task-stage62-1-failure-a"
      );

    const failedExecution =
      makeExecution(
        failedTask,
        "execution-stage62-failed-a",
        {
          success:
            false,
          status:
            "post_execution_verification_failed",
          recoveryRequired:
            true,
          recoveryReason:
            "Controlled verification failure."
        }
      );

    const failedQA =
      makeQA(
        failedTask,
        {
          status:
            "qa_failed",
          success:
            false
        }
      );

    const failedLearning =
      learning.learnFromWork({
        task:
          failedTask,
        executionResult:
          failedExecution,
        qaResult:
          failedQA,
        feedback: {
          summary:
            "Controlled QA failure requires improvement.",
          positive: [],
          negative: [
            "A requirement verification step was missed."
          ],
          requestedChanges: [
            "Verify every requirement before completion."
          ]
        }
      });

    assert.strictEqual(
      failedLearning.success,
      true
    );

    assert.strictEqual(
      failedLearning.status,
      "proposal_created"
    );

    assert.strictEqual(
      failedLearning.record.qa.status,
      "qa_failed"
    );

    assert.ok(
      failedLearning.record
        .whatFailed.length > 0
    );

    assert.ok(
      failedLearning.record
        .skillUpdateCandidates
        .length > 0
    );

    assert.ok(
      failedLearning.record
        .lessons.length > 0
    );

    assertGovernanceSafe(
      failedLearning
    );

    assert.ok(
      failedLearning.proposal
    );

    console.log(
      "PASS: Failed QA creates learning evidence and proposal"
    );

    /*
     * 3. Proposal must exist and remain
     * approval-gated.
     */
    const createdProposalId =
      proposalIdOf(
        failedLearning.proposal
      );

    assert.ok(
      createdProposalId,
      "Created proposal must have an identifier"
    );

    const proposalAfterCreation =
      changeManagement.getProposal(
        createdProposalId
      );

    assert.ok(
      proposalAfterCreation,
      "Created proposal must be retrievable"
    );

    assert.notStrictEqual(
      proposalAfterCreation.status,
      "approved"
    );

    assert.notStrictEqual(
      proposalAfterCreation.status,
      "applied"
    );

    assert.strictEqual(
      failedLearning.record
        .governance
        .approvalRequired,
      true
    );

    assert.strictEqual(
      failedLearning.record
        .governance
        .autoApplied,
      false
    );

    console.log(
      "PASS: Improvement proposal remains approval-gated"
    );

    /*
     * 4. Same task + same execution must be
     * detected as a duplicate learning record.
     */
    const duplicateExecution =
      learning.learnFromWork({
        task:
          failedTask,
        executionResult:
          failedExecution,
        qaResult:
          failedQA,
        feedback: {
          summary:
            "Controlled QA failure requires improvement.",
          positive: [],
          negative: [
            "A requirement verification step was missed."
          ],
          requestedChanges: [
            "Verify every requirement before completion."
          ]
        }
      });

    assert.strictEqual(
      duplicateExecution.success,
      true
    );

    assert.strictEqual(
      duplicateExecution.status,
      "duplicate"
    );

    assert.strictEqual(
      duplicateExecution.duplicate,
      true
    );

    assert.strictEqual(
      duplicateExecution.proposal,
      null
    );

    assert.strictEqual(
      duplicateExecution.learningId,
      failedLearning.learningId
    );

    console.log(
      "PASS: Duplicate execution is rejected without a second learning record"
    );

    /*
     * 5. Different task/execution with the same
     * improvement fingerprint must not create
     * a duplicate improvement proposal.
     */
    const duplicateProposalTask =
      makeTask(
        "task-stage62-1-duplicate-proposal-a"
      );

    const duplicateProposalExecution =
      makeExecution(
        duplicateProposalTask,
        "execution-stage62-duplicate-proposal-a",
        {
          success:
            false,
          status:
            "post_execution_verification_failed",
          recoveryRequired:
            true,
          recoveryReason:
            "Controlled verification failure."
        }
      );

    const duplicateProposalQA =
      makeQA(
        duplicateProposalTask,
        {
          status:
            "qa_failed",
          success:
            false
        }
      );

    const duplicateProposalLearning =
      learning.learnFromWork({
        task:
          duplicateProposalTask,
        executionResult:
          duplicateProposalExecution,
        qaResult:
          duplicateProposalQA,
        feedback: {
          summary:
            "Controlled QA failure requires improvement.",
          positive: [],
          negative: [
            "A requirement verification step was missed."
          ],
          requestedChanges: [
            "Verify every requirement before completion."
          ]
        }
      });

    assert.strictEqual(
      duplicateProposalLearning.success,
      true
    );

    assert.strictEqual(
      duplicateProposalLearning.status,
      "proposal_duplicate"
    );

    assert.ok(
      duplicateProposalLearning.proposal,
      "Duplicate proposal should reference the existing proposal"
    );

    assert.strictEqual(
      proposalIdOf(
        duplicateProposalLearning.proposal
      ),
      createdProposalId
    );

    assert.notStrictEqual(
      duplicateProposalLearning.proposal.status,
      "approved"
    );

    assert.notStrictEqual(
      duplicateProposalLearning.proposal.status,
      "applied"
    );

    assert.strictEqual(
      duplicateProposalLearning.record
        .governance
        .proposalCreated,
      true
    );

    assert.strictEqual(
      duplicateProposalLearning.record
        .governance
        .approvalRequired,
      true
    );

    assert.strictEqual(
      duplicateProposalLearning.record
        .governance
        .autoApplied,
      false
    );

    console.log(
      "PASS: Duplicate improvement fingerprint does not create a second proposal"
    );

    /*
     * 6. Explicit proposal creation disablement
     * must not create a proposal.
     */
    const noProposalTask =
      makeTask(
        "task-stage62-1-no-proposal-a"
      );

    const noProposalExecution =
      makeExecution(
        noProposalTask,
        "execution-stage62-no-proposal-a"
      );

    const noProposalQA =
      makeQA(
        noProposalTask
      );

    const noProposalLearning =
      learning.learnFromWork(
        {
          task:
            noProposalTask,
          executionResult:
            noProposalExecution,
          qaResult:
            noProposalQA,
          feedback: {
            summary:
              "Controlled task completed.",
            positive: [],
            negative: [],
            requestedChanges: []
          }
        },
        {
          createImprovementProposal:
            false
        }
      );

    assert.strictEqual(
      noProposalLearning.success,
      true
    );

    assert.strictEqual(
      noProposalLearning.status,
      "no_improvement_proposed"
    );

    assert.strictEqual(
      noProposalLearning.proposal,
      null
    );

    assert.strictEqual(
      noProposalLearning.record
        .governance
        .proposalCreated,
      false
    );

    console.log(
      "PASS: Proposal creation can be explicitly disabled"
    );

    /*
     * 7. New learning records must use schema v2
     * and stable-stringify hashing.
     */
    const newRecord =
      learning.getLearningRecord(
        successLearning.learningId
      );

    assert.ok(
      newRecord
    );

    assert.strictEqual(
      newRecord.schemaVersion,
      2
    );

    const integrity =
      learning.verifyLearningRecordIntegrity(
        newRecord.learningId
      );

    assert.strictEqual(
      integrity.success,
      true
    );

    assert.strictEqual(
      integrity.valid,
      true
    );

    assert.strictEqual(
      integrity.hashAlgorithm,
      "stable-stringify-sha256"
    );

    console.log(
      "PASS: New learning record uses schema v2 integrity"
    );

    /*
     * 8. Existing schema v1 records must remain
     * backward compatible.
     */
    const existingRecords =
      learning.listLearningRecords({
        limit:
          100
      });

    const legacyRecords =
      existingRecords.filter(
        record =>
          Number(
            record.schemaVersion || 1
          ) === 1
      );

    assert.ok(
      legacyRecords.length > 0,
      "Expected at least one legacy schema v1 record"
    );

    for (const legacy of legacyRecords) {
      const legacyIntegrity =
        learning.verifyLearningRecordIntegrity(
          legacy.learningId
        );

      assert.strictEqual(
        legacyIntegrity.valid,
        true
      );

      assert.strictEqual(
        legacyIntegrity.hashAlgorithm,
        "legacy-json-stringify-sha256"
      );
    }

    console.log(
      "PASS: Legacy schema v1 integrity remains valid"
    );

    /*
     * 9. Tampering must be detected.
     */
    const beforeTamper =
      readJson(
        LEARNING_FILE
      );

    const tamperIndex =
      beforeTamper.records.findIndex(
        record =>
          record.learningId ===
          newRecord.learningId
      );

    assert.ok(
      tamperIndex >= 0
    );

    beforeTamper.records[
      tamperIndex
    ].whatWorked = [
      "TAMPERED_TEST_VALUE"
    ];

    writeJson(
      LEARNING_FILE,
      beforeTamper
    );

    const tamperDetection =
      learning.verifyLearningRecordIntegrity(
        newRecord.learningId
      );

    assert.strictEqual(
      tamperDetection.success,
      true
    );

    assert.strictEqual(
      tamperDetection.valid,
      false
    );

    console.log(
      "PASS: Learning record tampering detected"
    );

    /*
     * 10. Audit integrity must remain valid after
     * learning operations.
     */
    const auditIntegrity =
      audit.verifyAuditIntegrity();

    assert.strictEqual(
      auditIntegrity.ok,
      true
    );

    assert.ok(
      auditIntegrity.totalEntries >=
        baselineAudit.length
    );

    console.log(
      "PASS: Audit integrity verified"
    );

    /*
     * 11. Statistics must increase according to
     * the operations performed.
     */
    const finalStats =
      learning.getLearningStats();

    assertStatsDelta(
      baselineStats,
      finalStats,
      "total",
      4
    );

    assertStatsDelta(
      baselineStats,
      finalStats,
      "qaPassed",
      2
    );

    assertStatsDelta(
      baselineStats,
      finalStats,
      "qaFailed",
      2
    );

    assertStatsDelta(
      baselineStats,
      finalStats,
      "proposalCreated",
      1
    );

    assertStatsDelta(
      baselineStats,
      finalStats,
      "proposalDuplicate",
      1
    );

    console.log(
      "PASS: Learning statistics reflect Stage 6.2 operations"
    );

    /*
     * 12. At least one new proposal must have been
     * created, while the original baseline proposal
     * set must still be distinguishable.
     */
    const finalProposals =
      changeManagement.listProposals();

    assert.ok(
      finalProposals.length >=
        baselineProposals.length + 1
    );

    const createdProposal =
      changeManagement.getProposal(
        createdProposalId
      );

    assert.ok(
      createdProposal
    );

    assert.notStrictEqual(
      createdProposal.status,
      "approved"
    );

    assert.notStrictEqual(
      createdProposal.status,
      "applied"
    );

    console.log(
      "PASS: Proposal lifecycle remains approval-gated"
    );

    /*
     * 13. No automatic approval/apply.
     */
    const governanceRecords =
      [
        failedLearning.record,
        duplicateProposalLearning.record,
        successLearning.record,
        noProposalLearning.record
      ];

    for (
      const record of
        governanceRecords
    ) {
      assert.strictEqual(
        record.governance
          .approvalRequired,
        true
      );

      assert.strictEqual(
        record.governance
          .autoApplied,
        false
      );
    }

    console.log(
      "PASS: No automatic approval or apply occurred"
    );

    console.log(
      "\nSTAGE6_2_WORK_LEARNING_E2E_TEST: PASS"
    );
  } finally {
    if (snapshotsReady) {
      for (const [
        source,
        destination
      ] of files) {
        restoreFile(
          destination,
          source
        );
      }

      fs.rmSync(
        snapshotDir,
        {
          recursive:
            true,
          force:
            true
        }
      );

      console.log(
        "PASS: Pre-test production/local state restored"
      );
    }
  }
}

try {
  main();
} catch (error) {
  console.error(
    "\nSTAGE6_2_WORK_LEARNING_E2E_TEST: FAIL"
  );

  console.error(
    error &&
    error.stack
      ? error.stack
      : error
  );

  process.exitCode = 1;
}
