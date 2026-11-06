"use strict";

const express = require("express");
const {
  analyzeContentGaps,
  generateSeoReport
} = require("../services/mira-seo-content-gap-report");
const { analyzeSearchConsoleCsv } = require("../services/mira-seo-engine");
const rejectUnsupportedUploads = require("../services/security/reject-unsupported-uploads");

const ALLOWED_FIELDS = new Set([
  "targetKeywords",
  "ownDomain",
  "siteName",
  "siteUrl",
  "seoAudit",
  "competitorIntelligence",
  "searchConsoleCsv"
]);

function validateReportInput(body = {}) {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new TypeError("SEO_REPORT_BODY_OBJECT_REQUIRED");
  }
  for (const key of Object.keys(body)) {
    if (!ALLOWED_FIELDS.has(key)) {
      throw new TypeError("SEO_REPORT_FIELD_NOT_ALLOWED:" + key);
    }
  }
  if (body.targetKeywords !== undefined &&
      (!Array.isArray(body.targetKeywords) ||
       body.targetKeywords.length < 1 ||
       body.targetKeywords.length > 30 ||
       body.targetKeywords.some(value =>
         typeof value !== "string" || !value.trim() || value.length > 120
       ))) {
    throw new TypeError("SEO_REPORT_TARGET_KEYWORDS_INVALID");
  }
  if (body.ownDomain !== undefined &&
      (typeof body.ownDomain !== "string" || !body.ownDomain.trim() ||
       body.ownDomain.length > 253)) {
    throw new TypeError("SEO_REPORT_OWN_DOMAIN_INVALID");
  }
  if (body.siteName !== undefined &&
      (typeof body.siteName !== "string" || body.siteName.length > 120)) {
    throw new TypeError("SEO_REPORT_SITE_NAME_INVALID");
  }
  if (body.siteUrl !== undefined &&
      (typeof body.siteUrl !== "string" || body.siteUrl.length > 2048)) {
    throw new TypeError("SEO_REPORT_SITE_URL_INVALID");
  }
  if (body.searchConsoleCsv !== undefined &&
      (typeof body.searchConsoleCsv !== "string" ||
       body.searchConsoleCsv.length > 200000)) {
    throw new TypeError("SEO_REPORT_SEARCH_CONSOLE_CSV_INVALID");
  }
  for (const field of ["seoAudit", "competitorIntelligence"]) {
    if (body[field] !== undefined &&
        (!body[field] || typeof body[field] !== "object" ||
         Array.isArray(body[field]))) {
      throw new TypeError("SEO_REPORT_" + field.toUpperCase() + "_INVALID");
    }
  }
  if (body.targetKeywords &&
      (!body.ownDomain || !body.competitorIntelligence)) {
    throw new TypeError("SEO_REPORT_CONTENT_GAP_EVIDENCE_REQUIRED");
  }
  return body;
}

function createReport(body) {
  const input = validateReportInput(body);
  const searchPerformance = input.searchConsoleCsv
    ? { provided: true, ...analyzeSearchConsoleCsv(input.searchConsoleCsv) }
    : undefined;
  const contentGapAnalysis = input.targetKeywords
    ? analyzeContentGaps({
        targetKeywords: input.targetKeywords,
        ownDomain: input.ownDomain,
        competitorIntelligence: input.competitorIntelligence
      })
    : null;
  const report = generateSeoReport({
    siteName: input.siteName,
    siteUrl: input.siteUrl,
    generatedAt: new Date().toISOString(),
    seoAudit: input.seoAudit,
    competitorIntelligence: input.competitorIntelligence,
    contentGapAnalysis,
    searchPerformance
  });
  return { ...report, contentGapAnalysis };
}

function registerMiraSeoReportRoutes(app, requireAdminPermission, PERMISSIONS) {
  app.post(
    "/api/admin/mira-seo/report",
    requireAdminPermission(PERMISSIONS.SYSTEM_ADMIN),
    express.json({ limit: "250kb" }),
    (error, req, res, next) => {
      if (error instanceof SyntaxError && error.status === 400) {
        return res.status(400).json({
          success: false,
          status: "INVALID_INPUT",
          reason: "Malformed JSON request body."
        });
      }
      return next(error);
    },
    rejectUnsupportedUploads,
    (req, res) => {
      try {
        return res.json(createReport(req.body || {}));
      } catch (error) {
        const invalid = error instanceof TypeError ||
          error instanceof RangeError ||
          /^SEARCH_CONSOLE_CSV_/.test(error.message || "");
        return res.status(400).json({
          success: false,
          status: "INVALID_INPUT",
          reason: error.message || "SEO report generation failed."
        });
      }
    }
  );
}

registerMiraSeoReportRoutes.validateReportInput = validateReportInput;
registerMiraSeoReportRoutes.createReport = createReport;
module.exports = registerMiraSeoReportRoutes;
