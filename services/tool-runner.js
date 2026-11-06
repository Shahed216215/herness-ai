const { executeTool } = require("../tools");

async function runTool(name, args, trustedContext = null) {
  return await executeTool(name, args, trustedContext);
}

module.exports = {
  runTool
};
