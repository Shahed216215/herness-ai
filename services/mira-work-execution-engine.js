"use strict";

const {
  createTaskPlan,
  validatePlan
} = require("./mira-task-planner");

const {
  runTool
} = require("./tool-runner");

const {
  tools
} = require("../tools");

const {
  getOperationPolicy
} = require("../autonomous-operations-policy");

const {
  checkPolicyGate
} = require("../autonomous-policy-gate");

const {
  authorizeAndAuditOperation
} = require("../autonomous-approval-audit");

const {
  authorizeWork
} = require("./mira-autonomous-work-authorization");

const {
  recordAudit
} = require("../audit-log");

const {
  getSkillTools
} = require("../capability-profile");

/*
 * Stage 5.4
 *
 * Universal Work Execution Engine
 *
 * Important safety rule:
 * - Planning never authorizes execution.
 * - Tool execution is always mediated by this engine.
 * - Unknown tools are denied.
 * - Unknown operations are denied.
 * - Explicit-confirmation tools cannot be silently confirmed.
 * - Destructive operations cannot receive autonomous approval.
 * - Global 17.x governance remains authoritative.
 */

const ENGINE_VERSION = "5.4.0";

const MAX_TOOL_CALLS = 10;

const RISK_ORDER = Object.freeze({
  low: 1,
  medium: 2,
  high: 3,
  critical: 4
});

/*
 * Tool-level safety policy.
 *
 * operation:
 *   Existing 17.x autonomous operation class.
 *
 * autonomous:
 *   Whether the Stage 5.4 engine may autonomously approve
 *   the tool when all seven checks pass.
 *
 * humanApprovalRequired:
 *   Hard boundary. The engine must never convert this
 *   operation into autonomous approval.
 *
 * explicitConfirmation:
 *   Tool requires explicit user confirmation in its arguments.
 */
const TOOL_POLICIES = Object.freeze({
  calculator: {
    operation: "test",
    autonomous: true,
    humanApprovalRequired: false,
    explicitConfirmation: false
  },

  capacity_change: {
    operation: "proposal_create",
    autonomous: true,
    humanApprovalRequired: false,
    explicitConfirmation: false
  },

  firewall_defense: {
    operation: "controlled_apply",
    autonomous: false,
    humanApprovalRequired: true,
    explicitConfirmation: true
  },

  knowledge_backup: {
    operation: "file_modify",
    autonomous: false,
    humanApprovalRequired: true,
    explicitConfirmation: false
  },

  knowledge_cleanup: {
    operation: "file_modify",
    autonomous: false,
    humanApprovalRequired: true,
    explicitConfirmation: true
  },

  knowledge_count: {
    operation: "read",
    autonomous: true,
    humanApprovalRequired: false,
    explicitConfirmation: false
  },

  knowledge_improve: {
    operation: "proposal_create",
    autonomous: true,
    humanApprovalRequired: false,
    explicitConfirmation: false
  },

  knowledge_restore: {
    operation: "file_modify",
    autonomous: false,
    humanApprovalRequired: true,
    explicitConfirmation: true
  },

  knowledge_save: {
    operation: "file_modify",
    autonomous: true,
    humanApprovalRequired: false,
    explicitConfirmation: false
  },

  knowledge_search: {
    operation: "read",
    autonomous: true,
    humanApprovalRequired: false,
    explicitConfirmation: false
  },

  learning_save: {
    operation: "file_modify",
    autonomous: true,
    humanApprovalRequired: false,
    explicitConfirmation: false
  },

  memory_backup: {
    operation: "file_modify",
    autonomous: false,
    humanApprovalRequired: true,
    explicitConfirmation: false
  },

  memory_count: {
    operation: "read",
    autonomous: true,
    humanApprovalRequired: false,
    explicitConfirmation: false
  },

  memory_restore: {
    operation: "file_modify",
    autonomous: false,
    humanApprovalRequired: true,
    explicitConfirmation: true
  },

  memory_save: {
    operation: "file_modify",
    autonomous: true,
    humanApprovalRequired: false,
    explicitConfirmation: false
  },

  system_info: {
    operation: "inspect",
    autonomous: true,
    humanApprovalRequired: false,
    explicitConfirmation: false
  },

  tool_health: {
    operation: "inspect",
    autonomous: true,
    humanApprovalRequired: false,
    explicitConfirmation: false
  },

  project_connection_audit: {
    operation: "inspect",
    autonomous: true,
    humanApprovalRequired: false,
    explicitConfirmation: false
  },

  mira_one_run_audit: {
    operation: "inspect",
    autonomous: true,
    humanApprovalRequired: false,
    explicitConfirmation: false
  },

  marketing_client_context: {
    operation: "inspect",
    autonomous: true,
    humanApprovalRequired: false,
    explicitConfirmation: false
  },

  seo_workflow_history: {
    operation: "inspect",
    autonomous: false,
    humanApprovalRequired: true,
    explicitConfirmation: false
  },

  seo_workflow_review_decision: {
    operation: "human_review_decision",
    autonomous: false,
    humanApprovalRequired: true,
    explicitConfirmation: true
  },

  seo_audit: {
    operation: "inspect",
    autonomous: true,
    humanApprovalRequired: false,
    explicitConfirmation: false
  },

  hfm_database_status: {
    operation: "inspect",
    autonomous: true,
    humanApprovalRequired: false,
    explicitConfirmation: false
  },

  web_search: {
    operation: "read",
    autonomous: true,
    humanApprovalRequired: false,
    explicitConfirmation: false
  }
});

function now() {
  return new Date().toISOString();
}

function cleanText(value, max = 5000) {
  const text =
    value === undefined ||
    value === null
      ? ""
      : String(value).trim();

  if (text.length > max) {
    throw new Error(
      "Value exceeds maximum length."
    );
  }

  return text;
}

function getToolPolicy(toolName) {
  const normalized =
    cleanText(toolName, 200).toLowerCase();

  return (
    TOOL_POLICIES[normalized] || null
  );
}

function getTaskRisk(plan) {
  const risk =
    plan?.taskUnderstanding?.task?.risk ||
    plan?.taskUnderstanding?.risk ||
    "low";

  const normalized =
    String(risk).trim().toLowerCase();

  return RISK_ORDER[normalized]
    ? normalized
    : "critical";
}

function checkPermission(options = {}) {
  return {
    check: "permission",
    passed:
      options.permissionGranted === true,
    reason:
      options.permissionGranted === true
        ? "Execution permission is present."
        : "Execution permission was not explicitly granted."
  };
}

function checkRisk(plan) {
  const risk = getTaskRisk(plan);
  const level = RISK_ORDER[risk];

  /*
   * Stage 6.3 autonomous work execution is limited
   * to low-risk work.
   */
  const passed = level === RISK_ORDER.low;

  return {
    check: "risk",
    passed,
    risk,
    reason: passed
      ? `Task risk is ${risk}.`
      : `Task risk ${risk} is above the autonomous execution threshold.`
  };
}

function checkCapability(plan, toolName) {
  const matches =
    plan?.taskUnderstanding
      ?.capabilityMatches;

  /*
   * The selected tool itself must be loaded.
   */
  if (!tools[toolName]) {
    return {
      check: "capability",
      passed: false,
      reason: `Tool "${toolName}" is not registered.`
    };
  }

  /*
   * If the planner identified required skills,
   * every one must be verified.
   */
  if (Array.isArray(matches) && matches.length > 0) {
    const failed =
      matches.filter(
        item => item.verified !== true
      );

    if (failed.length > 0) {
      return {
        check: "capability",
        passed: false,
        reason:
          "One or more required capabilities are not verified.",
        failedSkills:
          failed.map(
            item => item.skill
          )
      };
    }
  }

  return {
    check: "capability",
    passed: true,
    reason:
      "Required capabilities are available and verified."
  };
}

function hasDangerousConfirmationBypass(
  toolName,
  args
) {
  const policy =
    getToolPolicy(toolName);

  if (!policy) {
    return true;
  }

  /*
   * Stage 5.4 never manufactures confirmation.
   */
  if (
    policy.explicitConfirmation === true
  ) {
    return true;
  }

  /*
   * Never allow generic confirmation fields
   * to silently turn an unsafe operation into
   * an autonomous operation.
   */
  if (
    args &&
    typeof args === "object" &&
    (
      args.confirm === true &&
      [
        "knowledge_restore",
        "memory_restore"
      ].includes(toolName)
    )
  ) {
    return true;
  }

  return false;
}

function checkToolSafety(toolName, args) {
  const policy =
    getToolPolicy(toolName);

  if (!policy) {
    return {
      check: "tool_safety",
      passed: false,
      reason:
        "No Stage 5.4 safety policy exists for this tool."
    };
  }

  if (policy.humanApprovalRequired) {
    return {
      check: "tool_safety",
      passed: false,
      reason:
        "This tool is restricted to explicit human approval."
    };
  }

  if (!policy.autonomous) {
    return {
      check: "tool_safety",
      passed: false,
      reason:
        "This tool is not eligible for autonomous execution."
    };
  }

  if (
    hasDangerousConfirmationBypass(
      toolName,
      args
    )
  ) {
    return {
      check: "tool_safety",
      passed: false,
      reason:
        "Explicit confirmation cannot be manufactured by autonomous execution."
    };
  }

  return {
    check: "tool_safety",
    passed: true,
    reason:
      "Tool is registered and eligible for autonomous execution."
  };
}

function checkExpectedResult(
  plan,
  toolName
) {
  const steps =
    Array.isArray(plan?.executionPlan)
      ? plan.executionPlan
      : [];

  if (steps.length === 0) {
    return {
      check: "expected_result",
      passed: false,
      reason:
        "Execution plan contains no expected output."
    };
  }

  return {
    check: "expected_result",
    passed: true,
    reason:
      `Execution plan defines an expected result for tool "${toolName}".`
  };
}

function checkPreExecutionVerification(
  plan,
  validation
) {
  const passed =
    validation.valid === true &&
    plan.executionAllowed === false &&
    plan.planningOnly === true &&
    plan.status === "validated" &&
    plan.feasibility === "feasible";

  return {
    check: "pre_execution_verification",
    passed,
    reason: passed
      ? "Plan passed all pre-execution validation gates."
      : "Plan is not in a validated executable state."
  };
}

function checkPolicyCompliance(
  toolName,
  options = {}
) {
  const policy =
    getToolPolicy(toolName);

  if (!policy) {
    return {
      check: "policy_compliance",
      passed: false,
      reason:
        "Tool policy is missing."
    };
  }

  const operationPolicy =
    getOperationPolicy(
      policy.operation
    );

  if (
    !operationPolicy.ok ||
    !operationPolicy.allowed
  ) {
    return {
      check: "policy_compliance",
      passed: false,
      reason:
        "Global operation policy denies this operation."
    };
  }

  /*
   * Ask the existing global gate whether the
   * operation could pass after autonomous approval.
   *
   * This does NOT consume quota.
   */
  const gate =
    checkPolicyGate(
      policy.operation,
      {
        permissionGranted:
          options.permissionGranted === true,
        approved:
          options.approved === true
      }
    );

  return {
    check: "policy_compliance",
    passed:
      gate.allowed === true,
    reason:
      gate.allowed === true
        ? "Global governance policy permits the operation."
        : (
            gate.reason ||
            gate.status ||
            "Global governance denied the operation."
          ),
    gate
  };
}

function runSevenChecks({
  plan,
  toolName,
  args,
  options,
  validation
}) {
  const checks = [
    checkPermission(options),
    checkRisk(plan),
    checkCapability(plan, toolName),
    checkToolSafety(toolName, args),
    checkExpectedResult(plan, toolName),
    checkPreExecutionVerification(
      plan,
      validation
    ),
    checkPolicyCompliance(
      toolName,
      options
    )
  ];

  return {
    passed:
      checks.every(
        check => check.passed === true
      ),
    checks
  };
}

function verifyExecutionResult(result) {
  if (
    result === undefined ||
    result === null
  ) {
    return {
      passed: false,
      reason:
        "Tool returned no result."
    };
  }

  if (
    typeof result === "object"
  ) {
    if (
      result.ok === false ||
      result.success === false
    ) {
      return {
        passed: false,
        reason:
          result.error ||
          result.reason ||
          "Tool reported failure."
      };
    }
  }

  return {
    passed: true,
    reason:
      "Tool returned a usable execution result."
  };
}

function resolveSkillToolCandidates(
  requiredSkills,
  task
) {
  const skills =
    Array.isArray(requiredSkills)
      ? [
          ...new Set(
            requiredSkills
              .filter(
                skill =>
                  typeof skill ===
                  "string"
              )
              .map(
                skill =>
                  skill.trim()
              )
              .filter(Boolean)
          )
        ]
      : [];

  if (skills.length === 0) {
    return {
      ok: false,
      status:
        "no_required_skills",
      candidates: [],
      matchedSkills: [],
      missingSkills: []
    };
  }

  const candidates = [];
  const matchedSkills = [];
  const missingSkills = [];

  for (
    const skill of skills
  ) {
    const result =
      getSkillTools(skill);

    if (
      !result ||
      result.ok !== true
    ) {
      missingSkills.push(
        skill
      );
      continue;
    }

    const mappedTools =
      Array.isArray(
        result.tools
      )
        ? result.tools
        : [];

    if (
      mappedTools.length === 0
    ) {
      continue;
    }

    matchedSkills.push({
      skillId:
        result.skillId,
      skillKey:
        result.skillKey,
      tools: [
        ...mappedTools
      ]
    });

    for (
      const toolName of mappedTools
    ) {
      const normalized =
        String(
          toolName || ""
        )
          .trim()
          .toLowerCase();

      if (
        !normalized ||
        !tools[normalized]
      ) {
        continue;
      }

      candidates.push({
        name:
          normalized,
        args: {
          query:
            String(
              task?.description ||
              ""
            ).trim()
        },
        source:
          "skill_tool_mapping",
        skill:
          result.skillKey
      });
    }
  }

  const uniqueCandidates = [];

  for (
    const candidate of candidates
  ) {
    const duplicate =
      uniqueCandidates.some(
        existing =>
          existing.name ===
            candidate.name &&
          existing.skill ===
            candidate.skill
      );

    if (!duplicate) {
      uniqueCandidates.push(
        candidate
      );
    }
  }

  return {
    ok:
      uniqueCandidates.length > 0,
    status:
      uniqueCandidates.length > 0
        ? "skill_tools_resolved"
        : "no_mapped_runtime_tools",
    candidates:
      uniqueCandidates,
    matchedSkills,
    missingSkills
  };
}

function inferToolCalls(
  input,
  task
) {
  const text =
    String(
      input ||
      task?.description ||
      ""
    ).trim();

  const lower =
    text.toLowerCase();

  /*
   * Explicitly recognizable read/inspection tasks.
   */
  if (
    /\b(?:system info|system information|system status)\b/i.test(
      text
    )
  ) {
    return [
      {
        name: "system_info",
        args: {}
      }
    ];
  }

  if (
    /\b(?:tool health|check tools|available tools)\b/i.test(
      text
    )
  ) {
    return [
      {
        name: "tool_health",
        args: {}
      }
    ];
  }

  if (
    /\b(?:knowledge count|count knowledge)\b/i.test(
      text
    )
  ) {
    return [
      {
        name: "knowledge_count",
        args: {}
      }
    ];
  }

  if (
    /\b(?:memory count|count memory)\b/i.test(
      text
    )
  ) {
    return [
      {
        name: "memory_count",
        args: {}
      }
    ];
  }

  if (
    /\b(?:search saved knowledge|search knowledge)\b/i.test(
      text
    )
  ) {
    const query =
      text
        .replace(
          /^.*?(?:search saved knowledge|search knowledge)\s*/i,
          ""
        )
        .trim();

    if (!query) {
      return [];
    }

    return [
      {
        name: "knowledge_search",
        args: { query }
      }
    ];
  }

  if (
    task?.type === "web_research" ||
    /\b(?:web search|search the web|research online)\b/i.test(
      text
    )
  ) {
    return [
      {
        name: "web_search",
        args: {
          query: text
        }
      }
    ];
  }

  /*
   * Calculator inference.
   *
   * Only mathematical-looking expressions are accepted.
   */
  const calculatorMatch =
    text.match(
      /(?:calculate|compute|solve)\s+(.+)$/i
    );

  if (
    calculatorMatch &&
    /^[0-9+\-*/().%\s]+$/.test(
      calculatorMatch[1].trim()
    )
  ) {
    return [
      {
        name: "calculator",
        args: {
          expression:
            calculatorMatch[1].trim()
        }
      }
    ];
  }

  /*
   * Stage 6.3.7
   *
   * Skill -> Tool routing is a fallback only.
   *
   * Existing deterministic inference above remains
   * authoritative for known safe task patterns.
   *
   * The resolver only selects a registered candidate.
   * It does not authorize execution and does not
   * bypass the existing safety/authorization gates.
   */
  const requiredSkills =
    Array.isArray(
      task?.requiredSkills
    )
      ? task.requiredSkills
      : [];

  const skillRouting =
    resolveSkillToolCandidates(
      requiredSkills,
      task
    );

  if (
    skillRouting.ok === true &&
    skillRouting.candidates.length > 0
  ) {
    const firstCandidate =
      skillRouting.candidates[0];

    if (
      firstCandidate.name ===
      "web_search"
    ) {
      return [
        {
          name:
            "web_search",
          args: {
            query: text
          }
        }
      ];
    }

    if (
      firstCandidate.name ===
      "calculator"
    ) {
      const calculatorMatch =
        text.match(
          /(?:calculate|compute|solve)\s+(.+)$/i
        );

      if (
        calculatorMatch &&
        /^[0-9+\-*/().%\s]+$/.test(
          calculatorMatch[1].trim()
        )
      ) {
        return [
          {
            name:
              "calculator",
            args: {
              expression:
                calculatorMatch[1].trim()
            }
          }
        ];
      }
    }
  }

  /*
   * Mutating tools are intentionally NOT
   * inferred automatically.
   *
   * They must be supplied as explicit toolCalls
   * by the trusted caller.
   */
  return [];
}

function normalizeToolCalls(
  input,
  task,
  suppliedToolCalls
) {
  const source =
    Array.isArray(suppliedToolCalls)
      ? suppliedToolCalls
      : inferToolCalls(
          input,
          task
        );

  if (
    source.length === 0
  ) {
    return {
      ok: false,
      status:
        "tool_selection_required",
      reason:
        "No safe deterministic tool mapping exists for this task. Explicit toolCalls are required."
    };
  }

  if (
    source.length > MAX_TOOL_CALLS
  ) {
    return {
      ok: false,
      status:
        "tool_call_limit_exceeded",
      reason:
        `Maximum ${MAX_TOOL_CALLS} tool calls are allowed per execution.`
    };
  }

  const calls = [];

  for (
    const item of source
  ) {
    if (
      !item ||
      typeof item !== "object"
    ) {
      return {
        ok: false,
        status:
          "invalid_tool_call",
        reason:
          "Each tool call must be an object."
      };
    }

    const name =
      cleanText(
        item.name,
        200
      ).toLowerCase();

    if (!name) {
      return {
        ok: false,
        status:
          "invalid_tool_call",
        reason:
          "Tool name is required."
      };
    }

    calls.push({
      name,
      args:
        item.args &&
        typeof item.args === "object"
          ? item.args
          : {}
    });
  }

  return {
    ok: true,
    calls
  };
}

function auditExecutionFailure({
  taskId,
  toolName,
  status,
  reason,
  auditStatus = "failed",
  diagnostic = {}
}) {
  const safeDiagnostic = {
    version: 1,
    decisionStage: "work_authorization",
    reasonCode: String(diagnostic.reasonCode || ""),
    category: String(diagnostic.category || ""),
    risk: String(diagnostic.risk || ""),
    operation: String(diagnostic.operation || ""),
    approvalRequired: diagnostic.approvalRequired === true
  };

  return recordAudit({
    actorRole: "system",
    action: "task_execution",
    resource: "task",
    resourceId: taskId || "",
    status: auditStatus === "blocked" ? "blocked" : "failed",
    details: {
      stage: "5.4",
      engineVersion:
        ENGINE_VERSION,
      tool: toolName || "",
      executionStatus:
        status || "failed",
      reason:
        String(reason || ""),
      ...(auditStatus === "blocked"
        ? { workAuthDiagnostic: safeDiagnostic }
        : {})
    }
  });
}

async function executeWork(
  input,
  options = {}
) {
  const startedAt = now();

  let planning;

  if (
    options.plan &&
    typeof options.plan === "object"
  ) {
    planning = {
      success: true,
      plan: options.plan,
      taskUnderstanding:
        options.taskUnderstanding ||
        null,
      executionAllowed: false,
      planningOnly: true
    };
  } else {
    planning =
      await createTaskPlan(
        input,
        {
          persist:
            options.persist !== false
        }
      );
  }

  const plan =
    planning.plan;

  const validation =
    validatePlan(plan);

  if (!validation.valid) {
    return {
      success: false,
      stage: "5.4",
      status: "plan_invalid",
      executionStarted: false,
      validation,
      recoveryRequired: false
    };
  }

  if (
    plan.feasibility !==
    "feasible"
  ) {
    return {
      success: false,
      stage: "5.4",
      status:
        "plan_not_executable",
      executionStarted: false,
      decision:
        plan.feasibility,
      validation,
      recoveryRequired: false
    };
  }

  if (
    plan.status !== "validated"
  ) {
    return {
      success: false,
      stage: "5.4",
      status:
        "plan_not_validated",
      executionStarted: false,
      validation,
      recoveryRequired: false
    };
  }

  const normalizedCalls =
    normalizeToolCalls(
      input,
      planning.taskUnderstanding
        ?.task,
      options.toolCalls
    );

  if (!normalizedCalls.ok) {
    return {
      success: false,
      stage: "5.4",
      status:
        normalizedCalls.status,
      reason:
        normalizedCalls.reason,
      executionStarted: false,
      validation,
      recoveryRequired: false
    };
  }

  const results = [];

  for (
    let index = 0;
    index <
      normalizedCalls.calls.length;
    index += 1
  ) {
    const call =
      normalizedCalls.calls[index];

    const policy =
      getToolPolicy(
        call.name
      );

    if (!policy) {
      const failure =
        auditExecutionFailure({
          taskId:
            plan.taskId,
          toolName:
            call.name,
          status:
            "unknown_tool",
          reason:
            "Tool is not covered by the Stage 5.4 tool safety policy."
        });

      return {
        success: false,
        stage: "5.4",
        status:
          "unknown_tool",
        executionStarted:
          results.length > 0,
        results,
        failureAudit:
          failure,
        recoveryRequired:
          results.length > 0,
        recoveryReason:
          "Execution stopped because an unknown tool was requested."
      };
    }

    /*
     * Stage 6.3 autonomous work authorization.
     *
     * This gate runs before the existing Stage 5.4
     * execution checks. Autonomous execution requires:
     * - known low risk
     * - trusted system-policy pre-authorization
     * - safe task content
     * - allowed global operation policy
     *
     * Human approval is never manufactured here.
     */
    /*
     * Stage 6.3.1 trusted system authorization.
     *
     * The planner's task understanding is part of the trusted
     * internal planning result and must remain available to the
     * authorization layer, especially for risk classification.
     *
     * Autonomous pre-authorization is established here from the
     * system-owned tool policy. Caller/model input is never used
     * to manufacture this authority.
     */
    const authorizationPlan = {
      ...plan,
      taskUnderstanding:
        planning.taskUnderstanding || null
    };

    const workAuthorization =
      authorizeWork({
        plan:
          authorizationPlan,
        operation:
          policy.operation,
        permissionGranted:
          options.permissionGranted === true,
        now:
          options.now
      });

    if (!workAuthorization.allowed) {
      const failure =
        auditExecutionFailure({
          taskId:
            plan.taskId,
          toolName:
            call.name,
          status:
            workAuthorization.status ||
            "approval_required",
          reason:
            workAuthorization.reason ||
            "Stage 6.3 autonomous work authorization denied execution.",
          auditStatus: "blocked",
          diagnostic: {
            reasonCode: workAuthorization.reasonCode,
            category: workAuthorization.category,
            risk: workAuthorization.risk,
            operation: workAuthorization.operation,
            approvalRequired: workAuthorization.approvalRequired
          }
        });

      return {
        success: false,
        stage: "5.4",
        status:
          workAuthorization.status ||
          "approval_required",
        executionStarted:
          results.length > 0,
        tool:
          call.name,
        checks: [],
        authorization: {
          result:
            workAuthorization,
          diagnostic: {
            version: 1,
            decisionStage: "work_authorization",
            reasonCode: workAuthorization.reasonCode || "AUTHORIZATION_DENIED",
            category: workAuthorization.category || "",
            risk: workAuthorization.risk || "unknown",
            operation: workAuthorization.operation || "",
            approvalRequired: workAuthorization.approvalRequired === true
          }
        },
        results,
        failureAudit:
          failure,
        recoveryRequired:
          results.length > 0,
        recoveryReason:
          "Stage 6.3 autonomous work authorization did not permit execution."
      };
    }

    const checks =
      runSevenChecks({
        plan,
        toolName:
          call.name,
        args:
          call.args,
        options: {
          ...options,
          approved: false
        },
        validation
      });

    if (!checks.passed) {
      const failedChecks =
        checks.checks.filter(
          check =>
            !check.passed
        );

      const failure =
        auditExecutionFailure({
          taskId:
            plan.taskId,
          toolName:
            call.name,
          status:
            "autonomous_approval_denied",
          reason:
            failedChecks
              .map(
                check =>
                  `${check.check}: ${check.reason}`
              )
              .join("; ")
        });

      return {
        success: false,
        stage: "5.4",
        status:
          "autonomous_approval_denied",
        executionStarted:
          results.length > 0,
        tool:
          call.name,
        checks:
          checks.checks,
        results,
        failureAudit:
          failure,
        recoveryRequired:
          results.length > 0,
        recoveryReason:
          "Execution stopped before the next tool call."
      };
    }

    /*
     * Autonomous approval occurs only AFTER
     * all seven checks pass.
     *
     * Existing global governance remains authoritative.
     */
    const authorization =
      authorizeAndAuditOperation({
        actorRole:
          "system",
        operation:
          policy.operation,
        permissionGranted:
          workAuthorization.allowed === true,
        approved:
          false,
        resource:
          "task",
        resourceId:
          plan.taskId
      });

    if (
      !authorization.result.allowed
    ) {
      const failure =
        auditExecutionFailure({
          taskId:
            plan.taskId,
          toolName:
            call.name,
          status:
            "global_governance_denied",
          reason:
            authorization.result.reason ||
            authorization.result.status
        });

      return {
        success: false,
        stage: "5.4",
        status:
          "global_governance_denied",
        executionStarted:
          results.length > 0,
        tool:
          call.name,
        checks:
          checks.checks,
        authorization,
        results,
        failureAudit:
          failure,
        recoveryRequired:
          results.length > 0,
        recoveryReason:
          "Global governance denied execution."
      };
    }

    let toolResult;

    try {
      toolResult =
        await runTool(
          call.name,
          call.args,
          options.trustedContext || null
        );
    } catch (error) {
      const failure =
        auditExecutionFailure({
          taskId:
            plan.taskId,
          toolName:
            call.name,
          status:
            "tool_execution_failed",
          reason:
            error.message
        });

      return {
        success: false,
        stage: "5.4",
        status:
          "tool_execution_failed",
        executionStarted: true,
        tool:
          call.name,
        checks:
          checks.checks,
        authorization,
        results,
        error:
          error.message,
        failureAudit:
          failure,
        recoveryRequired: true,
        recoveryReason:
          "Tool execution failed after authorization."
      };
    }

    const verification =
      verifyExecutionResult(
        toolResult
      );

    results.push({
      index:
        index + 1,
      tool:
        call.name,
      operation:
        policy.operation,
      autonomousApproval:
        true,
      checks:
        checks.checks,
      authorization:
        authorization.result,
      result:
        toolResult,
      verification
    });

    if (!verification.passed) {
      const failure =
        auditExecutionFailure({
          taskId:
            plan.taskId,
          toolName:
            call.name,
          status:
            "post_execution_verification_failed",
          reason:
            verification.reason
        });

      return {
        success: false,
        stage: "5.4",
        status:
          "post_execution_verification_failed",
        executionStarted: true,
        results,
        failureAudit:
          failure,
        recoveryRequired: true,
        recoveryReason:
          "Tool result failed post-execution verification."
      };
    }
  }

  const completedAt = now();

  const audit =
    recordAudit({
      actorRole: "system",
      action:
        "task_execution",
      resource: "task",
      resourceId:
        plan.taskId,
      status: "success",
      details: {
        stage: "5.4",
        engineVersion:
          ENGINE_VERSION,
        toolCount:
          results.length,
        startedAt,
        completedAt,
        autonomousApproval:
          true,
        verification:
          "passed"
      }
    });

  return {
    success: true,
    stage: "5.4",
    status:
      "execution_completed",
    executionStarted: true,
    taskId:
      plan.taskId,
    planId:
      plan.id,
    autonomousApproval:
      true,
    results,
    audit,
    recoveryRequired:
      false,
    startedAt,
    completedAt
  };
}

module.exports = {
  ENGINE_VERSION,
  MAX_TOOL_CALLS,
  TOOL_POLICIES,
  getToolPolicy,
  resolveSkillToolCandidates,
  inferToolCalls,
  verifyExecutionResult,
  executeWork
};
