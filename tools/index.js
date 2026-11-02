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

async function executeTool(name, args) {
  if (!tools[name]) {
    return `Tool "${name}" not found.`;
  }

  return await tools[name].execute(args);
}

module.exports = {
  tools,
  declarations,
  executeTool
};
