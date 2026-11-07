const { assertLegacyStorageDisabled } = require("../services/mira-hfm-legacy-storage-guard");
const { improveExistingKnowledge } =
  require("../services/learning");

const { getKnowledge } =
  require("../knowledge");

const { createProposal } =
  require("../knowledge-improvement");

function normalize(value) {
  return String(value || "")
    .trim()
    .toLowerCase();
}

function findExistingKnowledge(title, topic) {
  const knowledge = getKnowledge();

  return knowledge.find(item =>
    item &&
    item.type === "learning" &&
    normalize(item.title) === normalize(title) &&
    normalize(item.topic) === normalize(topic)
  ) || null;
}

module.exports = {
  name: "knowledge_improve",

  declaration: {
    name: "knowledge_improve",

    description:
      "Create a pending improvement proposal for existing cybersecurity knowledge using new source content. Existing knowledge is never changed by this tool. Admin approval is required before applying any proposal.",

    parameters: {
      type: "object",

      properties: {
        sourceTitle: {
          type: "string"
        },

        sourceUrl: {
          type: "string"
        },

        content: {
          type: "string"
        }
      },

      required: ["content"]
    }
  },

  execute: async ({
    sourceTitle,
    sourceUrl,
    content
  }) => {
    assertLegacyStorageDisabled();
    try {
      const result =
        await improveExistingKnowledge({
          content,
          sourceTitle,
          sourceUrl
        });

      if (
        !result ||
        result.success !== true
      ) {
        return JSON.stringify({
          success: false,
          proposal: false,
          saved: false,
          approvalRequired: false,
          reason:
            result?.reason ||
            "Knowledge improvement proposal failed."
        });
      }

      if (result.proposal !== true) {
        return JSON.stringify({
          success: true,
          proposal: false,
          saved: false,
          approvalRequired: false,
          existing:
            result.existing || null,
          proposed:
            result.proposed || null,
          reason:
            result.reason ||
            "No improvement proposal was created."
        });
      }

      const existingMeta =
        result.existing || {};

      const proposed =
        result.proposed || {};

      const existingKnowledge =
        findExistingKnowledge(
          existingMeta.title,
          existingMeta.topic
        );

      if (!existingKnowledge) {
        return JSON.stringify({
          success: false,
          proposal: false,
          saved: false,
          approvalRequired: false,
          reason:
            "The original knowledge entry could not be found. No proposal was saved."
        });
      }

      const storedProposal =
        createProposal({
          existing: {
            ...existingMeta,
            content:
              existingKnowledge.content || ""
          },

          proposed,

          sourceTitle:
            sourceTitle || "",

          sourceUrl:
            sourceUrl || ""
        });

      return JSON.stringify({
        success: true,
        proposal: true,
        saved: true,
        improved: false,
        approvalRequired: true,

        proposalId:
          storedProposal.id,

        status:
          storedProposal.status,

        existing:
          result.existing || null,

        proposed:
          result.proposed || null,

        source:
          storedProposal.source,

        createdAt:
          storedProposal.createdAt,

        reason:
          "Improvement proposal saved as pending. Existing knowledge was not changed. Admin approval is required before applying it."
      });

    } catch (error) {
      return JSON.stringify({
        success: false,
        proposal: false,
        saved: false,
        approvalRequired: false,
        reason:
          error.message ||
          "Knowledge improvement proposal failed."
      });
    }
  }
};
