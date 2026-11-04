const firewallDefense = require("../firewall-defense");
const { checkToolSafety } = require("../services/mira-tool-execution-policy");

module.exports = {
  name: "firewall_defense",

  declaration: {
    name: "firewall_defense",
    description:
      "Manage defensive firewall inspections and approval-gated firewall change proposals. Never modifies firewall rules automatically.",

    parameters: {
      type: "object",
      properties: {
        action: {
          type: "string",
          enum: [
            "status",
            "enable",
            "disable",
            "inspect",
            "propose",
            "approve",
            "deny",
            "clear"
          ]
        },

        observations: {
          type: "array",
          items: {
            type: "string"
          }
        },

        changes: {
          type: "array",
          items: {
            type: "object",
            properties: {
              description: {
                type: "string"
              },
              reason: {
                type: "string"
              },
              risk: {
                type: "string"
              },
              rollback: {
                type: "string"
              }
            },
            required: ["description"]
          }
        },

        decision: {
          type: "string",
          enum: ["APPROVE", "DENY"]
        }
      },
      required: ["action"]
    }
  },

  execute: async (args = {}) => {
    const safety = checkToolSafety("firewall_defense", args);
    if (!safety || safety.passed !== true) {
      return JSON.stringify({
        success: false,
        status: "BLOCKED",
        code: "TOOL_POLICY_DENIED",
        reason: safety?.reason || "Tool execution policy could not be verified."
      });
    }

    const action = String(
      args.action || ""
    )
      .trim()
      .toLowerCase();

    switch (action) {
      case "status":
        return JSON.stringify(
          firewallDefense.getStatus(),
          null,
          2
        );

      case "enable":
        return JSON.stringify(
          firewallDefense.setEnabled(true),
          null,
          2
        );

      case "disable":
        return JSON.stringify(
          firewallDefense.setEnabled(false),
          null,
          2
        );

      case "inspect":
        return JSON.stringify(
          await firewallDefense.createInspection(
            args.observations || []
          ),
          null,
          2
        );

      case "propose":
        return JSON.stringify(
          firewallDefense.createProposal(
            args.changes || []
          ),
          null,
          2
        );

      case "approve":
      case "deny":
        return JSON.stringify(
          firewallDefense.decideProposal(
            action === "approve"
              ? "APPROVE"
              : "DENY"
          ),
          null,
          2
        );

      case "clear":
        return JSON.stringify(
          firewallDefense.clearPendingProposal(),
          null,
          2
        );

      default:
        throw new Error(
          "Invalid firewall_defense action."
        );
    }
  }
};
