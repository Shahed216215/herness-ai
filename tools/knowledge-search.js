const { getKnowledge } = require("../knowledge");
const { loadKnowledgeFromDrive } = require("../google-drive");

function normalize(text) {
  return String(text || "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

function isSameEntry(a, b) {
  return (
    normalize(a.title) === normalize(b.title) &&
    normalize(a.url) === normalize(b.url) &&
    normalize(a.content) === normalize(b.content)
  );
}

module.exports = {
  name: "knowledge_search",

  declaration: {
    name: "knowledge_search",
    description:
      "Search saved knowledge with relevance ranking and duplicate result filtering.",
    parameters: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "The topic, title, URL, or phrase to search for"
        }
      },
      required: ["query"]
    }
  },

  execute: async ({ query }) => {
    const searchQuery = normalize(query);

    if (!searchQuery) {
      return "Please provide a search query.";
    }

    let knowledge = getKnowledge();

    try {
      const driveKnowledge = await loadKnowledgeFromDrive();

      if (Array.isArray(driveKnowledge)) {
        knowledge = driveKnowledge;
      }
    } catch (error) {
      console.log("DRIVE_ERROR:", error.message);
    }

    if (!Array.isArray(knowledge) || knowledge.length === 0) {
      return "No knowledge entries are currently stored.";
    }

    const words = searchQuery
      .split(/\s+/)
      .filter(word => word.length > 1);

    const seen = [];
    const results = [];

    for (let index = knowledge.length - 1; index >= 0; index--) {
      const item = knowledge[index];

      if (seen.some(existing => isSameEntry(existing, item))) {
        continue;
      }

      const title = normalize(item.title);
      const url = normalize(item.url);
      const content = normalize(item.content);

      let score = 0;
      let matchedWords = 0;

      for (const word of words) {
        let matched = false;

        if (title.includes(word)) {
          score += 5;
          matched = true;
        }

        if (url.includes(word)) {
          score += 3;
          matched = true;
        }

        if (content.includes(word)) {
          score += 1;
          matched = true;
        }

        if (matched) {
          matchedWords++;
        }
      }

      if (title === searchQuery) {
        score += 20;
      }

      if (url === searchQuery) {
        score += 20;
      }

      if (title.includes(searchQuery)) {
        score += 10;
      }

      if (score > 0) {
        results.push({
          item,
          score,
          matchedWords
        });

        seen.push(item);
      }
    }

    results.sort((a, b) => {
      if (b.score !== a.score) {
        return b.score - a.score;
      }

      return (
        new Date(b.item.savedAt || 0) -
        new Date(a.item.savedAt || 0)
      );
    });

    const finalResults = results.slice(0, 5);

    if (finalResults.length === 0) {
      return "No matching knowledge found.";
    }

    return JSON.stringify(
      finalResults.map(result => ({
        title: result.item.title || "",
        url: result.item.url || "",
        content: result.item.content || "",
        savedAt: result.item.savedAt || "",
        relevanceScore: result.score
      })),
      null,
      2
    );
  }
};
