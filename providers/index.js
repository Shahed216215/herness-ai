"use strict";

const crypto = require("crypto");
const { recordAudit } = require("../audit-log");

const fs = require("fs");
const path = require("path");

const RUNTIME_CONFIG_PATH = path.join(
  __dirname,
  "..",
  "provider-runtime-config.json"
);

const providerFiles = {
  openai: "./openai",
  anthropic: "./anthropic",
  gemini: "./gemini",
  xai: "./xai",
  groq: "./groq",
  deepseek: "./deepseek",
  openrouter: "./openrouter",
  huggingface: "./huggingface"
};

function getRuntimeConfig() {
  let config = {};
  if (fs.existsSync(RUNTIME_CONFIG_PATH)) {
    config = JSON.parse(fs.readFileSync(RUNTIME_CONFIG_PATH, "utf8"));
  }

  const result = {
    provider: String(config.provider || process.env.AI_PROVIDER || "gemini")
      .trim().toLowerCase(),
    model: String(config.model || "").trim()
  };

  if (
    config.fallbackEnabled === true &&
    String(config.fallbackProvider || "").trim() &&
    String(config.fallbackModel || "").trim() &&
    String(config.fallbackProvider).trim().toLowerCase() !== result.provider
  ) {
    result.fallbackEnabled = true;
    result.fallbackProvider = String(config.fallbackProvider).trim().toLowerCase();
    result.fallbackModel = String(config.fallbackModel).trim();
  }

  return result;
}

function isTransientProviderError(error) {
  const message = String(error?.message || "").toLowerCase();

  // Explicit deny-list wins even if an error also carries a retryable status.
  if (
    /invalid api.?key|unauthori[sz]ed|forbidden|authentication|credential|security.?policy|private ip|blocked url|certificate|tls|missing.{0,20}(api.?key|credential)|api.?key.{0,20}(missing|invalid)/i.test(message)
  ) {
    return false;
  }

  const messageStatus = String(error?.message || "").match(/\bHTTP\s+(\d{3})\b/i);
  const status = Number(
    error?.status ||
    error?.statusCode ||
    error?.response?.status ||
    (messageStatus ? messageStatus[1] : 0)
  );
  if ([408, 429, 500, 502, 503, 504].includes(status)) return true;

  const code = String(error?.code || "").toUpperCase();
  if (["ETIMEDOUT", "ECONNRESET"].includes(code)) return true;
  return error?.name === "AbortError";
}

async function generateWithConfig(providerName, model, prompt, options, overrideModel) {
  const provider = loadProvider(providerName);
  if (!provider || typeof provider.generate !== "function") {
    throw new Error(`Provider generate function unavailable: ${providerName}`);
  }

  const runtimeOptions = { ...options };
  if (overrideModel && model) {
    runtimeOptions.model = model;
  } else if (model && !runtimeOptions.model) {
    runtimeOptions.model = model;
  }

  return await provider.generate(prompt, runtimeOptions);
}

function loadProvider(providerName) {
  if (providerName === "custom") {
    const custom = require("./custom");

    const customProviderName =
      process.env.CUSTOM_PROVIDER || "provider1";

    const customProvider =
      custom.getProvider(customProviderName);

    if (
      !customProvider ||
      typeof customProvider.generate !== "function"
    ) {
      throw new Error(
        `Custom provider unavailable: ${customProviderName}`
      );
    }

    return {
      name: `custom-${customProviderName}`,
      generate: async function (
        prompt,
        options = {}
      ) {
        return await customProvider.generate(
          prompt,
          options
        );
      }
    };
  }

  const providerFile =
    providerFiles[providerName];

  if (!providerFile && providerName !== "gemini") {
    throw new Error(
      `Unknown AI provider: ${providerName}`
    );
  }

  return require(
    providerFile || "./gemini"
  );
}

function createProviderRequestId(value) {
  if (
    typeof value === "string" &&
    /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(value)
  ) {
    return value;
  }
  return crypto.randomUUID();
}

function getSafeProviderError(error) {
  const rawStatus =
    error?.status ||
    error?.statusCode ||
    error?.response?.status;

  const status = Number(rawStatus);
  const httpStatus =
    Number.isInteger(status) && status >= 100 && status <= 599
      ? status
      : null;

  const rawCode = String(error?.code || error?.name || "");
  const errorCode = /^[A-Za-z0-9_-]{1,40}$/.test(rawCode)
    ? rawCode
    : "PROVIDER_ERROR";

  return { errorCode, httpStatus };
}

function recordProviderAttempt({
  requestId,
  attempt,
  attemptType,
  provider,
  model,
  startedAt,
  status,
  fallbackUsed,
  error
}) {
  const durationMs = Math.max(0, Date.now() - startedAt);
  const details = {
    requestId,
    attempt,
    attemptType,
    provider: String(provider || "unknown").slice(0, 80),
    model: String(model || "").slice(0, 120),
    durationMs,
    fallbackUsed: fallbackUsed === true
  };

  if (error) {
    const safeError = getSafeProviderError(error);
    details.errorCode = safeError.errorCode;
    details.httpStatus = safeError.httpStatus;
    details.transient = isTransientProviderError(error);
  }

  try {
    recordAudit({
      actorRole: "system",
      action: "provider_execution_attempt",
      resource: "ai_provider",
      resourceId: requestId,
      status,
      details
    });
  } catch (_) {
    // Do not turn an audit-storage failure into a second provider request.
    console.error("PROVIDER_EXECUTION_AUDIT_WRITE_FAILED");
  }
}

async function generate(prompt, options = {}) {
  const config = getRuntimeConfig();
  const requestId = createProviderRequestId(options.requestId);

  // requestId is internal router metadata, not a provider SDK option.
  const providerOptions = { ...options };
  delete providerOptions.requestId;

  const primaryStartedAt = Date.now();

  try {
    const result = await generateWithConfig(
      config.provider, config.model, prompt, providerOptions, false
    );

    recordProviderAttempt({
      requestId,
      attempt: 1,
      attemptType: "primary",
      provider: config.provider,
      model: config.model,
      startedAt: primaryStartedAt,
      status: "success",
      fallbackUsed: false
    });

    return result;
  } catch (primaryError) {
    recordProviderAttempt({
      requestId,
      attempt: 1,
      attemptType: "primary",
      provider: config.provider,
      model: config.model,
      startedAt: primaryStartedAt,
      status: "failure",
      fallbackUsed: false,
      error: primaryError
    });

    if (
      config.fallbackEnabled !== true ||
      !config.fallbackProvider ||
      !config.fallbackModel ||
      config.fallbackProvider === config.provider ||
      !isTransientProviderError(primaryError)
    ) {
      throw primaryError;
    }

    // At most one fallback attempt; never recursively chain providers.
    const fallbackStartedAt = Date.now();

    try {
      const result = await generateWithConfig(
        config.fallbackProvider,
        config.fallbackModel,
        prompt,
        providerOptions,
        true
      );

      recordProviderAttempt({
        requestId,
        attempt: 2,
        attemptType: "fallback",
        provider: config.fallbackProvider,
        model: config.fallbackModel,
        startedAt: fallbackStartedAt,
        status: "success",
        fallbackUsed: true
      });

      return result;
    } catch (fallbackError) {
      recordProviderAttempt({
        requestId,
        attempt: 2,
        attemptType: "fallback",
        provider: config.fallbackProvider,
        model: config.fallbackModel,
        startedAt: fallbackStartedAt,
        status: "failure",
        fallbackUsed: true,
        error: fallbackError
      });

      throw fallbackError;
    }
  }
}

function getProviderStatus() {
  const config =
    getRuntimeConfig();

  return {
    provider: config.provider,
    model: config.model,
    fallbackEnabled: config.fallbackEnabled === true,
    ...(config.fallbackEnabled === true ? {
      fallbackProvider: config.fallbackProvider,
      fallbackModel: config.fallbackModel
    } : {})
  };
}

module.exports = {
  generate,
  getRuntimeConfig,
  getProviderStatus,
  isTransientProviderError
};
