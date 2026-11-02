"use strict";

const ALLOWED_COUNTRIES = new Set([
  "US", "GB", "CA", "AU",
  "DE", "FR", "NL", "IE", "ES", "IT",
  "SE", "NO", "DK", "FI", "BE", "AT",
  "CH", "PT", "PL", "BD"
]);

const ALLOWED_LANGUAGES = new Set([
  "en-US", "en-GB", "en-CA", "en-AU", "en", "bn-BD"
]);

const MAX = Object.freeze({
  clientName: 160,
  industry: 120,
  websiteUrl: 2048,
  keywords: 30,
  keywordLength: 120,
  goals: 10,
  goalLength: 300,
  scopes: 10
});

function cleanString(value, field, maxLength, required = false) {
  if (typeof value !== "string") {
    if (required) throw new TypeError(`${field}_REQUIRED`);
    return "";
  }

  const clean = value.trim();

  if (required && !clean) {
    throw new TypeError(`${field}_REQUIRED`);
  }

  if (clean.length > maxLength) {
    throw new RangeError(`${field}_TOO_LONG`);
  }

  return clean;
}

function validateWebsiteUrl(value) {
  const clean = cleanString(
    value,
    "WEBSITE_URL",
    MAX.websiteUrl,
    true
  );

  let parsed;

  try {
    parsed = new URL(clean);
  } catch {
    throw new TypeError("WEBSITE_URL_INVALID");
  }

  if (
    !["http:", "https:"].includes(parsed.protocol) ||
    parsed.username ||
    parsed.password
  ) {
    throw new TypeError("WEBSITE_URL_INVALID");
  }

  return parsed.toString();
}

function validateMarketingBrief(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new TypeError("MARKETING_BRIEF_OBJECT_REQUIRED");
  }

  const allowed = new Set([
    "clientId",
    "clientName",
    "websiteUrl",
    "industry",
    "businessType",
    "targetMarket",
    "targetLanguage",
    "primaryGoals",
    "keywords",
    "clientAuthorization"
  ]);

  for (const key of Object.keys(input)) {
    if (!allowed.has(key)) {
      throw new TypeError(`MARKETING_BRIEF_FIELD_NOT_ALLOWED:${key}`);
    }
  }

  const clientId = input.clientId === undefined
    ? ""
    : cleanString(input.clientId, "CLIENT_ID", 160);

  const clientName = cleanString(
    input.clientName,
    "CLIENT_NAME",
    MAX.clientName,
    true
  );

  const websiteUrl = validateWebsiteUrl(input.websiteUrl);

  const industry = cleanString(
    input.industry,
    "INDUSTRY",
    MAX.industry,
    true
  );

  const businessType = cleanString(
    input.businessType,
    "BUSINESS_TYPE",
    120
  );

  if (
    !input.targetMarket ||
    typeof input.targetMarket !== "object" ||
    Array.isArray(input.targetMarket)
  ) {
    throw new TypeError("TARGET_MARKET_REQUIRED");
  }

  const countryCode = cleanString(
    input.targetMarket.countryCode,
    "TARGET_COUNTRY_CODE",
    2,
    true
  ).toUpperCase();

  if (!/^[A-Z]{2}$/.test(countryCode) ||
      !ALLOWED_COUNTRIES.has(countryCode)) {
    throw new TypeError("TARGET_COUNTRY_NOT_SUPPORTED");
  }

  const countryName = cleanString(
    input.targetMarket.countryName,
    "TARGET_COUNTRY_NAME",
    100
  );

  const targetLanguage = cleanString(
    input.targetLanguage,
    "TARGET_LANGUAGE",
    20,
    true
  );

  if (!ALLOWED_LANGUAGES.has(targetLanguage)) {
    throw new TypeError("TARGET_LANGUAGE_NOT_SUPPORTED");
  }

  const primaryGoals = input.primaryGoals === undefined
    ? []
    : input.primaryGoals;

  if (!Array.isArray(primaryGoals) || primaryGoals.length > MAX.goals) {
    throw new TypeError("PRIMARY_GOALS_INVALID");
  }

  const cleanGoals = primaryGoals.map((goal, index) =>
    cleanString(goal, `PRIMARY_GOAL_${index}`, MAX.goalLength, true)
  );

  const keywords = input.keywords === undefined ? [] : input.keywords;

  if (!Array.isArray(keywords) || keywords.length > MAX.keywords) {
    throw new TypeError("KEYWORDS_INVALID");
  }

  const cleanKeywords = keywords.map((keyword, index) =>
    cleanString(
      keyword,
      `KEYWORD_${index}`,
      MAX.keywordLength,
      true
    )
  );

  if (
    !input.clientAuthorization ||
    typeof input.clientAuthorization !== "object" ||
    Array.isArray(input.clientAuthorization)
  ) {
    throw new TypeError("CLIENT_AUTHORIZATION_REQUIRED");
  }

  const authorization = input.clientAuthorization;
  const authKeys = Object.keys(authorization);

  if (authKeys.some(key =>
    !["status", "scopes"].includes(key)
  )) {
    throw new TypeError("CLIENT_AUTHORIZATION_FIELD_NOT_ALLOWED");
  }

  const status = authorization.status;

  if (!["authorized", "pending", "not_provided"].includes(status)) {
    throw new TypeError("CLIENT_AUTHORIZATION_STATUS_INVALID");
  }

  const scopes = authorization.scopes;

  if (!Array.isArray(scopes) || scopes.length > MAX.scopes) {
    throw new TypeError("CLIENT_AUTHORIZATION_SCOPES_INVALID");
  }

  const cleanScopes = scopes.map((scope, index) =>
    cleanString(scope, `AUTHORIZATION_SCOPE_${index}`, 80, true)
  );

  return Object.freeze({
    clientId,
    clientName,
    websiteUrl,
    industry,
    businessType,
    targetMarket: Object.freeze({
      countryCode,
      countryName
    }),
    targetLanguage,
    primaryGoals: Object.freeze(cleanGoals),
    keywords: Object.freeze(cleanKeywords),
    clientAuthorization: Object.freeze({
      status,
      scopes: Object.freeze(cleanScopes)
    })
  });
}

function assertSeoAuditAuthorized(brief) {
  const validated = validateMarketingBrief(brief);
  const auth = validated.clientAuthorization;

  if (
    auth.status !== "authorized" ||
    !auth.scopes.includes("seo_audit")
  ) {
    throw new Error("CLIENT_SEO_AUDIT_AUTHORIZATION_REQUIRED");
  }

  return validated;
}

module.exports = {
  ALLOWED_COUNTRIES,
  ALLOWED_LANGUAGES,
  validateMarketingBrief,
  assertSeoAuditAuthorized
};
