const { assertLegacyStorageDisabled } = require("../services/mira-hfm-legacy-storage-guard");
const {
  learnFromContent
} = require("../services/learning");

module.exports = {
  name: "learning_save",

  declaration: {
    name: "learning_save",
    description:
      "Save a user-requested learning source as a private HFM learning_note in PENDING_REVIEW. Use only when the user explicitly asks to save the learning to Mira's memory or knowledge base. The source is not trusted task context until human review; legacy automatic learning is not run in HFM mode.",

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

      required: [
        "content"
      ]
    }
  },

  execute: async ({
    sourceTitle,
    sourceUrl,
    content
  }) => {
    if (process.env.MIRA_HFM_STANDING_READ_AUTHORITY_ENABLED === "true" ||
        process.env.MIRA_HFM_WORK_LEARNING_ENABLED === "true" ||
        process.env.MIRA_HFM_MEMORY_WRITE_ENABLED === "true") {
      return JSON.stringify({
        success: false,
        learned: false,
        saved: false,
        code: "HFM_TOOL_ROUTER_REQUIRED",
        localFallback: false,
        driveFallback: false
      });
    }
    assertLegacyStorageDisabled();
    const result = await learnFromContent({
      content,
      sourceTitle,
      sourceUrl
    });

    if (!result || result.success !== true) {
      return JSON.stringify({
        success: false,
        learned: false,
        saved: false,
        reason:
          result?.reason ||
          "Learning operation failed."
      });
    }

    return JSON.stringify({
      success: true,
      learned: result.learned === true,
      saved: result.saved === true,
      duplicate: result.duplicate === true,
      drive: result.drive === true,
      title: result.title || null,
      topic: result.topic || null,
      track: result.track || null,
      difficulty: result.difficulty || null,
      reason: result.reason || null
    });
  }
};
