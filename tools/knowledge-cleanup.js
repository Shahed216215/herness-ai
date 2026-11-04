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

  let driveResult = null;
  let driveError = null;

  try {
    driveResult = await saveKnowledgeToDrive(cleanedKnowledge);
  } catch (error) {
    driveError = error && error.message
      ? String(error.message).slice(0, 240)
      : "Provider sync failed.";
  }

  const driveSync = driveResult?.success === true;

  return {
    success: true,
    action: "remove",
    removed,
    remaining: cleanedKnowledge.length,
    localCommit: true,
    driveSync,
    driveStatus: driveSync ? "SYNCED" : "FAILED_OR_UNCONFIRMED",
    driveAction: driveResult?.action || (driveSync ? "synced" : "not_confirmed"),
    ...(driveError ? { driveError } : {}),
    message: driveSync
      ? `Removed ${removed} exact duplicate entr${removed === 1 ? "y" : "ies"} locally and synchronized the cleaned knowledge base to Google Drive.`
      : `Removed ${removed} exact duplicate entr${removed === 1 ? "y" : "ies"} locally. Google Drive synchronization was not confirmed; the local cleanup remains committed and requires provider reconciliation.`
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
