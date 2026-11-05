"use strict";

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
    autonomous: false,
    humanApprovalRequired: true,
    explicitConfirmation: true
  },

  knowledge_search: {
    operation: "read",
    autonomous: true,
    humanApprovalRequired: false,
    explicitConfirmation: false
  },

  learning_save: {
    operation: "file_modify",
    autonomous: false,
    humanApprovalRequired: true,
    explicitConfirmation: true
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

  /*
   * The version-recovery wrapper exposes read-only list/verify
   * as well as a restore action. The current engine has no
   * action-scoped approval token, so keep the entire tool
   * human-only until a separately authenticated read/restore
   * dispatch contract is implemented and tested.
   */
  memory_version_recovery: {
    operation: "file_modify",
    autonomous: false,
    humanApprovalRequired: true,
    explicitConfirmation: true
  },

  memory_save: {
    operation: "file_modify",
    autonomous: false,
    humanApprovalRequired: true,
    explicitConfirmation: true
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

  web_search: {
    operation: "read",
    autonomous: true,
    humanApprovalRequired: false,
    explicitConfirmation: false
  },

  facebook_page_public_research: {
    operation: "research_evidence_archive",
    autonomous: true,
    humanApprovalRequired: false,
    explicitConfirmation: false
  },

  facebook_research_lookup: {
    operation: "read",
    autonomous: true,
    humanApprovalRequired: false,
    explicitConfirmation: false
  }
});

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

module.exports = {
  TOOL_POLICIES,
  getToolPolicy,
  hasDangerousConfirmationBypass,
  checkToolSafety
};
