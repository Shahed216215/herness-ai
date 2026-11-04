const { getKnowledge, replaceKnowledge } = require("../knowledge");
const { saveKnowledgeToDrive } = require("../google-drive");
const { findDuplicateGroups, removeExactDuplicateCopies } = require("../services/mira-knowledge-duplicate-assessment");

async function inspectKnowledge() {
  const knowledge = getKnowledge();

  const duplicateGroups =
    findDuplicateGroups(knowledge);

  const duplicateEntries =
    duplicateGroups.reduce(
      (total, group) => total + group.length - 1,
      0
    );

  return {
    success: true,
    action: "inspect",
    totalEntries: knowledge.length,
    duplicateGroups: duplicateGroups.length,
    duplicateEntries,
    dataModified: false,
    groups: duplicateGroups.map((group, index) => ({
      group: index + 1,
      copies: group.length,
      title: group[0].title || "",
      url: group[0].url || ""
    }))
  };
}

async function removeDuplicates() {
  const knowledge = getKnowledge();

  const cleanedKnowledge =
    removeExactDuplicateCopies(knowledge);

  const removed =
    knowledge.length - cleanedKnowledge.length;

  if (removed === 0) {
    return {
      success: true,
      action: "remove",
      removed: 0,
      remaining: knowledge.length,
      driveSync: false,
      message: "No exact duplicate entries found."
    };
  }

  replaceKnowledge(cleanedKnowledge);

  const driveResult =
    await saveKnowledgeToDrive(cleanedKnowledge);

  return {
    success: true,
    action: "remove",
    removed,
    remaining: cleanedKnowledge.length,
    driveSync: true,
    driveAction: driveResult.action || "synced",
    message:
      `Removed ${removed} exact duplicate ` +
      `entry and synchronized the cleaned knowledge base ` +
      `to Google Drive.`
  };
}

module.exports = {
  name: "knowledge_cleanup",

  declaration: {
    name: "knowledge_cleanup",
    description:
      "Inspect exact duplicate knowledge entries without modifying data, or remove exact duplicates when explicitly requested.",
    parameters: {
      type: "object",
      properties: {
        action: {
          type: "string",
          enum: ["inspect", "remove"],
          description:
            "Use inspect to check duplicates without changing data. Use remove only when the user explicitly requests duplicate removal."
        }
      },
      required: ["action"]
    }
  },

  execute: async ({ action }) => {
    if (action === "inspect") {
      const result = await inspectKnowledge();

      return JSON.stringify(
        result,
        null,
        2
      );
    }

    if (action === "remove") {
      const result = await removeDuplicates();

      return JSON.stringify(
        result,
        null,
        2
      );
    }

    return JSON.stringify({
      success: false,
      error:
        'Invalid action. Use "inspect" or "remove".'
    });
  }
};
