"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const {
  executeQualityLearningHandoff
} = require("../services/mira-work-quality-learning-handoff");

const {
  createStoredTask
} = require("../task-store");

const TASK_FILE =
  path.join(
    __dirname,
    "..",
    "data",
    "tasks.json"
  );

const LEARNING_FILE =
  path.join(
    __dirname,
    "..",
    "data",
    "work-learning-records.json"
  );

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

function snapshot(file) {
  return fs.existsSync(file)
    ? fs.readFileSync(file, "utf8")
    : null;
}

function restore(file, value) {
  if (value === null) {
    if (fs.existsSync(file)) {
      fs.unlinkSync(file);
    }
    return;
  }

  fs.writeFileSync(
    file,
    value
  );
}

async function main() {
  const snapshots = {
    task: snapshot(TASK_FILE),
    learning: snapshot(LEARNING_FILE),
    proposal: snapshot(PROPOSAL_FILE),
    audit: snapshot(AUDIT_FILE)
  };

  const taskId =
    "task-stage62-live-handoff";

  try {
    console.log(
      "\nSTAGE 6.2.2 LIVE HANDOFF E2E TEST\n"
    );

    const taskInput = {
      id: taskId,
      title:
        "Controlled live handoff verification",
      description:
        "Perform a safe deterministic handoff test.",
      type: "research",
      requirements: [
        "complete the controlled task"
      ],
      deliverables: [
        "controlled verification result"
      ],
      risk: "low",
      status: "new"
    };

    const created =
      createStoredTask(
        taskInput
      );

    assert.strictEqual(
      created.ok,
      true
    );

    assert.strictEqual(
      created.task.id,
      taskId
    );

    console.log(
      "PASS: canonical task created"
    );

    const plan = {
      id:
        "plan-stage62-live-handoff",
      version: 1,
      taskId,
      goal:
        "Complete a controlled live handoff.",
      requirements:
        taskInput.requirements,
      deliverables:
        taskInput.deliverables,
      subtasks: [
        {
          id:
            "subtask-stage62-live",
          title:
            "Complete controlled verification",
          description:
            "Complete the deterministic verification task.",
          dependencies: []
        }
      ],
      executionPlan: [
        {
          id:
            "step-stage62-live",
          subtaskId:
            "subtask-stage62-live",
          action:
            "calculate 2 + 3 using the approved deterministic calculator"
        }
      ],
      verificationPlan: [
        {
          action:
            "verify completion",
          expected:
            "Controlled verification is complete.",
          required: true
        }
      ],
      deliverable: {
        type:
          "verification_result",
        description:
          "Provide the controlled verification result.",
        outputs: [
          "controlled verification result"
        ],
        acceptanceCriteria: [
          "The controlled verification is completed.",
          "The result is safe and deterministic."
        ]
      },
      status: "validated",
      feasibility: "feasible",
      executionAllowed: false,
      planningOnly: true
    };

    const result =
      await executeQualityLearningHandoff(
        {
          task: created.task,
          taskUnderstanding: {
            task: created.task
          },
          plan
        },
        {
          persist: false,
          persistAudit: false,
          permissionGranted: true,
          toolCalls: [
            {
              name: "calculator",
              args: {
                expression: "2+3"
              }
            }
          ],
          createImprovementProposal: false,
          reworkAttempts: 0,
          maxReworkAttempts: 0
        }
      );

    assert.ok(
      result &&
      typeof result === "object"
    );

    assert.strictEqual(
      result.taskId,
      taskId
    );

    assert.strictEqual(
      result.planId,
      plan.id
    );

    assert.ok(
      result.execution &&
      result.execution.success === true &&
      result.execution.stage === "5.4" &&
      result.execution.status === "execution_completed" &&
      result.execution.executionStarted === true
    );

    console.log(
      "PASS: actual 5.4 execution completed successfully through handoff"
    );

    assert.strictEqual(
      result.execution.taskId,
      taskId
    );

    assert.strictEqual(
      result.execution.planId,
      plan.id
    );

    console.log(
      "PASS: 5.4 execution preserved canonical taskId and planId"
    );

    assert.ok(
      Array.isArray(result.execution.results) &&
      result.execution.results.length === 1 &&
      result.execution.results[0].tool === "calculator" &&
      result.execution.results[0].verification &&
      result.execution.results[0].verification.passed === true
    );

    console.log(
      "PASS: 5.4 calculator execution and post-execution verification passed"
    );

    assert.ok(
      result.qualityAssurance &&
      result.qualityAssurance.stage === "6.1" &&
      result.qualityAssurance.status === "qa_failed" &&
      result.qualityAssurance.finalAcceptance === false &&
      result.qualityAssurance.taskId === taskId &&
      result.qualityAssurance.planId === plan.id
    );

    console.log(
      "PASS: actual 6.1 QA executed and correctly rejected missing QA evidence"
    );

    assert.strictEqual(
      result.success,
      false
    );

    console.log(
      "PASS: handoff remains unsuccessful because QA rejected final acceptance"
    );

    assert.ok(
      result.learning &&
      result.learning.stage === "6.2"
    );

    console.log(
      "LIVE 5.4 EXECUTION FULL RESULT:",
      JSON.stringify(
        result.execution,
        null,
        2
      )
    );

    console.log(
      "LIVE 6.1 QA IDENTITY:",
      JSON.stringify({
        taskId: result.qualityAssurance &&
          result.qualityAssurance.taskId,
        planId: result.qualityAssurance &&
          result.qualityAssurance.planId,
        status: result.qualityAssurance &&
          result.qualityAssurance.status
      }, null, 2)
    );

    console.log(
      "LIVE 6.2 LEARNING RESULT:",
      JSON.stringify(result.learning, null, 2)
    );

    assert.strictEqual(
      result.learning.success,
      true
    );

    assert.strictEqual(
      result.learning.stage,
      "6.2"
    );

    assert.ok(
      result.learning.record &&
      result.learning.record.qa &&
      result.learning.record.qa.status === "qa_failed"
    );

    console.log(
      "PASS: actual 6.2 learning consumed the QA failure"
    );

    assert.ok(
      Array.isArray(result.learning.record.whatFailed) &&
      result.learning.record.whatFailed.length > 0 &&
      Array.isArray(result.learning.record.lessons) &&
      result.learning.record.lessons.length > 0
    );

    console.log(
      "PASS: 6.2 learning produced failure evidence and lessons"
    );

    assert.strictEqual(
      result.governanceBoundary.autoApproved,
      false
    );

    assert.strictEqual(
      result.governanceBoundary.autoApplied,
      false
    );

    console.log(
      "PASS: governance approval boundary preserved"
    );

    assert.strictEqual(
      result.learning.proposal,
      null
    );

    console.log(
      "PASS: controlled test created no improvement proposal"
    );

    console.log(
      "\nSTAGE6_2_LIVE_HANDOFF_E2E_TEST: PASS\n"
    );
  } finally {
    restore(
      TASK_FILE,
      snapshots.task
    );

    restore(
      LEARNING_FILE,
      snapshots.learning
    );

    restore(
      PROPOSAL_FILE,
      snapshots.proposal
    );

    restore(
      AUDIT_FILE,
      snapshots.audit
    );

    console.log(
      "PASS: production/local state restored"
    );
  }
}

main().catch(error => {
  console.error(
    "\nSTAGE6_2_LIVE_HANDOFF_E2E_TEST: FAIL\n"
  );

  console.error(
    error && error.stack
      ? error.stack
      : error
  );

  process.exitCode = 1;
});
