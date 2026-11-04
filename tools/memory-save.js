const { addMemory } = require("../memory");
const { checkToolSafety } = require("../services/mira-tool-execution-policy");

module.exports = {
  name: "memory_save",

  declaration: {
    name: "memory_save",
    description:
      "Save an important user-provided fact or instruction to Mira's conversation memory when the user explicitly asks Mira to remember it.",
    parameters: {
      type: "object",
      properties: {
        content: {
          type: "string",
          description:
            "The exact information the user explicitly wants Mira to remember."
        }
      },
      required: ["content"]
    }
  },

  execute: async (args = {}) => {
    const safety = checkToolSafety("memory_save", args);
    if (!safety || safety.passed !== true) {
      return JSON.stringify({
        success: false,
        saved: false,
        status: "BLOCKED",
        code: "TOOL_POLICY_DENIED",
        reason: safety?.reason || "Tool execution policy could not be verified."
      });
    }

    const { content } = args;
    if (
      !content ||
      typeof content !== "string" ||
      !content.trim()
    ) {
      return JSON.stringify({
        success: false,
        saved: false,
        message: "Memory content is required."
      });
    }

    try {
      const memoryContent = content.trim();
      addMemory("user", memoryContent);

      return JSON.stringify({
        success: true,
        saved: true,
        message: "Memory saved successfully."
      });
    } catch (error) {
      return JSON.stringify({
        success: false,
        saved: false,
        message: error.message
      });
    }
  }
};
