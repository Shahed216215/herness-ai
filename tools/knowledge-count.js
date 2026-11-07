const { assertLegacyStorageDisabled } = require("../services/mira-hfm-legacy-storage-guard");
const { getKnowledge } = require("../knowledge");

module.exports = {
  name: "knowledge_count",

  declaration: {
    name: "knowledge_count",
    description: "Return the exact number of entries currently stored in Mira's local knowledge base.",
    parameters: {
      type: "object",
      properties: {}
    }
  },

  execute: async () => {
    assertLegacyStorageDisabled();
    const knowledge = getKnowledge();

    return JSON.stringify({
      count: knowledge.length,
      source: "knowledge.json"
    });
  }
};
