"use strict";

const fs = require("fs");
const path = require("path");
const storagePath = require('../mira-storage');
const crypto = require("crypto");
const { assertLegacyStorageDisabled } = require("./mira-hfm-legacy-storage-guard");

const {
  createProposal,
  listProposals
} = require("../change-management");

const {
  recordAudit
} = require("../audit-log");

const ENGINE_VERSION = "6.2.1";

const LEARNING_FILE =
  process.env.MIRA_LEARNING_FILE ||
  storagePath("data/work-learning-records.json");

const MAX_RECORDS = 5000;

const MAX_TEXT = 1000;
const MAX_LONG_TEXT = 3000;
const MAX_ARRAY = 50;
const MAX_RESULTS = 20;
const MAX_CHECKS = 50;

const LEARNING_STATUSES = [
  "learned",
  "proposal_created",
  "proposal_duplicate",
  "no_improvement_proposed",
  "duplicate",
  "rejected_input"
];

const IMPROVEMENT_SIGNAL_STATUSES = new Set([
  "qa_failed"
]);

const SECRET_KEY_PATTERN =
  /(password|passwd|secret|token|api[_-]?key|authorization|cookie|private[_-]?key|credential)/i;

function now() {
  return new Date().toISOString();
}

function cleanText(
  value,
  maxLength = MAX_TEXT
) {
  if (
    typeof value !== "string"
  ) {
    return "";
  }

  return value
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxLength);
}

function cleanList(
  value,
  maxItems = MAX_ARRAY,
  maxLength = MAX_TEXT
) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .filter(
      item =>
        typeof item === "string" &&
        item.trim()
    )
    .map(
      item =>
        cleanText(item, maxLength)
    )
    .filter(Boolean)
    .slice(0, maxItems);
}

function safePrimitive(value) {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return value;
  }

  return undefined;
}

function safeValue(
  value,
  depth = 0
) {
  if (depth > 3) {
    return "[truncated]";
  }

  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    if (
      typeof value === "string" &&
      value.length > MAX_LONG_TEXT
    ) {
      return value.slice(
        0,
        MAX_LONG_TEXT
      );
    }

    return value;
  }

  if (Array.isArray(value)) {
    return value
      .slice(0, MAX_RESULTS)
      .map(item =>
        safeValue(item, depth + 1)
      );
  }

  if (
    typeof value === "object"
  ) {
    const result = {};

    for (
      const [
        key,
        item
      ] of Object.entries(value)
    ) {
      if (
        SECRET_KEY_PATTERN.test(key)
      ) {
        result[key] =
          "[redacted]";
        continue;
      }

      const safe =
        safeValue(
          item,
          depth + 1
        );

      if (
        safe !== undefined
      ) {
        result[key] = safe;
      }
    }

    return result;
  }

  return undefined;
}

function ensureStore() {
  assertLegacyStorageDisabled();
  const directory =
    path.dirname(
      LEARNING_FILE
    );

  fs.mkdirSync(
    directory,
    {
      recursive: true
    }
  );

  if (
    !fs.existsSync(
      LEARNING_FILE
    )
  ) {
    saveStore({
      version: 1,
      updatedAt: now(),
      records: []
    });
  }
}

function loadStore() {
  assertLegacyStorageDisabled();
  ensureDirectoryOnly();

  if (
    !fs.existsSync(
      LEARNING_FILE
    )
  ) {
    return {
      version: 1,
      updatedAt: now(),
      records: []
    };
  }

  const raw =
    fs.readFileSync(
      LEARNING_FILE,
      "utf8"
    );

  if (!raw.trim()) {
    return {
      version: 1,
      updatedAt: now(),
      records: []
    };
  }

  const parsed =
    JSON.parse(raw);

  if (
    !parsed ||
    typeof parsed !== "object"
  ) {
    throw new Error(
      "Learning store must contain an object."
    );
  }

  if (
    !Array.isArray(
      parsed.records
    )
  ) {
    parsed.records = [];
  }

  return parsed;
}

function ensureDirectoryOnly() {
  fs.mkdirSync(
    path.dirname(
      LEARNING_FILE
    ),
    {
      recursive: true
    }
  );
}

function saveStore(store) {
  assertLegacyStorageDisabled();
  ensureDirectoryOnly();

  const normalized = {
    version: 1,
    updatedAt: now(),
    records:
      Array.isArray(
        store.records
      )
        ? store.records
        : []
  };

  const temporaryFile =
    `${LEARNING_FILE}.tmp-${process.pid}-${Date.now()}`;

  fs.writeFileSync(
    temporaryFile,
    JSON.stringify(
      normalized,
      null,
      2
    ) + "\n",
    {
      mode: 0o600
    }
  );

  fs.renameSync(
    temporaryFile,
    LEARNING_FILE
  );

  return normalized;
}

function sha256(value) {
  return crypto
    .createHash("sha256")
    .update(
      String(value),
      "utf8"
    )
    .digest("hex");
}

function stableStringify(value) {
  if (
    value === null ||
    typeof value !== "object"
  ) {
    return JSON.stringify(
      value
    );
  }

  if (Array.isArray(value)) {
    return `[${value
      .map(item =>
        stableStringify(item)
      )
      .join(",")}]`;
  }

  return `{${Object.keys(value)
    .sort()
    .map(
      key =>
        `${JSON.stringify(key)}:${stableStringify(value[key])}`
    )
    .join(",")}}`;
}

function createLearningId(
  taskId,
  executionId
) {
  const digest =
    sha256(
      `${taskId}|${executionId}|${now()}|${crypto.randomUUID()}`
    );

  return `learning-${digest.slice(
    0,
    24
  )}`;
}

function getExecutionId(
  task,
  execution
) {
  if (
    execution &&
    typeof execution.executionId ===
      "string" &&
    execution.executionId.trim()
  ) {
    return cleanText(
      execution.executionId,
      200
    );
  }

  const resultFingerprint =
    sha256(
      stableStringify({
        taskId: task.id,
        planId:
          execution?.planId || "",
        status:
          execution?.status || "",
        results:
          execution?.results || [],
        completedAt:
          execution?.completedAt || "",
        startedAt:
          execution?.startedAt || ""
      })
    );

  return `execution-${resultFingerprint.slice(
    0,
    24
  )}`;
}

function normalizeTask(
  task = {}
) {
  return {
    id:
      cleanText(
        task.id,
        200
      ),
    title:
      cleanText(
        task.title,
        300
      ),
    description:
      cleanText(
        task.description,
        MAX_LONG_TEXT
      ),
    type:
      cleanText(
        task.type,
        100
      ),
    requirements:
      cleanList(
        task.requirements
      ),
    deliverables:
      cleanList(
        task.deliverables
      ),
    deadline:
      cleanText(
        task.deadline,
        100
      ),
    difficulty:
      cleanText(
        task.difficulty,
        100
      ),
    requiredSkills:
      cleanList(
        task.requiredSkills,
        MAX_ARRAY,
        200
      ),
    risk:
      cleanText(
        task.risk,
        100
      ),
    status:
      cleanText(
        task.status,
        100
      ),
    source:
      cleanText(
        task.source,
        200
      )
  };
}

function normalizeExecution(
  execution = {}
) {
  const rawResults =
    Array.isArray(
      execution.results
    )
      ? execution.results
      : [];

  return {
    success:
      execution.success === true,
    stage:
      cleanText(
        execution.stage,
        100
      ),
    status:
      cleanText(
        execution.status,
        150
      ),
    taskId:
      cleanText(
        execution.taskId,
        200
      ),
    planId:
      cleanText(
        execution.planId,
        200
      ),
    executionId:
      cleanText(
        execution.executionId,
        200
      ),
    autonomousApproval:
      execution.autonomousApproval === true,
    executionStarted:
      execution.executionStarted === true,
    recoveryRequired:
      execution.recoveryRequired === true,
    recoveryReason:
      cleanText(
        execution.recoveryReason,
        MAX_LONG_TEXT
      ),
    startedAt:
      cleanText(
        execution.startedAt,
        100
      ),
    completedAt:
      cleanText(
        execution.completedAt,
        100
      ),
    resultCount:
      rawResults.length,
    results:
      rawResults
        .slice(0, MAX_RESULTS)
        .map(
          item =>
            safeValue(item)
        )
  };
}

function normalizeCheck(
  check
) {
  if (
    typeof check === "string"
  ) {
    return {
      name:
        cleanText(
          check,
          200
        ),
      passed: false,
      reason: ""
    };
  }

  if (
    !check ||
    typeof check !== "object"
  ) {
    return null;
  }

  return {
    name:
      cleanText(
        check.name ||
          check.check ||
          check.id,
        200
      ),
    passed:
      check.passed === true ||
      check.success === true,
    status:
      cleanText(
        check.status,
        100
      ),
    reason:
      cleanText(
        check.reason ||
          check.message ||
          "",
        MAX_LONG_TEXT
      )
  };
}

function normalizeApproach(
  plan = {}
) {
  if (
    !plan ||
    typeof plan !== "object"
  ) {
    return null;
  }

  const normalizeSubtask = subtask => {
    if (
      !subtask ||
      typeof subtask !== "object"
    ) {
      return null;
    }

    return {
      id:
        cleanText(
          subtask.id,
          100
        ),
      title:
        cleanText(
          subtask.title,
          500
        ),
      objective:
        cleanText(
          subtask.objective,
          2000
        ),
      dependencies:
        cleanList(
          subtask.dependencies
        ),
      inputs:
        cleanList(
          subtask.inputs
        ),
      outputs:
        cleanList(
          subtask.outputs
        ),
      verification:
        cleanList(
          subtask.verification
        ),
      order:
        Number.isInteger(
          subtask.order
        )
          ? subtask.order
          : null
    };
  };

  const normalizeExecutionStep = step => {
    if (
      !step ||
      typeof step !== "object"
    ) {
      return null;
    }

    return {
      step:
        Number.isInteger(
          step.step
        )
          ? step.step
          : null,
      subtaskId:
        cleanText(
          step.subtaskId,
          100
        ),
      action:
        cleanText(
          step.action,
          2000
        ),
      expectedOutput:
        cleanText(
          step.expectedOutput,
          2000
        )
    };
  };

  const normalizeVerification = item => {
    if (
      !item ||
      typeof item !== "object"
    ) {
      return null;
    }

    return {
      checkId:
        cleanText(
          item.checkId,
          100
        ),
      target:
        cleanText(
          item.target,
          1000
        ),
      method:
        cleanText(
          item.method,
          2000
        ),
      expected:
        cleanText(
          item.expected,
          2000
        ),
      required:
        item.required !== false
    };
  };

  const deliverable =
    plan.deliverable &&
    typeof plan.deliverable === "object"
      ? {
          type:
            cleanText(
              plan.deliverable.type,
              200
            ),
          description:
            cleanText(
              plan.deliverable.description,
              3000
            ),
          outputs:
            cleanList(
              plan.deliverable.outputs
            ),
          acceptanceCriteria:
            cleanList(
              plan.deliverable.acceptanceCriteria
            )
        }
      : {
          type: "",
          description: "",
          outputs: [],
          acceptanceCriteria: []
        };

  return {
    planId:
      cleanText(
        plan.id,
        200
      ),
    version:
      Number.isInteger(
        plan.version
      )
        ? plan.version
        : null,
    taskId:
      cleanText(
        plan.taskId,
        200
      ),
    goal:
      cleanText(
        plan.goal,
        MAX_LONG_TEXT
      ),
    requirements:
      cleanList(
        plan.requirements
      ),
    subtasks:
      Array.isArray(
        plan.subtasks
      )
        ? plan.subtasks
            .map(
              normalizeSubtask
            )
            .filter(Boolean)
            .slice(0, MAX_ARRAY)
        : [],
    missingRequirements:
      cleanList(
        plan.missingRequirements
      ),
    feasibility:
      cleanText(
        plan.feasibility,
        100
      ),
    feasibilityReasons:
      cleanList(
        plan.feasibilityReasons
      ),
    executionPlan:
      Array.isArray(
        plan.executionPlan
      )
        ? plan.executionPlan
            .map(
              normalizeExecutionStep
            )
            .filter(Boolean)
            .slice(0, MAX_ARRAY)
        : [],
    verificationPlan:
      Array.isArray(
        plan.verificationPlan
      )
        ? plan.verificationPlan
            .map(
              normalizeVerification
            )
            .filter(Boolean)
            .slice(0, MAX_ARRAY)
        : [],
    deliverable,
    status:
      cleanText(
        plan.status,
        100
      ),
    executionAllowed:
      plan.executionAllowed === true,
    planningOnly:
      plan.planningOnly === true,
    createdAt:
      cleanText(
        plan.createdAt,
        100
      ),
    updatedAt:
      cleanText(
        plan.updatedAt,
        100
      ),
    parentPlanId:
      cleanText(
        plan.parentPlanId,
        200
      ),
    replanningReason:
      cleanText(
        plan.replanningReason,
        3000
      )
  };
}

function normalizeQA(
  qa = {}
) {
  const rawChecks =
    Array.isArray(
      qa.checks
    )
      ? qa.checks
      : [];

  return {
    status:
      cleanText(
        qa.status,
        100
      ),
    success:
      qa.success === true,
    stage:
      cleanText(
        qa.stage,
        100
      ),
    engineVersion:
      cleanText(
        qa.engineVersion,
        100
      ),
    taskId:
      cleanText(
        qa.taskId,
        200
      ),
    planId:
      cleanText(
        qa.planId,
        200
      ),
    checks:
      rawChecks
        .slice(0, MAX_CHECKS)
        .map(
          normalizeCheck
        )
        .filter(Boolean),
    failedChecks:
      cleanList(
        qa.failedChecks,
        MAX_CHECKS,
        200
      ),
    reasons:
      cleanList(
        qa.reasons,
        MAX_CHECKS,
        MAX_LONG_TEXT
      ),
    reworkRequired:
      qa.reworkRequired === true,
    recoveryRequired:
      qa.recoveryRequired === true,
    finalAcceptance:
      qa.finalAcceptance === true,
    reworkContext:
      safeValue(
        qa.reworkContext
      ),
    evaluatedAt:
      cleanText(
        qa.evaluatedAt,
        100
      )
  };
}

function normalizeFeedback(
  feedback = {}
) {
  return {
    provided:
      feedback.provided === true,
    summary:
      cleanText(
        feedback.summary,
        MAX_LONG_TEXT
      ),
    positive:
      cleanList(
        feedback.positive,
        MAX_ARRAY,
        MAX_LONG_TEXT
      ),
    negative:
      cleanList(
        feedback.negative,
        MAX_ARRAY,
        MAX_LONG_TEXT
      ),
    requestedChanges:
      cleanList(
        feedback.requestedChanges,
        MAX_ARRAY,
        MAX_LONG_TEXT
      )
  };
}

function summarizeWorked(
  execution,
  qa
) {
  const worked = [];

  if (
    execution.success
  ) {
    worked.push(
      "Stage 5.4 execution completed successfully."
    );
  }

  if (
    qa.status ===
      "qa_passed" &&
    qa.success
  ) {
    worked.push(
      "Stage 6.1 quality assurance accepted the result."
    );
  }

  if (
    qa.finalAcceptance
  ) {
    worked.push(
      "Final acceptance criteria passed."
    );
  }

  if (
    execution.resultCount > 0
  ) {
    worked.push(
      `${execution.resultCount} execution result(s) were recorded.`
    );
  }

  return worked;
}

function summarizeFailed(
  execution,
  qa,
  feedback
) {
  const failed = [];

  if (
    execution.success !== true
  ) {
    failed.push(
      `Execution failed: ${
        execution.status ||
        "unknown execution status"
      }.`
    );
  }

  for (
    const check of qa.failedChecks
  ) {
    failed.push(
      `QA failed: ${check}.`
    );
  }

  for (
    const reason of qa.reasons
  ) {
    failed.push(
      reason
    );
  }

  for (
    const item of feedback.negative
  ) {
    failed.push(
      `Feedback: ${item}`
    );
  }

  return [
    ...new Set(
      failed
    )
  ].slice(
    0,
    MAX_ARRAY
  );
}

function deriveLessons(
  task,
  execution,
  qa,
  feedback
) {
  const lessons = [];

  if (
    qa.status ===
      "qa_failed"
  ) {
    lessons.push(
      "Execution success does not imply task success; QA evidence must be considered before acceptance."
    );

    if (
      qa.failedChecks.includes(
        "requirements"
      )
    ) {
      lessons.push(
        "Future executions should explicitly verify every stated task requirement."
      );
    }

    if (
      qa.failedChecks.includes(
        "quality"
      )
    ) {
      lessons.push(
        "Quality criteria should be checked before declaring a work result complete."
      );
    }
  }

  for (
    const requestedChange of
      feedback.requestedChanges
  ) {
    lessons.push(
      `Requested improvement: ${requestedChange}`
    );
  }

  return [
    ...new Set(
      lessons
    )
  ].slice(
    0,
    MAX_ARRAY
  );
}

function deriveKnowledgeCandidates(
  task,
  lessons
) {
  return lessons
    .map(
      lesson => ({
        topic:
          task.type ||
          "general-work",
        lesson:
          cleanText(
            lesson,
            MAX_LONG_TEXT
          ),
        sourceTaskId:
          task.id,
        candidateType:
          "work-derived-knowledge"
      })
    )
    .slice(
      0,
      MAX_ARRAY
    );
}

function deriveSkillCandidates(
  task,
  qa,
  feedback
) {
  const candidates = [];

  if (
    qa.failedChecks.includes(
      "requirements"
    )
  ) {
    candidates.push({
      skill:
        "requirement-verification",
      improvement:
        "Verify each requirement explicitly before final acceptance.",
      reason:
        "Requirements check failed.",
      taskType:
        task.type
    });
  }

  if (
    qa.failedChecks.includes(
      "quality"
    )
  ) {
    candidates.push({
      skill:
        "quality-validation",
      improvement:
        "Perform explicit quality checks before final acceptance.",
      reason:
        "Quality check failed.",
      taskType:
        task.type
    });
  }

  for (
    const requestedChange of
      feedback.requestedChanges
  ) {
    candidates.push({
      skill:
        "task-specific-improvement",
      improvement:
        cleanText(
          requestedChange,
          MAX_LONG_TEXT
        ),
      reason:
        "Human or external feedback.",
      taskType:
        task.type
    });
  }

  return candidates
    .slice(
      0,
      MAX_ARRAY
    );
}

function hasActionableImprovement(
  qa,
  feedback,
  skillCandidates
) {
  if (
    IMPROVEMENT_SIGNAL_STATUSES.has(
      qa.status
    )
  ) {
    return true;
  }

  if (
    feedback.requestedChanges.length > 0
  ) {
    return true;
  }

  if (
    feedback.negative.length > 0
  ) {
    return true;
  }

  if (
    skillCandidates.length > 0
  ) {
    return true;
  }

  return false;
}

function buildImprovementFingerprint(
  record
) {
  const payload = {
    taskType:
      record.whatWasRequired
        ?.taskType || "",
    failedChecks:
      record.qa?.failedChecks || [],
    skillUpdateCandidates:
      (
        record.skillUpdateCandidates ||
        []
      ).map(
        item => ({
          skill:
            item.skill || "",
          improvement:
            item.improvement || "",
          reason:
            item.reason || "",
          taskType:
            item.taskType || ""
        })
      ),
    requestedChanges:
      record.feedback
        ?.requestedChanges || [],
    negativeFeedback:
      record.feedback
        ?.negative || []
  };

  return sha256(
    stableStringify(
      payload
    )
  );
}

function normalizeProposalForComparison(
  proposal
) {
  const metadata =
    proposal?.metadata || {};

  if (
    typeof metadata.learningFingerprint ===
      "string" &&
    metadata.learningFingerprint
  ) {
    return metadata.learningFingerprint;
  }

  const payload = {
    title:
      cleanText(
        proposal?.title,
        300
      ),
    category:
      cleanText(
        proposal?.category,
        100
      ),
    taskType:
      cleanText(
        metadata.taskType,
        100
      ),
    failedChecks:
      cleanList(
        metadata.failedChecks,
        MAX_CHECKS,
        200
      ),
    skillUpdateCandidates:
      Array.isArray(
        metadata.skillUpdateCandidates
      )
        ? metadata.skillUpdateCandidates.map(
            item => ({
              skill:
                cleanText(
                  item?.skill,
                  200
                ),
              improvement:
                cleanText(
                  item?.improvement,
                  MAX_LONG_TEXT
                ),
              reason:
                cleanText(
                  item?.reason,
                  MAX_LONG_TEXT
                ),
              taskType:
                cleanText(
                  item?.taskType,
                  100
                )
            })
          )
        : [],
    requestedChanges:
      cleanList(
        metadata.requestedChanges,
        MAX_ARRAY,
        MAX_LONG_TEXT
      )
  };

  return sha256(
    stableStringify(
      payload
    )
  );
}

function findDuplicateProposal(
  record
) {
  const fingerprint =
    buildImprovementFingerprint(
      record
    );

  const proposals =
    listProposals({
      category:
        "self_improvement"
    });

  for (
    const proposal of proposals
  ) {
    if (
      !proposal ||
      proposal.category !==
        "self_improvement"
    ) {
      continue;
    }

    const metadata =
      proposal.metadata || {};

    if (
      metadata.learningFingerprint ===
      fingerprint
    ) {
      return proposal;
    }

    const existingFingerprint =
      normalizeProposalForComparison(
        proposal
      );

    if (
      existingFingerprint ===
      fingerprint
    ) {
      return proposal;
    }
  }

  return null;
}

function createImprovementProposal(
  record
) {
  const duplicate =
    findDuplicateProposal(
      record
    );

  if (duplicate) {
    return {
      created: false,
      duplicate: true,
      proposal:
        duplicate
    };
  }

  const taskType =
    record.whatWasRequired
      ?.taskType ||
    "general-work";

  const skillCandidates =
    Array.isArray(
      record.skillUpdateCandidates
    )
      ? record.skillUpdateCandidates
      : [];

  const failedChecks =
    record.qa?.failedChecks ||
    [];

  const requestedChanges =
    record.feedback
      ?.requestedChanges ||
    [];

  const fingerprint =
    buildImprovementFingerprint(
      record
    );

  const title =
    `Work-derived improvement: ${taskType} task learning`;

  const reasonParts = [];

  if (
    record.qa?.status ===
    "qa_failed"
  ) {
    reasonParts.push(
      `QA reported ${
        failedChecks.length
      } failed check(s).`
    );
  }

  if (
    requestedChanges.length > 0
  ) {
    reasonParts.push(
      `${requestedChanges.length} requested improvement(s) were identified.`
    );
  }

  if (
    skillCandidates.length > 0
  ) {
    reasonParts.push(
      `${skillCandidates.length} skill improvement candidate(s) were identified.`
    );
  }

  const reason =
    reasonParts.join(
      " "
    ) ||
    "Completed work produced an actionable improvement signal.";

  const expectedBenefit =
    skillCandidates.length > 0
      ? skillCandidates
          .map(
            item =>
              item.improvement
          )
          .join(
            " "
          )
          .slice(
            0,
            MAX_LONG_TEXT
          )
      : "Improve future work quality using lessons derived from completed work.";

  const proposal =
    createProposal({
      title,
      reason,
      expectedBenefit,
      category:
        "self_improvement",
      risk:
        record.qa?.status ===
        "qa_failed"
          ? "medium"
          : "low",
      actor:
        "stage6.2-work-learning",
      affectedResources: [
        "work-learning-records",
        "knowledge",
        "skills"
      ],
      estimatedComplexity:
        "medium",
      backupRequired:
        true,
      testRequired:
        true,
      metadata: {
        stage:
          "6.2",
        learningSource:
          "completed-work",
        taskId:
          record.taskId,
        executionId:
          record.executionId,
        taskType,
        qaStatus:
          record.qa?.status ||
          "",
        failedChecks,
        requestedChanges,
        lessons:
          record.lessons || [],
        knowledgeCandidates:
          record.knowledgeCandidates ||
          [],
        skillUpdateCandidates:
          skillCandidates,
        learningFingerprint:
          fingerprint,
        governanceBoundary:
          "approval-required-no-auto-apply"
      }
    });

  return {
    created: true,
    duplicate: false,
    proposal
  };
}

function calculateRecordHash(
  record
) {
  const copy =
    JSON.parse(
      JSON.stringify(
        record
      )
    );

  delete copy.integrityHash;

  return sha256(
    stableStringify(
      copy
    )
  );
}

function persistLearningRecord(
  record
) {
  const store =
    loadStore();

  const records =
    Array.isArray(
      store.records
    )
      ? store.records
      : [];

  records.push(
    record
  );

  const trimmed =
    records.length >
    MAX_RECORDS
      ? records.slice(
          records.length -
            MAX_RECORDS
        )
      : records;

  saveStore({
    version: 1,
    updatedAt:
      now(),
    records:
      trimmed
  });

  return record;
}

function validateLearningInput(
  task,
  execution,
  qa
) {
  if (
    !task.id
  ) {
    throw new Error(
      "Task id is required."
    );
  }

  if (
    !execution.taskId
  ) {
    throw new Error(
      "Execution taskId is required."
    );
  }

  if (
    !qa.taskId
  ) {
    throw new Error(
      "QA taskId is required."
    );
  }

  if (
    execution.taskId !==
    task.id
  ) {
    throw new Error(
      "Execution taskId does not match task id."
    );
  }

  if (
    qa.taskId !==
    task.id
  ) {
    throw new Error(
      "QA taskId does not match task id."
    );
  }

  if (
    execution.planId &&
    qa.planId &&
    execution.planId !==
      qa.planId
  ) {
    throw new Error(
      "Execution planId does not match QA planId."
    );
  }
}

function findExistingLearningRecord(
  taskId,
  executionId
) {
  const records =
    loadStore().records;

  return (
    records.find(
      record =>
        record.taskId ===
          taskId &&
        record.executionId ===
          executionId
    ) ||
    null
  );
}

function learnFromWork(
  input = {},
  options = {}
) {
  const task =
    normalizeTask(
      input.task
    );

  const execution =
    normalizeExecution(
      input.executionResult ||
        input.execution ||
        {}
    );

  const qa =
    normalizeQA(
      input.qaResult ||
        input.qa ||
        {}
    );

  const feedback =
    normalizeFeedback(
      input.feedback ||
        {}
    );

  try {
    validateLearningInput(
      task,
      execution,
      qa
    );
  } catch (error) {
    return {
      success: false,
      status:
        "rejected_input",
      stage:
        "6.2",
      engineVersion:
        ENGINE_VERSION,
      error:
        error.message
    };
  }

  const executionId =
    getExecutionId(
      task,
      execution
    );

  const existing =
    findExistingLearningRecord(
      task.id,
      executionId
    );

  if (existing) {
    return {
      success: true,
      status:
        "duplicate",
      stage:
        "6.2",
      engineVersion:
        ENGINE_VERSION,
      duplicate:
        true,
      learningId:
        existing.learningId,
      record:
        existing,
      proposal:
        null
    };
  }

  const whatWasRequired = {
    title:
      task.title,
    description:
      task.description,
    requirements:
      task.requirements,
    deliverables:
      task.deliverables,
    requiredSkills:
      task.requiredSkills,
    taskType:
      task.type
  };

  const whatWorked =
    summarizeWorked(
      execution,
      qa
    );

  const whatFailed =
    summarizeFailed(
      execution,
      qa,
      feedback
    );

  const lessons =
    deriveLessons(
      task,
      execution,
      qa,
      feedback
    );

  const knowledgeCandidates =
    deriveKnowledgeCandidates(
      task,
      lessons
    );

  const skillUpdateCandidates =
    deriveSkillCandidates(
      task,
      qa,
      feedback
    );

  const actionable =
    hasActionableImprovement(
      qa,
      feedback,
      skillUpdateCandidates
    );

  const createdAt =
    now();

  const record = {
    schemaVersion:
      2,
    engineVersion:
      ENGINE_VERSION,
    learningId:
      createLearningId(
        task.id,
        executionId
      ),
    taskId:
      task.id,
    executionId,
    task,
    execution: {
      ...execution,
      executionId
    },
    approach:
      normalizeApproach(
        input.plan
      ),
    whatWasRequired,
    whatWorked,
    whatFailed,
    feedback,
    qa,
    lessons,
    knowledgeCandidates,
    skillUpdateCandidates,
    governance: {
      proposalCreated:
        false,
      proposalId:
        null,
      status:
        "not_created",
      approvalRequired:
        true,
      autoApplied:
        false
    },
    createdAt,
    integrityHash:
      null,
    status:
      "learned"
  };

  let proposalResult =
    null;

  if (
    options.createImprovementProposal !==
      false &&
    actionable
  ) {
    proposalResult =
      createImprovementProposal(
        record
      );

    if (
      proposalResult.duplicate
    ) {
      record.governance.status =
        "duplicate";

      record.status =
        "proposal_duplicate";

      record.governance.proposalCreated =
        true;

      record.governance.proposalId =
        proposalResult.proposal
          ?.changeId ||
        null;
    } else if (
      proposalResult.created
    ) {
      record.governance.status =
        proposalResult.proposal
          ?.status ||
        "proposed";

      record.governance.proposalCreated =
        true;

      record.governance.proposalId =
        proposalResult.proposal
          ?.changeId ||
        null;

      record.status =
        "proposal_created";
    }
  } else {
    record.governance.status =
      "not_created";

    record.status =
      "no_improvement_proposed";
  }

  /*
   * Hard Stage 6.2 governance boundary:
   *
   * Learning may create a proposal.
   * Learning may never approve a proposal.
   * Learning may never apply a proposal.
   */
  record.governance.approvalRequired =
    true;

  record.governance.autoApplied =
    false;

  record.integrityHash =
    calculateRecordHash(
      record
    );

  persistLearningRecord(
    record
  );

  recordAudit({
    actorRole:
      "stage6.2-work-learning",
    action:
      "work_learning_recorded",
    resource:
      "work-learning-record",
    resourceId:
      record.learningId,
    status:
      "success",
    details: {
      taskId:
        record.taskId,
      executionId:
        record.executionId,
      qaStatus:
        record.qa.status,
      learningStatus:
        record.status,
      proposalCreated:
        record.governance
          .proposalCreated,
      proposalId:
        record.governance
          .proposalId,
      approvalRequired:
        record.governance
          .approvalRequired,
      autoApplied:
        record.governance
          .autoApplied
    }
  });

  return {
    success: true,
    stage:
      "6.2",
    engineVersion:
      ENGINE_VERSION,
    status:
      record.status,
    learningId:
      record.learningId,
    executionId:
      record.executionId,
    record,
    proposal:
      proposalResult?.proposal ||
      null,
    proposalDuplicate:
      proposalResult?.duplicate ===
      true
  };
}

function getLearningRecord(
  learningId
) {
  if (
    !learningId
  ) {
    return null;
  }

  return (
    loadStore()
      .records.find(
        record =>
          record.learningId ===
          learningId
      ) ||
    null
  );
}

function listLearningRecords(
  options = {}
) {
  let records =
    loadStore().records
      .slice()
      .reverse();

  if (
    options.taskId
  ) {
    records =
      records.filter(
        record =>
          record.taskId ===
          options.taskId
      );
  }

  if (
    options.status
  ) {
    records =
      records.filter(
        record =>
          record.status ===
          options.status
      );
  }

  if (
    options.qaStatus
  ) {
    records =
      records.filter(
        record =>
          record.qa?.status ===
          options.qaStatus
      );
  }

  const limit =
    Number.isInteger(
      options.limit
    ) &&
    options.limit > 0
      ? Math.min(
          options.limit,
          MAX_RECORDS
        )
      : MAX_RECORDS;

  return records.slice(
    0,
    limit
  );
}

function calculateLegacyRecordHash(
  record
) {
  const clone =
    JSON.parse(
      JSON.stringify(
        record
      )
    );

  delete clone.integrityHash;

  return sha256(
    JSON.stringify(
      clone
    )
  );
}

function verifyLearningRecordIntegrity(
  learningId
) {
  const record =
    getLearningRecord(
      learningId
    );

  if (!record) {
    return {
      success: false,
      found: false,
      learningId,
      valid: false
    };
  }

  const schemaVersion =
    Number(
      record.schemaVersion || 1
    );

  const legacy =
    schemaVersion === 1;

  const expected =
    legacy
      ? calculateLegacyRecordHash(
          record
        )
      : calculateRecordHash(
          record
        );

  return {
    success: true,
    found: true,
    learningId,
    schemaVersion,
    hashAlgorithm:
      legacy
        ? "legacy-json-stringify-sha256"
        : "stable-stringify-sha256",
    valid:
      expected ===
      record.integrityHash,
    expectedHash:
      expected,
    storedHash:
      record.integrityHash
  };
}

function getLearningStats() {
  const records =
    loadStore().records;

  const stats = {
    total:
      records.length,
    learned:
      0,
    proposalCreated:
      0,
    proposalDuplicate:
      0,
    noImprovementProposed:
      0,
    qaPassed:
      0,
    qaFailed:
      0,
    recoveryRequired:
      0
  };

  for (
    const record of records
  ) {
    if (
      record.status ===
      "learned"
    ) {
      stats.learned++;
    }

    if (
      record.status ===
      "proposal_created"
    ) {
      stats.proposalCreated++;
    }

    if (
      record.status ===
      "proposal_duplicate"
    ) {
      stats.proposalDuplicate++;
    }

    if (
      record.status ===
      "no_improvement_proposed"
    ) {
      stats.noImprovementProposed++;
    }

    if (
      record.qa?.status ===
      "qa_passed"
    ) {
      stats.qaPassed++;
    }

    if (
      record.qa?.status ===
      "qa_failed"
    ) {
      stats.qaFailed++;
    }

    if (
      record.qa?.recoveryRequired
    ) {
      stats.recoveryRequired++;
    }
  }

  return stats;
}

module.exports = {
  ENGINE_VERSION,
  LEARNING_FILE,
  MAX_RECORDS,
  LEARNING_STATUSES,

  ensureStore,
  loadStore,
  saveStore,

  sha256,
  normalizeTask,
  normalizeExecution,
  normalizeQA,
  normalizeFeedback,

  deriveLessons,
  deriveKnowledgeCandidates,
  deriveSkillCandidates,

  findDuplicateProposal,
  createImprovementProposal,

  calculateRecordHash,
  persistLearningRecord,

  learnFromWork,
  getLearningRecord,
  listLearningRecords,
  verifyLearningRecordIntegrity,
  getLearningStats
};
