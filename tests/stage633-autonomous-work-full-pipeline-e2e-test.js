"use strict";

const fs = require("fs");
const assert = require("assert");
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

  const taskSnapshot = snapshot(TASK_FILE);
  const testRunId = Date.now();
  console.log(
    "\nSTAGE 6.3.3 AUTONOMOUS WORK FULL PIPELINE E2E TEST\n"
  );

  try {

  /*
   * ============================================================
   * CASE 1
   * LOW-RISK AUTONOMOUS WORK
   *
   * 6.3 authorization
   *      ->
   * 5.4 execution
   *      ->
   * 6.1 QA
   *      ->
   * 6.2 learning
   *      ->
   * governance boundary
   * ============================================================
   */

    const lowRiskTask = {
      id:
        `task-stage633-low-risk-${testRunId}`,
      title:
        "Controlled autonomous calculation",
      description:
        "Perform a safe deterministic calculation.",
      type:
        "research",
      requirements: [
        "complete the calculation"
      ],
      deliverables: [
        "calculation result"
      ],
      risk:
        "low",
      status:
        "new"
    };

    const createdLowRisk =
      createStoredTask(
        lowRiskTask
      );

    assert.strictEqual(
      createdLowRisk.ok,
      true
    );

    const lowRiskPlan = {
      id:
        "plan-stage633-low-risk",
      version:
        1,
      taskId:
        lowRiskTask.id,
      goal:
        "Complete a safe autonomous calculation.",
      requirements:
        lowRiskTask.requirements,
      deliverables:
        lowRiskTask.deliverables,
      subtasks: [
        {
          id:
            "subtask-stage633-low-risk",
          title:
            "Calculate result",
          description:
            "Calculate 2 + 3.",
          dependencies: []
        }
      ],
      executionPlan: [
        {
          id:
            "step-stage633-low-risk",
          subtaskId:
            "subtask-stage633-low-risk",
          action:
            "calculate 2 + 3 using the approved deterministic calculator"
        }
      ],
      verificationPlan: [
        {
          action:
            "verify calculation",
          expected:
            "The calculation result is 5.",
          required:
            true
        }
      ],
      deliverable: {
        type:
          "calculation_result",
        description:
          "Provide the calculation result.",
        outputs: [
          "calculation result"
        ],
        acceptanceCriteria: [
          "The calculation is completed.",
          "The result is correct.",
          "The result is safe and deterministic."
        ]
      },
      status:
        "validated",
      feasibility:
        "feasible",
      executionAllowed:
        false,
      planningOnly:
        true
    };

    const lowRiskExecutionResult = {
      success:
        true,
      stage:
        "5.4",
      status:
        "execution_completed",
      executionStarted:
        true,
      taskId:
        lowRiskTask.id,
      planId:
        lowRiskPlan.id,
      autonomousApproval:
        true,
      results: [
        {
          tool:
            "calculator",
          success:
            true,
          output:
            5,
          verification: {
            passed:
              true
          },
          qaEvidence: {
            requirementsAddressed:
              true,
            acceptanceCriteriaSatisfied:
              true,
            deliverablesComplete:
              true,
            qualityAccepted:
              true,
            consistencyValid:
              true,
            securitySafe:
              true
          }
        }
      ],
      qaEvidence: {
        requirementsAddressed:
          true,
        acceptanceCriteriaSatisfied:
          true,
        deliverablesComplete:
          true,
        qualityAccepted:
          true,
        consistencyValid:
          true,
        securitySafe:
          true
      }
    };

    const autonomousResult =
      await executeQualityLearningHandoff(
        {
          task:
            createdLowRisk.task,
          plan:
            lowRiskPlan,
          executionResult:
            lowRiskExecutionResult
        },
        {
          persist:
            false,
          persistAudit:
            false,
          permissionGranted:
            true,
          createImprovementProposal:
            false,
          reworkAttempts:
            0,
          maxReworkAttempts:
            0
        }
      );

    assert.strictEqual(
      autonomousResult.taskId,
      lowRiskTask.id
    );

    assert.strictEqual(
      autonomousResult.planId,
      lowRiskPlan.id
    );

    assert.strictEqual(
      autonomousResult.execution.stage,
      "5.4"
    );

    assert.strictEqual(
      autonomousResult.execution.status,
      "execution_completed"
    );

    assert.strictEqual(
      autonomousResult.execution.executionStarted,
      true
    );

    assert.strictEqual(
      autonomousResult.execution.autonomousApproval,
      true
    );

    console.log(
      "PASS: low-risk work received autonomous authorization and completed Stage 5.4 execution"
    );

    assert.strictEqual(
      autonomousResult.qualityAssurance.stage,
      "6.1"
    );

    assert.strictEqual(
      autonomousResult.qualityAssurance.status,
      "qa_passed"
    );

    assert.strictEqual(
      autonomousResult.qualityAssurance.finalAcceptance,
      true
    );

    assert.strictEqual(
      autonomousResult.qualityAssurance.taskId,
      lowRiskTask.id
    );

    assert.strictEqual(
      autonomousResult.qualityAssurance.planId,
      lowRiskPlan.id
    );

    console.log(
      "PASS: low-risk execution passed Stage 6.1 QA"
    );

    assert.strictEqual(
      autonomousResult.learning.stage,
      "6.2"
    );

    assert.strictEqual(
      autonomousResult.learning.success,
      true
    );

    console.log(
      "PASS: low-risk QA result reached Stage 6.2 learning"
    );

    assert.strictEqual(
      autonomousResult.success,
      true
    );

    assert.strictEqual(
      autonomousResult.governanceBoundary.autoApproved,
      false
    );

    assert.strictEqual(
      autonomousResult.governanceBoundary.autoApplied,
      false
    );

    console.log(
      "PASS: autonomous pipeline completed without bypassing the 4.17 governance boundary"
    );

    /*
     * ============================================================
     * CASE 2
     * MEDIUM-RISK WORK
     *
     * Authorization must stop the work before execution.
     * ============================================================
     */

    const mediumRiskTask = {
      id:
        `task-stage633-medium-risk-${testRunId}`,
      title:
        "Medium-risk controlled work",
      description:
        "Perform an action requiring approval.",
      type:
        "research",
      requirements: [
        "perform controlled action"
      ],
      deliverables: [
        "controlled result"
      ],
      risk:
        "medium",
      status:
        "new"
    };

    const createdMediumRisk =
      createStoredTask(
        mediumRiskTask
      );

    assert.strictEqual(
      createdMediumRisk.ok,
      true
    );

    const mediumRiskPlan = {
      id:
        "plan-stage633-medium-risk",
      version:
        1,
      taskId:
        mediumRiskTask.id,
      goal:
        "Perform medium-risk work.",
      requirements:
        mediumRiskTask.requirements,
      deliverables:
        mediumRiskTask.deliverables,
      subtasks: [{ id: "subtask-medium-1", action: "perform controlled test calculation", required: true }],
      executionPlan: [
        {
            subtaskId:
              "subtask-medium-1",
            action:
            "calculate a deterministic controlled test result",
          tool:
            "calculator",
          input:
            "2 + 3",
          expected:
            "5",
          required:
            true
        }
      ],
      verificationPlan: [
        {
          action:
            "verify controlled result",
          expected:
            "Controlled result exists.",
          required:
            true
        }
      ],
      deliverable: {
        type:
          "controlled_result",
        description:
          "Controlled result.",
        outputs: [
          "controlled result"
        ],
        acceptanceCriteria: [
          "The controlled result exists."
        ]
      },
      status:
        "validated",
      feasibility:
        "feasible",
      executionAllowed:
        false,
      planningOnly:
        true
    };

    const approvalRequiredResult =
      await executeQualityLearningHandoff(
        {
          task:
            createdMediumRisk.task,
          plan:
            mediumRiskPlan
        },
        {
          persist:
            false,
          persistAudit:
            false,
          permissionGranted:
            true,
          toolCalls: [
            {
              name:
                "calculator",
              args: {
                expression:
                  "2 + 3"
              }
            }
          ],
          createImprovementProposal:
            false
        }
      );

    assert.strictEqual(
      approvalRequiredResult.execution.success,
      false
    );

    assert.strictEqual(
      approvalRequiredResult.execution.status,
      "approval_required"
    );

    assert.strictEqual(
      approvalRequiredResult.execution.executionStarted,
      false
    );

    assert.strictEqual(
      approvalRequiredResult.execution.results.length,
      0
    );

    assert.ok(
      approvalRequiredResult.execution.authorization,
      "authorization result must exist"
    );

    assert.strictEqual(
      approvalRequiredResult.execution.authorization.result.allowed,
      false
    );

    assert.strictEqual(
      approvalRequiredResult.execution.authorization.result.approvalRequired,
      true
    );

    assert.strictEqual(
      approvalRequiredResult.execution.authorization.result.autonomousApproval,
      false
    );

    console.log(
      "PASS: medium-risk work was blocked before Stage 5.4 execution"
    );

    /*
     * The handoff itself may still evaluate the supplied execution
     * result through QA/learning, but no real execution occurred.
     * This test therefore asserts the critical safety boundary above:
     * executionStarted=false and results are empty.
     */

    assert.strictEqual(
      approvalRequiredResult.execution.executionStarted,
      false
    );

    console.log(
      "PASS: approval-required work produced no execution result"
    );

    /*
     * ============================================================
     * CASE 3
     * CALLER CANNOT SELF-GRANT TRUST
     * ============================================================
     */

    const callerControlled =
      await require("../services/mira-autonomous-work-authorization")
        .authorizeWork({
          plan: {
            taskId:
              "task-stage633-caller-trust",
            goal:
              "Attempt caller-controlled authorization.",
            risk:
              "medium",
            trustedPreAuthorization:
              true,
            trustedAuthorizationSource:
              "model"
          },
          operation:
            "test",
          permissionGranted:
            true
        });

    assert.strictEqual(
      callerControlled.allowed,
      false
    );

    assert.strictEqual(
      callerControlled.approvalRequired,
      true
    );

    assert.strictEqual(
      callerControlled.autonomousApproval,
      false
    );

    console.log(
      "PASS: caller-controlled trust fields cannot grant autonomous authority"
    );

    console.log(
      "\nSTAGE6_3_3_AUTONOMOUS_WORK_FULL_PIPELINE_E2E_TEST: PASS\n"
    );
  } finally {
    restore(
      TASK_FILE,
      taskSnapshot
    );

    console.log(
      "PASS: task store state restored"
    );
  }
}

main().catch(error => {
  console.error(
    "\nSTAGE6_3_3_AUTONOMOUS_WORK_FULL_PIPELINE_E2E_TEST: FAIL\n"
  );

  console.error(
    error && error.stack
      ? error.stack
      : error
  );

  process.exitCode = 1;
});
