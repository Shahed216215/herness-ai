const fs = require("fs");
const path = require("path");

function loadTools() {
  const toolFiles = fs
    .readdirSync(__dirname)
    .filter(
      file =>
        file.endsWith(".js") &&
        file !== "index.js"
    );

  const tools = [];

  for (const file of toolFiles) {
    try {
      const tool = require(path.join(__dirname, file));

      if (
        tool &&
        tool.name &&
        tool.declaration &&
        typeof tool.execute === "function"
      ) {
        tools.push({
          name: tool.name,
          loaded: true
        });
      }
    } catch (error) {
      tools.push({
        name: file,
        loaded: false,
        error: error.message
      });
    }
  }

  return tools;
}

module.exports = {
  name: "tool_health",

  declaration: {
    name: "tool_health",
    description:
      "Check Mira's available tools and report which tools are loaded.",
    parameters: {
      type: "object",
      properties: {}
    }
  },

  execute: async () => {
    const tools = loadTools();

    const loadedTools = tools.filter(
      tool => tool.loaded
    );

    const failedTools = tools.filter(
      tool => !tool.loaded
    );

    return JSON.stringify(
      {
        success: failedTools.length === 0,
        toolCount: loadedTools.length,
        loadedTools,
        failedTools
      },
      null,
      2
    );
  }
};
