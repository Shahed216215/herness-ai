const { addKnowledge } = require("../knowledge");

module.exports = {
  name: "knowledge_save",

  declaration: {
    name: "knowledge_save",
    description:
      "Save useful information to Mira's knowledge memory. Duplicate entries are skipped safely.",
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

  execute: async ({
    title,
    url,
    content
  }) => {
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
