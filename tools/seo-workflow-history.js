"use strict";

const MAX_LIMIT = 10;
const DEFAULT_LIMIT = 5;
const MAX_RESPONSE_BYTES = 700 * 1024;

function trustedAdmin(context) {
  return Boolean(
    context &&
    context.permissionGranted === true &&
    context.actor &&
    context.actor.role === "admin" &&
    typeof context.actor.username === "string" &&
    context.actor.username.trim()
  );
}

function createHistoryExecutor(dependencies = {}) {
  return async function execute(args = {}, trustedContext = {}) {
    if (!trustedAdmin(trustedContext)) {
      return JSON.stringify({
        success: false,
        status: "BLOCKED",
        reason: "TRUSTED_NAMED_ADMIN_PERMISSION_REQUIRED"
      });
    }

    if (!args || typeof args !== "object" || Array.isArray(args)) {
      return JSON.stringify({
        success: false,
        status: "INVALID_INPUT",
        reason: "SEO_WORKFLOW_HISTORY_ARGUMENTS_INVALID"
      });
    }

    if (Object.keys(args).some(key =>
      !["clientId", "limit"].includes(key)
    )) {
      return JSON.stringify({
        success: false,
        status: "INVALID_INPUT",
        reason: "SEO_WORKFLOW_HISTORY_FIELD_NOT_ALLOWED"
      });
    }

    const clientId =
      typeof args.clientId === "string"
        ? args.clientId.trim()
        : "";

    if (!clientId || clientId.length > 160) {
      return JSON.stringify({
        success: false,
        status: "INVALID_INPUT",
        reason: "SEO_WORKFLOW_HISTORY_CLIENT_ID_REQUIRED"
      });
    }

    const limit = args.limit === undefined
      ? DEFAULT_LIMIT
      : args.limit;

    if (
      !Number.isInteger(limit) ||
      limit < 1 ||
      limit > MAX_LIMIT
    ) {
      return JSON.stringify({
        success: false,
        status: "INVALID_INPUT",
        reason: "SEO_WORKFLOW_HISTORY_LIMIT_INVALID",
        maximum: MAX_LIMIT
      });
    }

    try {
      const listRecords = dependencies.listWorkflowRecords ||
        require("../services/mira-seo-workflow-store").listWorkflowRecords;

      const allRecords = listRecords(clientId);

      if (!Array.isArray(allRecords)) {
        throw new Error("SEO_WORKFLOW_HISTORY_STORE_INVALID");
      }

      const matching = allRecords
        .filter(record =>
          record &&
          record.clientId === clientId &&
          typeof record.id === "string"
        )
        .sort((a, b) =>
          String(b.createdAt || "").localeCompare(
            String(a.createdAt || "")
          )
        );

      const selected = [];
      let responseBytes = 0;
      let truncatedBySize = false;

      for (const record of matching) {
        if (selected.length >= limit) break;

        const brief = record.brief &&
          typeof record.brief === "object"
          ? { ...record.brief }
          : {};

        delete brief.clientAuthorization;

        const safeRecord = {
          id: record.id,
          createdAt: record.createdAt,
          clientId: record.clientId,
          brief,
          query: record.query,
          audit: record.audit,
          research: record.research,
          personas: Array.isArray(record.personas) ? record.personas : [],
          contentCalendar: Array.isArray(record.contentCalendar)
            ? record.contentCalendar
            : [],
          assetGeneration: record.assetGeneration || null,
          qualityReview: record.qualityReview || null,
          reviewVersion: Number.isInteger(record.reviewVersion) ? record.reviewVersion : 0,
          reviewHistory: Array.isArray(record.reviewHistory) ? record.reviewHistory : [],
          checkpoint: record.checkpoint
        };

        const size = Buffer.byteLength(
          JSON.stringify(safeRecord),
          "utf8"
        );

        if (responseBytes + size > MAX_RESPONSE_BYTES) {
          truncatedBySize = true;
          break;
        }

        selected.push(safeRecord);
        responseBytes += size;
      }

      return JSON.stringify({
        success: true,
        status: "SEO_WORKFLOW_HISTORY_RETRIEVED",
        clientId,
        recordCount: selected.length,
        totalMatchingRecords: matching.length,
        limit,
        truncatedByResponseSize: truncatedBySize,
        records: selected,
        readOnly: true,
        researchStarted: false,
        externalActions: false
      });
    } catch (error) {
      return JSON.stringify({
        success: false,
        status: "INCONCLUSIVE",
        reason: "SEO_WORKFLOW_HISTORY_STORE_READ_FAILED",
        message: error.message
      });
    }
  };
}

module.exports = {
  name: "seo_workflow_history",
  declaration: {
    name: "seo_workflow_history",
    description:
      "Retrieve previously saved SEO workflow research and audit results " +
      "for one exact client ID. Named Admin browser session only. " +
      "Read-only; does not start research, change consent, or publish content.",
    parameters: {
      type: "object",
      properties: {
        clientId: {
          type: "string",
          description: "Exact saved client ID whose SEO history is requested."
        },
        limit: {
          type: "integer",
          description: "Maximum records to return, from 1 to 10. Defaults to 5."
        }
      },
      required: ["clientId"],
      additionalProperties: false
    }
  },
  execute: createHistoryExecutor(),
  createHistoryExecutor
};
