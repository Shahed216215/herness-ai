'use strict';

module.exports = {
  name: "daily_activity_save",

  declaration: {
    name: "daily_activity_save",
    description:
      "Save an exact user-authored daily activity summary to canonical HFM Memory only when the user explicitly asks to save or record daily activity. The full content must appear in the user's current message; do not invent or paraphrase completed work. Credential, client-contact, contract, and financial identifiers are not accepted by this tool. Obvious emails, phone numbers, URLs, currency amounts, and common credential patterns are redacted before storage; unknown sensitive formats may not be detected.",
    parameters: {
      type: "object",
      properties: {
        content: {
          type: "string",
          description:
            "The exact user-authored daily activity summary that the user explicitly asked Mira to save."
        }
      },
      required: ["content"]
    }
  },

  execute: async () => {
    const hfmEnabled =
      process.env.MIRA_HFM_MEMORY_WRITE_ENABLED === "true" ||
      process.env.MIRA_HFM_MEMORY_READ_ENABLED === "true" ||
      process.env.MIRA_HFM_STANDING_READ_AUTHORITY_ENABLED === "true" ||
      process.env.MIRA_HFM_WORK_LEARNING_ENABLED === "true";
    return JSON.stringify({
      success: false,
      saved: false,
      code: hfmEnabled
        ? "HFM_TOOL_ROUTER_REQUIRED"
        : "HFM_DAILY_ACTIVITY_CANONICAL_ONLY",
      localFallback: false,
      driveFallback: false
    });
  }
};
