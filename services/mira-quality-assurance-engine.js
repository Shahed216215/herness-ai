"use strict";

const {
  recordAudit
} = require("../audit-log");

const {
  recordSkillFailure
} = require("../capability-profile");

const ENGINE_VERSION = "6.1.0";
const DEFAULT_MAX_REWORK_ATTEMPTS = 3;

const QA_CHECKS = Object.freeze([
  "completeness",
  "correctness",
  "requirements",
  "output_format",
  "quality",
  "consistency",
  "security_safety",
  "final_acceptance"
]);

function now() {
  return new Date().toISOString();
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function asString(value) {
  return typeof value === "string"
    ? value.trim()
    : "";
}

function safeObject(value) {
  return value &&
    typeof value === "object" &&
    !Array.isArray(value)
    ? value
    : {};
}

function normalizeTask(task = {}) {
  const source = safeObject(task);

  return {
    id: asString(source.id) || asString(source.taskId),
    title: asString(source.title),
    description: asString(source.description),
    type: asString(source.type) || "task_result",
    requirements: asArray(source.requirements),
    deliverables: asArray(source.deliverables),
    requiredSkills: asArray(source.requiredSkills),
    risk: asString(source.risk) || "low"
  };
}

function normalizePlan(plan = {}) {
  const source = safeObject(plan);

  return {
    id: asString(source.id),
    version: Number.isInteger(source.version)
      ? source.version
      : 1,
    taskId: asString(source.taskId),
    goal: asString(source.goal),
    requirements: asArray(source.requirements),
    subtasks: asArray(source.subtasks),
    executionPlan: asArray(source.executionPlan),
    verificationPlan: asArray(source.verificationPlan),
    deliverable: safeObject(source.deliverable),
    status: asString(source.status),
    feasibility: asString(source.feasibility)
  };
}

function normalizeExecutionResult(result = {}) {
  const source = safeObject(result);

  return {
    success: source.success === true,
    status: asString(source.status),
    taskId: asString(source.taskId),
    planId: asString(source.planId),
    results: asArray(source.results),
    recoveryRequired:
      source.recoveryRequired === true,
    qaEvidence:
      safeObject(source.qaEvidence)
  };
}

function normalizeBooleanEvidence(value) {
  return value === true || value === false
    ? value
    : null;
}

function normalizeQAEvidence(execution) {
  const topLevel =
    safeObject(execution.qaEvidence);

  const items =
    execution.results.map(entry =>
      safeObject(entry).qaEvidence
    );

  const itemEvidence =
    items.find(
      evidence =>
        evidence &&
        typeof evidence === "object" &&
        !Array.isArray(evidence)
    );

  const source =
    Object.keys(topLevel).length > 0
      ? topLevel
      : safeObject(itemEvidence);

  return {
    requirementsAddressed:
      normalizeBooleanEvidence(
        source.requirementsAddressed
      ),

    acceptanceCriteriaSatisfied:
      normalizeBooleanEvidence(
        source.acceptanceCriteriaSatisfied
      ),

    deliverablesComplete:
      normalizeBooleanEvidence(
        source.deliverablesComplete
      ),

    qualityAccepted:
      normalizeBooleanEvidence(
        source.qualityAccepted
      ),

    consistencyValid:
      normalizeBooleanEvidence(
        source.consistencyValid
      ),

    securitySafe:
      normalizeBooleanEvidence(
        source.securitySafe
      ),

    source:
      Object.keys(source).length > 0
        ? "structured"
        : "missing"
  };
}

function normalizeExecutionOutputs(execution) {
  return execution.results.map((entry, index) => {
    const item = safeObject(entry);

    return {
      index,
      tool: asString(item.tool),
      success: item.success !== false,
      verificationPassed:
        item.verification?.passed !== false,
      output:
        item.output !== undefined
          ? item.output
          : item.result,
      qaEvidence:
        safeObject(item.qaEvidence)
    };
  });
}

function checkCompleteness(task, plan, execution) {
  const reasons = [];
  const requiredOutputs = [
    ...task.deliverables,
    ...asArray(plan.deliverable.outputs)
  ].filter(value => asString(value));

  const outputs =
    normalizeExecutionOutputs(execution);

  const qaEvidence =
    normalizeQAEvidence(execution);

  if (!execution.success) {
    reasons.push("Execution did not report success.");
  }

  if (outputs.length === 0) {
    reasons.push("No execution result was produced.");
  }

  if (
    requiredOutputs.length > 0 &&
    outputs.length === 0
  ) {
    reasons.push(
      "Required deliverables have no execution output."
    );
  }

  if (
    requiredOutputs.length > 0 &&
    qaEvidence.deliverablesComplete !== true
  ) {
    reasons.push(
      qaEvidence.deliverablesComplete === false
        ? "Structured QA evidence reports incomplete deliverables."
        : "Structured QA evidence for deliverable completeness is missing."
    );
  }

  return {
    passed: reasons.length === 0,
    reasons,
    evidence: {
      requiredOutputCount: requiredOutputs.length,
      actualOutputCount: outputs.length,
      deliverablesComplete:
        qaEvidence.deliverablesComplete,
      evidenceSource:
        qaEvidence.source
    }
  };
}

function checkCorrectness(task, plan, execution) {
  const reasons = [];
  const outputs =
    normalizeExecutionOutputs(execution);

  const qaEvidence =
    normalizeQAEvidence(execution);

  if (!execution.success) {
    reasons.push("Execution result is not successful.");
  }

  for (const item of outputs) {
    if (!item.success) {
      reasons.push(
        `Execution result ${item.index + 1} reports failure.`
      );
    }

    if (!item.verificationPassed) {
      reasons.push(
        `Execution result ${item.index + 1} failed execution verification.`
      );
    }
  }

  const requiredChecks =
    plan.verificationPlan.filter(
      check => check && check.required !== false
    );

  if (requiredChecks.length === 0) {
    reasons.push(
      "No required verification checks are defined."
    );
  }

  if (
    requiredChecks.length > 0 &&
    qaEvidence.acceptanceCriteriaSatisfied !== true
  ) {
    reasons.push(
      qaEvidence.acceptanceCriteriaSatisfied === false
        ? "Structured QA evidence reports that acceptance criteria are not satisfied."
        : "Structured QA evidence for acceptance criteria is missing."
    );
  }

  return {
    passed: reasons.length === 0,
    reasons,
    evidence: {
      requiredChecks:
        requiredChecks.map(check => check.checkId),
      resultCount: outputs.length,
      acceptanceCriteriaSatisfied:
        qaEvidence.acceptanceCriteriaSatisfied,
      evidenceSource:
        qaEvidence.source
    }
  };
}

function checkRequirements(task, plan, execution) {
  const reasons = [];

  const requirements = [
    ...task.requirements,
    ...plan.requirements
  ].filter(value => asString(value));

  const qaEvidence =
    normalizeQAEvidence(execution);

  if (requirements.length === 0) {
    reasons.push(
      "No explicit task requirements are available."
    );
  }

  if (
    execution.taskId &&
    task.id &&
    execution.taskId !== task.id
  ) {
    reasons.push(
      "Execution taskId does not match the task."
    );
  }

  if (
    execution.planId &&
    plan.id &&
    execution.planId !== plan.id
  ) {
    reasons.push(
      "Execution planId does not match the evaluated plan."
    );
  }

  if (
    requirements.length > 0 &&
    qaEvidence.requirementsAddressed !== true
  ) {
    reasons.push(
      qaEvidence.requirementsAddressed === false
        ? "Structured QA evidence reports that task requirements are not fully addressed."
        : "Structured QA evidence for task requirements is missing."
    );
  }

  return {
    passed: reasons.length === 0,
    reasons,
    evidence: {
      requirementCount: requirements.length,
      requirementsAddressed:
        qaEvidence.requirementsAddressed,
      evidenceSource:
        qaEvidence.source
    }
  };
}

function checkOutputFormat(task, plan, execution) {
  const reasons = [];
  const criteria =
    asArray(plan.deliverable.acceptanceCriteria);

  if (execution.results.length === 0) {
    reasons.push("Final output is missing.");
  }

  if (criteria.length === 0) {
    reasons.push(
      "Deliverable acceptance criteria are missing."
    );
  }

  for (const criterion of criteria) {
    if (
      typeof criterion !== "string" ||
      criterion.trim() === ""
    ) {
      reasons.push(
        "Deliverable contains an invalid acceptance criterion."
      );
    }
  }

  return {
    passed: reasons.length === 0,
    reasons,
    evidence: {
      acceptanceCriteriaCount: criteria.length,
      taskType: task.type
    }
  };
}

function checkQuality(task, plan, execution) {
  const reasons = [];

  const qaEvidence =
    normalizeQAEvidence(execution);

  if (!execution.success) {
    reasons.push(
      "Failed execution cannot meet the final quality threshold."
    );
  }

  if (
    execution.results.some(
      result =>
        !result ||
        typeof result !== "object"
    )
  ) {
    reasons.push(
      "One or more execution results are malformed."
    );
  }

  if (
    qaEvidence.qualityAccepted !== true
  ) {
    reasons.push(
      qaEvidence.qualityAccepted === false
        ? "Structured QA evidence reports that the result does not meet the quality threshold."
        : "Structured QA evidence for quality acceptance is missing."
    );
  }

  return {
    passed: reasons.length === 0,
    reasons,
    evidence: {
      resultCount: execution.results.length,
      qualityAccepted:
        qaEvidence.qualityAccepted,
      evidenceSource:
        qaEvidence.source
    }
  };
}

function checkConsistency(task, plan, execution) {
  const reasons = [];

  const qaEvidence =
    normalizeQAEvidence(execution);

  if (
    task.id &&
    plan.taskId &&
    task.id !== plan.taskId
  ) {
    reasons.push(
      "Task and plan identifiers are inconsistent."
    );
  }

  if (
    plan.status &&
    ["blocked", "rejected"].includes(plan.status)
  ) {
    reasons.push(
      `Plan status "${plan.status}" is incompatible with acceptance.`
    );
  }

  if (
    plan.feasibility &&
    plan.feasibility !== "feasible"
  ) {
    reasons.push(
      `Plan feasibility is "${plan.feasibility}".`
    );
  }

  if (execution.recoveryRequired) {
    reasons.push(
      "Execution indicates recovery is required."
    );
  }

  if (
    qaEvidence.consistencyValid !== true
  ) {
    reasons.push(
      qaEvidence.consistencyValid === false
        ? "Structured QA evidence reports an inconsistent result."
        : "Structured QA evidence for consistency is missing."
    );
  }

  return {
    passed: reasons.length === 0,
    reasons,
    evidence: {
      planStatus: plan.status,
      feasibility: plan.feasibility,
      consistencyValid:
        qaEvidence.consistencyValid,
      evidenceSource:
        qaEvidence.source
    }
  };
}

function checkSecuritySafety(task, plan, execution) {
  const reasons = [];

  const qaEvidence =
    normalizeQAEvidence(execution);

  if (execution.recoveryRequired) {
    reasons.push(
      "Execution reported recoveryRequired."
    );
  }

  for (const item of execution.results) {
    const result = safeObject(item?.result);

    if (
      result.unsafe === true ||
      result.unauthorized === true ||
      result.denied === true
    ) {
      reasons.push(
        "Execution output indicates an unsafe or unauthorized operation."
      );
    }
  }

  if (
    qaEvidence.securitySafe !== true
  ) {
    reasons.push(
      qaEvidence.securitySafe === false
        ? "Structured QA evidence reports a security or safety failure."
        : "Structured QA evidence for security and safety is missing."
    );
  }

  return {
    passed: reasons.length === 0,
    reasons,
    evidence: {
      risk: task.risk,
      recoveryRequired:
        execution.recoveryRequired,
      securitySafe:
        qaEvidence.securitySafe,
      evidenceSource:
        qaEvidence.source
    }
  };
}

function checkFinalAcceptance(checks) {
  const failedChecks =
    QA_CHECKS
      .filter(
        name =>
          name !== "final_acceptance" &&
          checks[name]?.passed !== true
      );

  return {
    passed: failedChecks.length === 0,
    reasons:
      failedChecks.length > 0
        ? [
            `Required QA checks failed: ${failedChecks.join(", ")}.`
          ]
        : [],
    evidence: {
      failedChecks
    }
  };
}

function evaluateQuality(options = {}) {
  const task = normalizeTask(options.task);
  const plan = normalizePlan(options.plan);
  const execution =
    normalizeExecutionResult(
      options.executionResult
    );

  const checks = {
    completeness:
      checkCompleteness(task, plan, execution),

    correctness:
      checkCorrectness(task, plan, execution),

    requirements:
      checkRequirements(task, plan, execution),

    output_format:
      checkOutputFormat(task, plan, execution),

    quality:
      checkQuality(task, plan, execution),

    consistency:
      checkConsistency(task, plan, execution),

    security_safety:
      checkSecuritySafety(task, plan, execution)
  };

  checks.final_acceptance =
    checkFinalAcceptance(checks);

  const failedChecks =
    QA_CHECKS.filter(
      name => checks[name]?.passed !== true
    );

  const reasons =
    failedChecks.flatMap(
      name => checks[name]?.reasons || []
    );

  const passed =
    failedChecks.length === 0;

  return {
    success: passed,
    status: passed
      ? "qa_passed"
      : "qa_failed",
    stage: "6.1",
    engineVersion: ENGINE_VERSION,
    taskId: task.id,
    planId: plan.id,
    checks,
    failedChecks,
    reasons,
    reworkRequired: !passed,
    evaluatedAt: now()
  };
}

function createReworkDecision(
  qaResult,
  options = {}
) {
  const currentAttempts =
    Number.isInteger(options.reworkAttempts)
      ? options.reworkAttempts
      : 0;

  const maxAttempts =
    Number.isInteger(options.maxReworkAttempts)
      ? Math.max(options.maxReworkAttempts, 0)
      : DEFAULT_MAX_REWORK_ATTEMPTS;

  if (qaResult.status !== "qa_failed") {
    return {
      status: "not_required",
      reworkRequired: false,
      recoveryRequired: false,
      reworkAttempts: currentAttempts,
      maxReworkAttempts: maxAttempts,
      reasons: []
    };
  }

  const nextAttempt =
    currentAttempts + 1;

  if (nextAttempt > maxAttempts) {
    return {
      status: "recovery_required",
      reworkRequired: false,
      recoveryRequired: true,
      reworkAttempts: currentAttempts,
      maxReworkAttempts: maxAttempts,
      failedChecks:
        qaResult.failedChecks,
      reasons: [
        "Maximum QA rework attempts exhausted."
      ],
      recommendedActions: [
        "Stop automatic rework.",
        "Preserve QA evidence.",
        "Create recovery-required audit record.",
        "Require controlled recovery."
      ]
    };
  }

  return {
    status: "rework_required",
    reworkRequired: true,
    recoveryRequired: false,
    reworkAttempts: nextAttempt,
    maxReworkAttempts: maxAttempts,
    failedChecks:
      qaResult.failedChecks,
    reasons:
      qaResult.reasons,
    recommendedActions: [
      "Identify failed QA checks.",
      "Send failure context to the planner.",
      "Create a revised plan.",
      "Execute through Stage 5.4.",
      "Run Stage 6.1 again."
    ]
  };
}

function buildReworkContext(
  task,
  plan,
  qaResult,
  reworkDecision
) {
  return {
    failure:
      qaResult.reasons.join(" ") ||
      "Quality assurance failed.",

    newInformation:
      `Stage 6.1 failed checks: ${qaResult.failedChecks.join(", ")}.`,

    previousPlanId:
      plan.id || "",

    previousVersion:
      Number.isInteger(plan.version)
        ? plan.version
        : 1,

    reworkAttempt:
      reworkDecision.reworkAttempts,

    maxReworkAttempts:
      reworkDecision.maxReworkAttempts,

    taskId:
      task.id || "",

    recommendedActions:
      reworkDecision.recommendedActions || []
  };
}

function recordQAAudit(
  taskId,
  qaResult,
  reworkDecision
) {
  return recordAudit({
    actorRole: "system",
    action: "task_quality_assurance",
    resource: "task",
    resourceId: taskId || "",
    status: qaResult.status,
    details: {
      stage: "6.1",
      engineVersion: ENGINE_VERSION,
      failedChecks:
        qaResult.failedChecks,
      reworkRequired:
        reworkDecision.reworkRequired,
      recoveryRequired:
        reworkDecision.recoveryRequired,
      reworkAttempts:
        reworkDecision.reworkAttempts,
      maxReworkAttempts:
        reworkDecision.maxReworkAttempts
    }
  });
}

function recordQASkillFailures(
  task,
  qaResult,
  reworkDecision,
  executionResult
) {
  if (
    qaResult.status !== "qa_failed"
  ) {
    return [];
  }

  const requiredSkills =
    Array.isArray(task.requiredSkills)
      ? task.requiredSkills
      : [];

  const uniqueSkills =
    [
      ...new Set(
        requiredSkills
          .filter(
            skill =>
              typeof skill === "string"
          )
          .map(
            skill => skill.trim()
          )
          .filter(Boolean)
      )
    ];

  if (
    uniqueSkills.length === 0
  ) {
    return [];
  }

  const executionId =
    executionResult &&
    typeof executionResult.executionId === "string"
      ? executionResult.executionId
      : "";

  const failureReason =
    (
      Array.isArray(qaResult.reasons) &&
      qaResult.reasons.length > 0
        ? qaResult.reasons.join("; ")
        : "Quality assurance failed."
    ).slice(0, 500);

  const resolution =
    reworkDecision.recoveryRequired
      ? "recovery_required"
      : reworkDecision.reworkRequired
        ? "rework_required"
        : "qa_failed";

  const results = [];

  for (
    const skill of uniqueSkills
  ) {
    const result =
      recordSkillFailure(
        skill,
        {
          taskId:
            task.id,
          executionId,
          failureType:
            "quality_assurance_failure",
          failureReason,
          failedChecks:
            qaResult.failedChecks,
          reworkRequired:
            reworkDecision.reworkRequired,
          recoveryRequired:
            reworkDecision.recoveryRequired,
          resolution
        }
      );

    if (
      result &&
      result.ok === true
    ) {
      results.push({
        skillId:
          result.skillId,
        skillKey:
          result.skillKey,
        failureId:
          result.failure &&
          typeof result.failure.failureId === "string"
            ? result.failure.failureId
            : "",
        status:
          "recorded"
      });
    }
  }

  return results;
}

async function runQualityAssurance(options = {}) {
  const qaResult =
    evaluateQuality(options);

  const reworkDecision =
    createReworkDecision(
      qaResult,
      options
    );

  const task =
    normalizeTask(options.task);

  const plan =
    normalizePlan(options.plan);

  const reworkContext =
    qaResult.status === "qa_failed" &&
    reworkDecision.reworkRequired
      ? buildReworkContext(
          task,
          plan,
          qaResult,
          reworkDecision
        )
      : null;

  // Fail closed before recording skill-failure side effects.
  const audit =
    recordQAAudit(
      task.id,
      qaResult,
      reworkDecision
    );

  const skillFailures =
    recordQASkillFailures(
      task,
      qaResult,
      reworkDecision,
      options.executionResult
    );

  return {
    ...qaResult,
    rework: reworkDecision,
    reworkContext,
    skillFailures,
    audit,
    finalAcceptance:
      qaResult.status === "qa_passed" &&
      !reworkDecision.recoveryRequired
  };
}

module.exports = {
  ENGINE_VERSION,
  DEFAULT_MAX_REWORK_ATTEMPTS,
  QA_CHECKS,
  normalizeQAEvidence,
  evaluateQuality,
  createReworkDecision,
  buildReworkContext,
  runQualityAssurance
};
