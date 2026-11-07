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

async function executeHfmKnowledgeReviewQueue(args, trustedContext, review = require("../services/mira-hfm-knowledge-review-runtime").listPendingHfmKnowledgeForReview) {
  const context = trustedContext && trustedContext.hfmReadOnly;
  if (!context || !context.req || !context.pool ||
      typeof context.pool.connect !== "function" ||
      typeof context.getAuthorityIssuerRuntime !== "function") {
    const error = new Error("Server-held HFM reader, issuer resolver, and verified request context are required.");
    error.code = "HFM_KNOWLEDGE_REVIEW_HFM_CONTEXT_REQUIRED";
    throw error;
  }
  const issuer = await context.getAuthorityIssuerRuntime();
  if (!issuer || issuer.status !== "AUTHORITY_ISSUER_READY" ||
      !issuer.pool || typeof issuer.pool.connect !== "function") {
    const error = new Error("HFM authority issuer is not ready for a one-time pending-knowledge review.");
    error.code = "HFM_KNOWLEDGE_REVIEW_ISSUER_NOT_READY";
    throw error;
  }
  const result = await review({
    req: context.req,
    pool: context.pool,
    issuerPool: issuer.pool,
    env: context.env || process.env,
    userIntent: context.userIntent,
    limit: Number.isInteger(args?.limit) ? args.limit : 20
  });
  if (!result || result.status !== "REVIEW_REQUIRED" ||
      result.standingAuthority !== false || result.authorityConsumed !== true ||
      result.writeAllowed !== false || result.localFallback !== false ||
      result.driveFallback !== false || !Array.isArray(result.items)) {
    const error = new Error("Pending HFM Knowledge review did not return a verified one-time read.");
    error.code = "HFM_KNOWLEDGE_REVIEW_AUTHORIZED_READ_REQUIRED";
    throw error;
  }
  return JSON.stringify({
    success: true,
    source: "HFM_V02_PENDING_REVIEW",
    ...result,
    message: "These sources are unverified and are not trusted task context. Human review is required."
  });
}

async function executeHfmMemorySave(kind, args, trustedContext) {
  const context = trustedContext && trustedContext.hfmWrite;
  if (!context || !context.req || !context.writerPool || !context.issuerPool ||
      typeof context.writerPool.connect !== "function" ||
      typeof context.issuerPool.connect !== "function") {
    const error = new Error("Server-held HFM writer, issuer, and verified request context are required.");
    error.code = "HFM_MEMORY_WRITE_CONTEXT_REQUIRED";
    throw error;
  }
  const save = require("../services/mira-hfm-memory-save-runtime").saveHfmMemoryRecord;
  const result = await save({
    ...context,
    kind,
    content: typeof args?.content === "string" ? args.content : "",
    ...(kind === "knowledge_save" ? {
      title: args?.title,
      url: args?.url
    } : {})
  });
  return JSON.stringify({
    ...result,
    source: "HFM_V02_CANONICAL",
    localFallback: false,
    driveFallback: false,
    message: result.lifecycle === "PENDING_REVIEW"
      ? "Knowledge source saved privately as pending review; it is excluded from trusted search until verified."
      : "Memory saved privately to the canonical HFM repository; eligible for trusted search when standing-read mode is enabled."
  });
}

async function executeTool(name, args, trustedContext = null) {
  const hfmReadOnlyMode =
    process.env.MIRA_HFM_STANDING_READ_AUTHORITY_ENABLED === "true" ||
    process.env.MIRA_HFM_WORK_LEARNING_ENABLED === "true";
  const hfmWriteMode = process.env.MIRA_HFM_MEMORY_WRITE_ENABLED === "true";
  const hfmMemoryMode = hfmReadOnlyMode || hfmWriteMode;

  if (hfmMemoryMode && name === "knowledge_review_queue") {
    if (!hfmReadOnlyMode) {
      const error = new Error("HFM standing-read authority is required for Knowledge review.");
      error.code = "HFM_MEMORY_READ_MODE_REQUIRED";
      throw error;
    }
    return executeHfmKnowledgeReviewQueue(args, trustedContext);
  }
  if (hfmMemoryMode && name === "knowledge_search") {
    if (!hfmReadOnlyMode) {
      const error = new Error("HFM standing-read authority is required for Knowledge search.");
      error.code = "HFM_MEMORY_READ_MODE_REQUIRED";
      throw error;
    }
    return executeHfmKnowledgeSearch(args, trustedContext);
  }
  if (hfmReadOnlyMode && name === "knowledge_review_queue") {
    return executeHfmKnowledgeReviewQueue(args, trustedContext);
  }
  if (hfmWriteMode && name === "memory_save") {
    return executeHfmMemorySave("memory_save", args, trustedContext);
  }
  if (hfmWriteMode && name === "knowledge_save") {
    return executeHfmMemorySave("knowledge_save", args, trustedContext);
  }
  if (hfmMemoryMode && /^(memory|knowledge|learning)_/.test(String(name || ""))) {
    const error = new Error("Legacy Memory, Knowledge, and Learning storage is disabled in HFM mode; unsupported operations fail closed without local or Drive fallback.");
    error.code = "HFM_LEGACY_STORAGE_DISABLED";
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
  executeHfmKnowledgeSearch,
  executeHfmMemorySave,
  executeHfmKnowledgeReviewQueue
};
