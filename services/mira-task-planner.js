"use strict";

const crypto = require("crypto");
const { understandTask } = require("./mira-task-understanding");

const {
  createPlan,
  PLAN_FEASIBILITY
} = require("../task-plan-schema");

const futureStrategyEngine =
  require("./mira-future-strategy-engine");

const crossTaskLearningEngine =
  require("./mira-cross-task-learning-engine");

const IMPOSSIBLE_PATTERNS = [
  /\bteleport\b/i,
  /\btime travel\b/i,
  /\btravel through time\b/i,
  /\bguarantee.*(?:100%|exactly|certain)\b/i,
  /\bpredict.*exactly\b/i,
  /\baccess.*private account.*without authorization\b/i,
  /\baccess.*account.*without permission\b/i
];

const INPUT_PATTERNS = [
  {
    pattern: /\banaly[sz]e\b.*\bdata(?:set)?\b/i,
    requirement: "A dataset or data source must be provided."
  },
  {
    pattern: /\bedit\b.*\bfile\b/i,
    requirement: "The target file must be identified."
  },
  {
    pattern: /\bmodify\b.*\bfile\b/i,
    requirement: "The target file must be identified."
  },
  {
    pattern: /\bconvert\b.*\bfile\b/i,
    requirement: "The source file must be provided."
  },
  {
    pattern: /\bsummarize\b.*\b(?:document|file|article)\b/i,
    requirement: "The source document or text must be provided."
  }
];

function unique(values) {
  return [
    ...new Set(
      values
        .map(value => String(value || "").trim())
        .filter(Boolean)
    )
  ];
}

function createSyntheticTaskId(text) {
  const digest = crypto
    .createHash("sha256")
    .update(String(text))
    .digest("hex")
    .slice(0, 16);

  return `planned-task-${digest}`;
}

function normalizeTaskInput(input) {
  if (typeof input === "string") {
    const value = input.trim();

    if (!value) {
      throw new Error("Task input is required.");
    }

    return value;
  }

  if (!input || typeof input !== "object") {
    throw new Error("Task input is required.");
  }

  const value =
    input.input ||
    input.description ||
    input.task ||
    "";

  if (typeof value !== "string" || !value.trim()) {
    throw new Error("Task input is required.");
  }

  return value.trim();
}

function normalizeUnderstandingTask(understood, originalText) {
  if (!understood || !understood.task) {
    throw new Error(
      "Task understanding result is missing."
    );
  }

  const task = understood.task;

  return {
    ...task,
    id: task.id || createSyntheticTaskId(originalText),
    title: task.title || originalText,
    description: task.description || originalText,
    requirements: Array.isArray(task.requirements)
      ? task.requirements
      : [],
    deliverables: Array.isArray(task.deliverables)
      ? task.deliverables
      : [],
    type: task.type || "research"
  };
}

function detectImpossibleTask(text) {
  const reasons = [];

  for (const pattern of IMPOSSIBLE_PATTERNS) {
    if (pattern.test(text)) {
      reasons.push(
        "The requested outcome is not feasible for the current system."
      );
      break;
    }
  }

  return unique(reasons);
}

function detectMissingRequirements(text, task) {
  const missing = [];

  for (const item of INPUT_PATTERNS) {
    if (item.pattern.test(text)) {
      missing.push(item.requirement);
    }
  }

  if (
    task.deliverables.length === 0 &&
    /\b(?:submit|deliver|provide|create|produce)\b/i.test(text)
  ) {
    missing.push(
      "A concrete deliverable must be defined."
    );
  }

  return unique(missing);
}

function buildSubtasks(task) {
  const description = task.description || task.title;

  const isSimple =
    task.requirements.length <= 1 &&
    task.deliverables.length <= 1 &&
    !/\b(?:and then|after that|first|then|finally|step \d)\b/i.test(
      description
    );

  if (isSimple) {
    return [
      {
        id: "subtask-1",
        title: `Complete: ${task.title}`,
        objective: description,
        dependencies: [],
        inputs: task.requirements,
        outputs: task.deliverables.length
          ? task.deliverables
          : ["Completed task result"],
        verification: [
          "Confirm that the task objective is satisfied."
        ],
        order: 1
      }
    ];
  }

  return [
    {
      id: "subtask-1",
      title: "Prepare task inputs",
      objective:
        "Collect and validate the inputs required for execution.",
      dependencies: [],
      inputs: task.requirements,
      outputs: ["Validated task inputs"],
      verification: [
        "Confirm all required inputs are available."
      ],
      order: 1
    },
    {
      id: "subtask-2",
      title: "Perform the main task",
      objective: description,
      dependencies: ["subtask-1"],
      inputs: ["Validated task inputs"],
      outputs: ["Primary task result"],
      verification: [
        "Check the primary result against the task goal."
      ],
      order: 2
    },
    {
      id: "subtask-3",
      title: "Prepare the deliverable",
      objective:
        "Transform the result into the requested deliverable.",
      dependencies: ["subtask-2"],
      inputs: ["Primary task result"],
      outputs: task.deliverables.length
        ? task.deliverables
        : ["Final deliverable"],
      verification: [
        "Check deliverable completeness and format."
      ],
      order: 3
    }
  ];
}

function buildExecutionPlan(subtasks) {
  return subtasks.map((subtask, index) => ({
    step: index + 1,
    subtaskId: subtask.id,
    action: subtask.title,
    expectedOutput:
      subtask.outputs[0] ||
      "Completed subtask result"
  }));
}

function buildVerificationPlan(task, subtasks) {
  const checks = [
    {
      checkId: "check-goal",
      target: "Task goal",
      method:
        "Compare the completed result with the stated task goal.",
      expected:
        "The requested objective is satisfied.",
      required: true
    },
    {
      checkId: "check-requirements",
      target: "Task requirements",
      method:
        "Verify every stated requirement has been addressed.",
      expected:
        "All requirements are satisfied.",
      required: true
    }
  ];

  for (const subtask of subtasks) {
    checks.push({
      checkId: `check-${subtask.id}`,
      target: subtask.id,
      method:
        subtask.verification.join(" ") ||
        "Verify the subtask output.",
      expected:
        subtask.outputs.length > 0
          ? `Expected output exists: ${subtask.outputs.join(", ")}`
          : "Subtask output is valid.",
      required: true
    });
  }

  checks.push({
    checkId: "check-deliverable",
    target: "Final deliverable",
    method:
      "Check deliverable existence, completeness and acceptance criteria.",
    expected:
      "The deliverable meets its defined acceptance criteria.",
    required: true
  });

  if (task.type === "coding") {
    checks.push({
      checkId: "check-code-syntax",
      target: "Code artifacts",
      method:
        "Run the applicable syntax or structural validation.",
      expected:
        "Code passes the applicable validation gate.",
      required: true
    });
  }

  return checks;
}

function buildDeliverable(task) {
  const outputs =
    task.deliverables.length > 0
      ? task.deliverables
      : ["Completed task result"];

  return {
    type: task.type || "task_result",
    description:
      task.deliverables.length > 0
        ? `Deliver the requested ${task.deliverables.join(", ")}.`
        : "Provide the completed result of the requested task.",
    outputs,
    acceptanceCriteria: [
      "All stated requirements are addressed.",
      "The result matches the task goal.",
      "Required verification checks pass.",
      "No unapproved irreversible action is performed."
    ]
  };
}

function validatePlan(plan) {
  const errors = [];
  const warnings = [];

  if (!plan || typeof plan !== "object") {
    return {
      valid: false,
      errors: ["Plan is required."],
      warnings: []
    };
  }

  if (!plan.taskId) {
    errors.push("Plan taskId is missing.");
  }

  if (!plan.goal) {
    errors.push("Plan goal is missing.");
  }

  if (
    !Array.isArray(plan.subtasks) ||
    plan.subtasks.length === 0
  ) {
    errors.push(
      "Plan must contain at least one subtask."
    );
  }

  const ids = new Set();

  for (const subtask of plan.subtasks || []) {
    if (!subtask.id) {
      errors.push(
        "Every subtask must have an id."
      );
      continue;
    }

    if (ids.has(subtask.id)) {
      errors.push(
        `Duplicate subtask id: ${subtask.id}.`
      );
    }

    ids.add(subtask.id);
  }

  const graph = new Map();

  for (const subtask of plan.subtasks || []) {
    const dependencies =
      Array.isArray(subtask.dependencies)
        ? subtask.dependencies
        : [];

    if (dependencies.includes(subtask.id)) {
      errors.push(
        `Subtask ${subtask.id} cannot depend on itself.`
      );
    }

    for (const dependency of dependencies) {
      if (!ids.has(dependency)) {
        errors.push(
          `Subtask ${subtask.id} references unknown dependency ${dependency}.`
        );
      }
    }

    graph.set(subtask.id, dependencies);
  }

  const visiting = new Set();
  const visited = new Set();

  function visit(id) {
    if (visiting.has(id)) {
      return true;
    }

    if (visited.has(id)) {
      return false;
    }

    visiting.add(id);

    for (const dependency of graph.get(id) || []) {
      if (visit(dependency)) {
        return true;
      }
    }

    visiting.delete(id);
    visited.add(id);

    return false;
  }

  for (const id of graph.keys()) {
    if (visit(id)) {
      errors.push("Dependency cycle detected.");
      break;
    }
  }

  const executionIds = new Set(
    (plan.executionPlan || []).map(
      step => step.subtaskId
    )
  );

  for (const subtask of plan.subtasks || []) {
    if (!executionIds.has(subtask.id)) {
      errors.push(
        `Subtask ${subtask.id} is missing from the execution plan.`
      );
    }
  }

  if (
    !plan.deliverable ||
    !plan.deliverable.description ||
    !Array.isArray(
      plan.deliverable.acceptanceCriteria
    ) ||
    plan.deliverable.acceptanceCriteria.length === 0
  ) {
    errors.push(
      "Deliverable definition is incomplete."
    );
  }

  if (
    !Array.isArray(plan.verificationPlan) ||
    plan.verificationPlan.length === 0
  ) {
    errors.push(
      "Verification plan is missing."
    );
  }

  if (plan.executionAllowed !== false) {
    errors.push(
      "Planning must never authorize execution."
    );
  }

  if (plan.planningOnly !== true) {
    errors.push(
      "Planning result must be marked planningOnly."
    );
  }

  if (
    plan.feasibility ===
    "blocked_missing_requirements"
  ) {
    warnings.push(
      "Execution is blocked until missing requirements are supplied."
    );
  }

  if (plan.feasibility === "infeasible") {
    warnings.push(
      "Task is infeasible and must not proceed to execution."
    );
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings
  };
}

function buildExperienceGuidance(
  task,
  options = {}
) {
  const strategies =
    futureStrategyEngine.getStrategiesForTask(
      task,
      {
        limit: 5
      }
    );

  const safeStrategies =
    Array.isArray(strategies)
      ? strategies
      : [];

  const crossTaskLearning =
    options.useHfmWorkLearning === true
      ? (options.hfmWorkLearning || {
          engineVersion: "HFM_V02",
          taskId: task?.id || "",
          transfers: [],
          count: 0
        })
      : crossTaskLearningEngine.getCrossTaskLearning(
          task,
          {
            limit: 5
          }
        );

  const safeCrossTaskLearning =
    crossTaskLearning &&
    Array.isArray(crossTaskLearning.transfers)
      ? crossTaskLearning
      : {
          engineVersion:
            crossTaskLearningEngine.ENGINE_VERSION,

          taskId:
            task?.id || "",

          transfers: [],
          count: 0,

          governance: {
            readOnly: true,
            executable: false,
            modifiesCode: false,
            bypassesPolicy: false,
            requiresNormalTaskChecks: true
          }
        };

  return {
    retrieved: safeStrategies.length > 0,

    count:
      safeStrategies.length,

    strategies:
      safeStrategies.map(
        strategy => ({
          strategy:
            typeof strategy.strategy === "string"
              ? strategy.strategy
              : "",

          type:
            typeof strategy.type === "string"
              ? strategy.type
              : "lesson_derived",

          relevance:
            strategy.relevance || {
              score: 0,
              matchedTerms: []
            },

          source: {
            learningId:
              strategy.source?.learningId || "",

            taskId:
              strategy.source?.taskId || "",

            executionId:
              strategy.source?.executionId || "",

            createdAt:
              strategy.source?.createdAt || ""
          },

          governance: {
            executable: false,
            modifiesCode: false,
            bypassesPolicy: false,
            requiresNormalTaskChecks: true
          }
        })
      ),

    crossTaskLearning: {
      engineVersion:
        safeCrossTaskLearning.engineVersion,

      taskId:
        safeCrossTaskLearning.taskId,

      count:
        safeCrossTaskLearning.count,

      transfers:
        safeCrossTaskLearning.transfers,

      governance: {
        readOnly: true,
        executable: false,
        modifiesCode: false,
        bypassesPolicy: false,
        requiresNormalTaskChecks: true
      }
    },

    appliedToPlanning:
      safeStrategies.length > 0 ||
      safeCrossTaskLearning.count > 0,

    executionAuthorization:
      false
  };
}

function applyExperienceGuidance(
  plan,
  experienceGuidance
) {
  if (
    !plan ||
    !experienceGuidance ||
    !experienceGuidance ||
    (
      (!Array.isArray(
        experienceGuidance.strategies
      ) ||
      experienceGuidance.strategies.length === 0) &&
      (!Array.isArray(
        experienceGuidance.crossTaskLearning?.transfers
      ) ||
      experienceGuidance.crossTaskLearning.transfers.length === 0)
    )
  ) {
    return plan;
  }

  const guidanceChecks =
    (Array.isArray(
      experienceGuidance.strategies
    )
      ? experienceGuidance.strategies
      : []
    ).map(
      (strategy, index) => ({
        checkId:
          `experience-strategy-${index + 1}`,

        target:
          "Previously learned strategy",

        method:
          `Apply relevant learned guidance during planning: ${strategy.strategy}`,

        expected:
          "Relevant prior experience is considered without bypassing normal task, risk, policy, capability, approval, execution, or QA checks.",

        required:
          false
      })
    );

  const crossTaskChecks =
    (
      Array.isArray(
        experienceGuidance.crossTaskLearning?.transfers
      )
        ? experienceGuidance.crossTaskLearning.transfers
        : []
    ).map(
      (transfer, index) => {
        const lessonText =
          Array.isArray(transfer.lessons) &&
          transfer.lessons.length > 0
            ? transfer.lessons.join(" ")
            : "Relevant prior cross-task experience";

        const sourceTaskId =
          transfer.source?.taskId || transfer.sourceTaskId || "";

        return {
          checkId:
            `cross-task-experience-${index + 1}`,

          target:
            "Relevant experience from a different task",

          method:
            `Consider transferable prior experience${sourceTaskId ? ` from task ${sourceTaskId}` : ""}: ${lessonText}`,

          expected:
            "Relevant cross-task learning informs planning without overriding task requirements, risk, policy, capability, approval, execution, or QA checks.",

          required:
            false
        };
      }
    );

  plan.verificationPlan = [
    ...(Array.isArray(plan.verificationPlan)
      ? plan.verificationPlan
      : []),
    ...guidanceChecks,
    ...crossTaskChecks
  ];

  return plan;
}

function buildPlanFromUnderstanding(
  understood,
  originalText,
  options = {}
) {
  const task = normalizeUnderstandingTask(
    understood,
    originalText
  );

  const impossibleReasons =
    detectImpossibleTask(originalText);

  if (impossibleReasons.length > 0) {
    const plan = createPlan({
      taskId: task.id,
      goal: task.description || task.title,
      requirements: task.requirements,
      subtasks: [
        {
          id: "subtask-rejected",
          title: "Stop before execution",
          objective:
            "Reject the infeasible request safely.",
          dependencies: [],
          inputs: [],
          outputs: [],
          verification: [
            "Confirm that no execution was authorized."
          ],
          order: 1
        }
      ],
      missingRequirements: [],
      feasibility: "infeasible",
      feasibilityReasons: impossibleReasons,
      executionPlan: [
        {
          subtaskId: "subtask-rejected",
          action: "Reject task safely.",
          expectedOutput:
            "Task rejected without execution."
        }
      ],
      verificationPlan: [
        {
          checkId: "check-rejection",
          target: "Task feasibility",
          method:
            "Confirm that the infeasible request is rejected.",
          expected:
            "Task is rejected and execution remains unauthorized.",
          required: true
        }
      ],
      deliverable: {
        type: "none",
        description:
          "No deliverable is produced for an infeasible task.",
        outputs: [],
        acceptanceCriteria: [
          "No execution is authorized."
        ]
      },
      status: "rejected"
    });

    return {
      plan,
      validation: validatePlan(plan),
      decision: "REJECT"
    };
  }

  const missingRequirements =
    detectMissingRequirements(
      originalText,
      task
    );

  const subtasks = buildSubtasks(task);

  const feasibility =
    missingRequirements.length > 0
      ? "blocked_missing_requirements"
      : "feasible";

  const plan = createPlan({
    taskId: task.id,
    goal: task.description || task.title,
    requirements: task.requirements,
    subtasks,
    missingRequirements,
    feasibility,
    feasibilityReasons:
      missingRequirements.length > 0
        ? [
            "Required task inputs are not available."
          ]
        : [
            "No blocking feasibility issue detected."
          ],
    executionPlan:
      buildExecutionPlan(subtasks),
    verificationPlan:
      buildVerificationPlan(task, subtasks),
    deliverable:
      buildDeliverable(task),
    status:
      missingRequirements.length > 0
        ? "blocked"
        : "draft"
  });

  const experienceGuidance =
    buildExperienceGuidance(task);

  applyExperienceGuidance(
    plan,
    experienceGuidance
  );

  const validation = validatePlan(plan);

  if (!validation.valid) {
    plan.status = "rejected";
  } else if (
    plan.feasibility ===
    "blocked_missing_requirements"
  ) {
    plan.status = "blocked";
  } else {
    plan.status = "validated";
  }

  return {
    plan,
    experienceGuidance,
    validation: validatePlan(plan),
    decision:
      plan.status === "validated"
        ? "PLAN_VALID"
        : plan.status === "blocked"
          ? "BLOCK"
          : "REJECT"
  };
}

async function createTaskPlan(
  input,
  options = {}
) {
  const originalText =
    normalizeTaskInput(input);

  const understood =
    await understandTask(
      originalText,
      {
        persist: options.persist !== false
      }
    );

  let planningOptions = options;
  if (process.env.MIRA_HFM_WORK_LEARNING_ENABLED === "true") {
    if (typeof options.retrieveWorkLearning !== "function") {
      throw new Error("HFM_WORK_LEARNING_RUNTIME_REQUIRED");
    }
    const normalizedTask = normalizeUnderstandingTask(understood, originalText);
    const impossible = detectImpossibleTask(originalText).length > 0;
    const hfmWorkLearning = impossible
      ? {
          engineVersion: "HFM_V02",
          taskId: normalizedTask.id,
          transfers: [],
          count: 0,
          status: "SKIPPED_INFEASIBLE_TASK"
        }
      : await options.retrieveWorkLearning({ task: normalizedTask });
    if (!hfmWorkLearning || !Array.isArray(hfmWorkLearning.transfers) ||
        !Number.isInteger(hfmWorkLearning.count)) {
      throw new Error("HFM_WORK_LEARNING_RETRIEVAL_INVALID");
    }
    planningOptions = {
      ...options,
      useHfmWorkLearning: true,
      hfmWorkLearning
    };
  }

  const result =
    buildPlanFromUnderstanding(
      understood,
      originalText,
      planningOptions
    );

  return {
    success: true,
    stage: "5.3",
    ...result,
    taskUnderstanding: understood,
    executionAllowed: false,
    planningOnly: true
  };
}

async function replanTask(
  input,
  failureContext = {},
  options = {}
) {
  const originalText =
    normalizeTaskInput(input);

  const originalTaskId =
    typeof failureContext.taskId === "string" &&
    failureContext.taskId.trim()
      ? failureContext.taskId.trim()
      : "";

  const contextParts = [];

  if (failureContext.failure) {
    contextParts.push(
      `Previous failure: ${failureContext.failure}`
    );
  }

  if (failureContext.newInformation) {
    contextParts.push(
      `New information: ${failureContext.newInformation}`
    );
  }

  const combined =
    contextParts.length > 0
      ? `${originalText}\n${contextParts.join("\n")}`
      : originalText;

  const result =
    await createTaskPlan(
      combined,
      options
    );

  /*
   * Replanning must preserve the identity of the
   * original task. A replan creates a new plan version,
   * not a new task.
   */
  if (originalTaskId) {
    result.plan.taskId = originalTaskId;
  }

  result.plan.parentPlanId =
    failureContext.previousPlanId || "";

  result.plan.replanningReason =
    contextParts.join(" ") ||
    "Plan requested for re-planning.";

  result.plan.version =
    Number.isInteger(
      failureContext.previousVersion
    )
      ? failureContext.previousVersion + 1
      : 2;

  result.plan.status =
    result.plan.feasibility === "feasible"
      ? "validated"
      : result.plan.status;

  result.plan.updatedAt =
    new Date().toISOString();

  result.validation =
    validatePlan(result.plan);

  return result;
}

module.exports = {
  createTaskPlan,
  replanTask,
  validatePlan,
  buildSubtasks,
  buildExecutionPlan,
  buildVerificationPlan,
  buildDeliverable,
  detectMissingRequirements,
  detectImpossibleTask,
  normalizeUnderstandingTask
};
