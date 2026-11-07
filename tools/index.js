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

async function executeHfmKnowledgeSearch(args, trustedContext, search = require("../services/mira-hfm-knowledge-search-runtime").searchHfmKnowledge) {
  const context = trustedContext && trustedContext.hfmReadOnly;
  if (!context || !context.req || !context.pool ||
      typeof context.pool.connect !== "function") {
    const error = new Error("A server-held HFM request and Memory reader pool are required.");
    error.code = "HFM_KNOWLEDGE_TOOL_HFM_CONTEXT_REQUIRED";
    throw error;
  }
  const query = typeof args?.query === "string" ? args.query : "";
  const result = await search({
    req: context.req,
    pool: context.pool,
    query,
    limit: 5,
    env: context.env || process.env
  });
  if (!result || result.status !== "AUTHORIZED_AND_COMMITTED" ||
      result.standingAuthority !== true || result.localFallback !== false ||
      result.driveFallback !== false || !Array.isArray(result.results)) {
    const error = new Error("HFM Knowledge search did not return an authorized read-only result.");
    error.code = "HFM_KNOWLEDGE_TOOL_AUTHORIZED_READ_REQUIRED";
    throw error;
  }
  return JSON.stringify({
    success: true,
    source: "HFM_V02_STANDING_READ",
    count: result.count,
    results: result.results,
    localFallback: false,
    driveFallback: false
  });
}

async function executeTool(name, args, trustedContext = null) {
  const hfmReadOnlyMode =
    process.env.MIRA_HFM_STANDING_READ_AUTHORITY_ENABLED === "true" ||
    process.env.MIRA_HFM_WORK_LEARNING_ENABLED === "true";
  if (hfmReadOnlyMode && name === "knowledge_search") {
    return executeHfmKnowledgeSearch(args, trustedContext);
  }
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
  executeTool,
  executeHfmKnowledgeSearch
};
