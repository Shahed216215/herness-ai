const { addKnowledge } = require("../knowledge");
const { checkToolSafety } = require("../services/mira-tool-execution-policy");

module.exports = {
  name: "knowledge_save",

  declaration: {
    name: "knowledge_save",
    description:
      "Save useful information to Mira's knowledge memory. Duplicate entries are skipped safely.",
    parameters: {
      type: "object",
      properties: {
        title: { type: "string" },
        url: { type: "string" },
        content: { type: "string" }
      },
      required: ["title", "url", "content"]
    }
  },

  execute: async (args = {}) => {
    const safety = checkToolSafety("knowledge_save", args);
    if (!safety || safety.passed !== true) {
      return JSON.stringify({
        success: false,
        saved: false,
        status: "BLOCKED",
        code: "TOOL_POLICY_DENIED",
        reason: safety?.reason || "Tool execution policy could not be verified."
      });
    }

    const { title, url, content } = args;
    const result = await addKnowledge(title, url, content);

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
