const { addKnowledge } = require("../knowledge");

module.exports = {
  name: "knowledge_save",

  declaration: {
    name: "knowledge_save",
    description:
      "Save a user-requested knowledge source. In HFM mode it is stored privately as SOURCE_RECORDED/PENDING_REVIEW and is excluded from trusted search until verified; never use legacy local or Google Drive storage when HFM mode is active.",
    parameters: {
      type: "object",
      properties: {
        title: {
          type: "string"
        },
        url: {
          type: "string"
        },
        content: {
          type: "string"
        }
      },
      required: [
        "title",
        "url",
        "content"
      ]
    }
  },

  execute: async ({ title, url, content }) => {
    if (process.env.MIRA_HFM_STANDING_READ_AUTHORITY_ENABLED === "true" ||
        process.env.MIRA_HFM_WORK_LEARNING_ENABLED === "true" ||
        process.env.MIRA_HFM_MEMORY_WRITE_ENABLED === "true") {
      return JSON.stringify({
        success: false,
        saved: false,
        code: "HFM_TOOL_ROUTER_REQUIRED",
        localFallback: false,
        driveFallback: false
      });
    }
    assertLegacyStorageDisabled();
    const result = await addKnowledge(
      title,
      url,
      content
    );

    if (result.status === "duplicate_skipped") {
      if (result.drive) {
        return "This knowledge entry already exists. No duplicate was added. Google Drive is synchronized.";
      }

      return "This knowledge entry already exists. No duplicate was added.";
    }

    if (result.drive) {
      return "Knowledge saved successfully and synced to Google Drive.";
    }

    return "Knowledge saved locally, but Google Drive sync failed.";
  }
};
