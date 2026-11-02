const { executeTool } = require("../tools");

async function runTool(name, args) {
  return await executeTool(name, args);
}

module.exports = {
  runTool
};
