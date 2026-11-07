const fs = require("fs");
const path = require("path");

const toolFiles = fs
  .readdirSync(__dirname)
  .filter(file => file.endsWith(".js") && file !== "index.js");

const tools = {};

for (const file of toolFiles) {
  const tool = require(path.join(__dirname, file));

  if (tool.name && tool.declaration && tool.execute) {
    tools[tool.name] = tool;
  }
}

const declarations = Object.values(tools).map(tool => tool.declaration);

async function executeTool(name, args, trustedContext = null) {
  const hfmReadOnlyMode =
    process.env.MIRA_HFM_STANDING_READ_AUTHORITY_ENABLED === "true" ||
    process.env.MIRA_HFM_WORK_LEARNING_ENABLED === "true";
  if (hfmReadOnlyMode && /^(memory|knowledge|learning)_/.test(String(name || ""))) {
    const error = new Error("HFM standing authority grants memory.read only; legacy Memory, Knowledge, and Learning tools are unavailable.");
    error.code = "HFM_READ_ONLY_AUTHORITY_BLOCKS_LEGACY_MEMORY_KNOWLEDGE_TOOL";
    throw error;
  }
  if (!tools[name]) {
    return `Tool "${name}" not found.`;
  }

  return await tools[name].execute(args, trustedContext);
}

module.exports = {
  tools,
  declarations,
  executeTool
};
