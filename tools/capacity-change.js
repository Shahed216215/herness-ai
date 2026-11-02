const {
  createProposal,
  getProposal,
  listPendingProposals
} = require("../capacity-change");

const {
  getKnowledgeStats
} = require("../knowledge");

const fs = require("fs");
const path = require("path");

const name = "capacity_change";

const declaration = {
  type: "function",

  function: {
    name,

    description:
      "Create or inspect an admin-approved capacity change proposal for Mira knowledge or memory storage. Creating a proposal never changes capacity.",

    parameters: {
      type: "object",

      properties: {
        action: {
          type: "string",
          enum: [
            "propose",
            "get",
            "pending"
          ],
          description:
            "propose creates a pending capacity-change proposal; get reads one proposal; pending lists pending proposals."
        },

        target: {
          type: "string",
          enum: [
            "knowledge",
            "memory"
          ],
          description:
            "Storage capacity target."
        },

        requestedCapacity: {
          type: "integer",
          minimum: 1,
          maximum: 10000,
          description:
            "Requested new capacity. Only used with propose."
        },

        reason: {
          type: "string",
          description:
            "Reason for requesting the capacity change."
        },

        proposalId: {
          type: "string",
          description:
            "Proposal ID. Required for get."
        }
      },

      required: [
        "action"
      ],

      additionalProperties: false
    }
  }
};

function getCurrentMemoryCapacity() {
  try {
    const source =
      fs.readFileSync(
        path.join(
          __dirname,
          "..",
          "memory.js"
        ),
        "utf8"
      );

    const match =
      source.match(
        /const\s+MAX_MEMORY\s*=\s*(\d+)/
      );

    if (match) {
      return Number(match[1]);
    }
  } catch (_) {}

  return null;
}

function getCurrentCapacity(target) {
  if (target === "knowledge") {
    const stats =
      getKnowledgeStats();

    return Number(
      stats.maximum
    );
  }

  if (target === "memory") {
    return getCurrentMemoryCapacity();
  }

  return null;
}

async function execute(args = {}) {
  const action =
    String(
      args.action || ""
    )
      .trim()
      .toLowerCase();

  if (
    ![
      "propose",
      "get",
      "pending"
    ].includes(action)
  ) {
    return {
      success: false,
      error:
        "Unsupported capacity_change action."
    };
  }

  if (action === "pending") {
    return {
      success: true,
      action,
      approvalRequired: true,
      changesApplied: false,
      proposals:
        listPendingProposals()
    };
  }

  if (action === "get") {
    const proposalId =
      String(
        args.proposalId || ""
      ).trim();

    if (!proposalId) {
      return {
        success: false,
        error:
          "proposalId is required."
      };
    }

    const proposal =
      getProposal(
        proposalId
      );

    if (!proposal) {
      return {
        success: false,
        error:
          "Capacity change proposal not found."
      };
    }

    return {
      success: true,
      action,
      approvalRequired: true,
      changesApplied:
        proposal.status === "applied",
      proposal
    };
  }

  const target =
    String(
      args.target || ""
    )
      .trim()
      .toLowerCase();

  if (
    ![
      "knowledge",
      "memory"
    ].includes(target)
  ) {
    return {
      success: false,
      error:
        "target must be knowledge or memory."
    };
  }

  const requestedCapacity =
    Number(
      args.requestedCapacity
    );

  if (
    !Number.isInteger(
      requestedCapacity
    ) ||
    requestedCapacity < 1 ||
    requestedCapacity > 10000
  ) {
    return {
      success: false,
      error:
        "requestedCapacity must be an integer between 1 and 10000."
    };
  }

  const currentCapacity =
    getCurrentCapacity(
      target
    );

  if (
    !Number.isInteger(
      currentCapacity
    )
  ) {
    return {
      success: false,
      error:
        "Current capacity could not be determined."
    };
  }

  if (
    requestedCapacity ===
    currentCapacity
  ) {
    return {
      success: false,
      error:
        "Requested capacity is unchanged.",
      target,
      currentCapacity,
      requestedCapacity
    };
  }

  const reason =
    String(
      args.reason || ""
    )
      .trim()
      .slice(0, 2000);

  if (!reason) {
    return {
      success: false,
      error:
        "A reason is required for a capacity change proposal."
    };
  }

  const result =
    createProposal({
      target,
      currentCapacity,
      requestedCapacity,
      reason,
      source: {
        title:
          "Mira capacity change request",
        url: ""
      }
    });

  return {
    success: true,
    action: "propose",
    proposal:
      result.proposal,
    duplicate:
      result.duplicate,
    approvalRequired: true,
    changesApplied: false,
    reason:
      result.duplicate
        ? "An identical pending proposal already exists."
        : "Capacity change proposal created. Admin approval is required before any capacity is changed."
  };
}

module.exports = {
  name,
  declaration,
  execute
};
