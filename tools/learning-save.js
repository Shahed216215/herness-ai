const { learnFromContent } = require("../services/learning");
const { checkToolSafety } = require("../services/mira-tool-execution-policy");

module.exports = {
  name: "learning_save",

  declaration: {
    name: "learning_save",
    description:
      "Currently blocked for autonomous execution. Persistent learning writes require an authenticated, action-scoped human-approval workflow, which is not yet available. Do not invoke as a substitute for approval.",
    parameters: {
      type: "object",
      properties: {
        sourceTitle: { type: "string" },
        sourceUrl: { type: "string" },
        content: { type: "string" }
      },
      required: ["content"]
    }
  },

  execute: async (args = {}) => {
    const safety = checkToolSafety("learning_save", args);
    if (!safety || safety.passed !== true) {
      return JSON.stringify({
        success: false,
        learned: false,
        saved: false,
        status: "BLOCKED",
        code: "TOOL_POLICY_DENIED",
        reason: safety?.reason || "Tool execution policy could not be verified."
      });
    }

    const { sourceTitle, sourceUrl, content } = args;
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
        reason: result?.reason || "Learning operation failed."
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
