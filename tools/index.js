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
    cursor: typeof args?.cursor === "string" ? args.cursor : undefined,
    env: context.env || process.env
  });
  if (!result || result.status !== "AUTHORIZED_AND_COMMITTED" ||
      result.standingAuthority !== true ||
      result.authorityConsumed !== false ||
      result.approvalRequiredPerRead !== false ||
      result.memoryWrites !== false ||
      result.localFallback !== false ||
      result.driveFallback !== false ||
      typeof result.projectId !== "string" || !result.projectId ||
      typeof result.authorityExpiresAt !== "string" ||
      !Number.isFinite(Date.parse(result.authorityExpiresAt)) ||
      !Number.isInteger(result.candidateScanCount) || result.candidateScanCount < 0 ||
      !Number.isInteger(result.candidateScanLimit) || result.candidateScanLimit < 1 ||
      !Number.isInteger(result.scannedPages) || result.scannedPages < 1 ||
      typeof result.candidateScanMayBeIncomplete !== "boolean" ||
      (result.nextCursor !== null && typeof result.nextCursor !== "string") ||
      !Array.isArray(result.results)) {
    const error = new Error("HFM Knowledge search did not return an authorized read-only result.");
    error.code = "HFM_KNOWLEDGE_TOOL_AUTHORIZED_READ_REQUIRED";
    throw error;
  }
  return JSON.stringify({
    success: true,
    source: "HFM_V02_STANDING_READ",
    count: result.count,
    results: result.results,
    candidateScanCount: result.candidateScanCount,
    candidateScanLimit: result.candidateScanLimit,
    scannedPages: result.scannedPages,
    candidateScanMayBeIncomplete: result.candidateScanMayBeIncomplete,
    nextCursor: result.nextCursor,
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

async function executeHfmMemorySave(kind, args, trustedContext, save = require("../services/mira-hfm-memory-save-runtime").saveHfmMemoryRecord) {
  const context = trustedContext && trustedContext.hfmWrite;
  if (!context || !context.req || !context.writerPool || !context.issuerPool ||
      typeof context.writerPool.connect !== "function" ||
      typeof context.issuerPool.connect !== "function") {
    const error = new Error("Server-held HFM writer, issuer, and verified request context are required.");
    error.code = "HFM_MEMORY_WRITE_CONTEXT_REQUIRED";
    throw error;
  }
  const result = await save({
    ...context,
    kind,
    content: kind === "client_vault_save" || kind === "financial_vault_save"
      ? JSON.stringify(args?.payload)
      : (typeof args?.content === "string" ? args.content : ""),
    ...(kind === "knowledge_save" ? {
      title: args?.title,
      url: args?.url
    } : kind === "learning_save" ? {
      title: args?.sourceTitle,
      url: args?.sourceUrl
    } : kind === "source_reference_save" ? {
      url: args?.url,
      sourceType: args?.sourceType
    } : {})
  });
  return JSON.stringify({
    ...result,
    source: "HFM_V02_CANONICAL",
    localFallback: false,
    driveFallback: false,
    message: result.recordType === "source_reference"
      ? "Source reference saved privately as NOT_FETCHED provenance metadata; source content was not fetched or verified and is not trusted search content."
      : result.recordType === "client_vault_record" || result.recordType === "financial_vault_record"
        ? "Restricted vault record saved using the encrypted canonical HFM envelope as SOURCE_RECORDED/PENDING_REVIEW; it is excluded from trusted retrieval."
        : result.lifecycle === "PENDING_REVIEW"
          ? "Knowledge or learning source saved privately as pending review; it is excluded from trusted retrieval until verified."
          : result.recordType === "daily_activity"
          ? (result.contentRedacted
            ? "Daily activity saved privately to canonical HFM Memory; obvious sensitive values were redacted."
            : "Daily activity saved privately to canonical HFM Memory from the exact user-authored summary.")
          : "Memory saved privately to the canonical HFM repository; eligible for trusted search when standing-read mode is enabled."
  });
}

async function executeTool(name, args, trustedContext = null) {
  const hfmReadOnlyMode =
    process.env.MIRA_HFM_STANDING_READ_AUTHORITY_ENABLED === "true" ||
    process.env.MIRA_HFM_WORK_LEARNING_ENABLED === "true" ||
    process.env.MIRA_HFM_MEMORY_READ_ENABLED === "true";
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
  if (hfmWriteMode && name === "memory_save") {
    return executeHfmMemorySave("memory_save", args, trustedContext);
  }
  if (hfmWriteMode && name === "knowledge_save") {
    return executeHfmMemorySave("knowledge_save", args, trustedContext);
  }
  if (hfmWriteMode && name === "learning_save") {
    return executeHfmMemorySave("learning_save", args, trustedContext);
  }
  if (hfmWriteMode && name === "daily_activity_save") {
    return executeHfmMemorySave("daily_activity_save", args, trustedContext);
  }
  if (hfmWriteMode && name === "source_reference_save") {
    return executeHfmMemorySave("source_reference_save", args, trustedContext);
  }
  if (hfmWriteMode && name === "client_vault_save") {
    return executeHfmMemorySave("client_vault_save", args, trustedContext);
  }
  if (hfmWriteMode && name === "financial_vault_save") {
    return executeHfmMemorySave("financial_vault_save", args, trustedContext);
  }
  if (hfmMemoryMode && /^(memory|knowledge|learning|daily_activity|source_reference|client_vault|financial_vault)_/.test(String(name || ""))) {
    const error = new Error("Legacy Memory, Knowledge, Learning, Daily Activity, Source Reference, Client Vault, and Financial Vault storage is disabled in HFM mode unless routed through the authorized canonical HFM writer; unsupported operations fail closed without local or Drive fallback.");
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
