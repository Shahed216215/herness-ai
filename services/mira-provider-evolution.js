"use strict";

const SUPPORTED_PROVIDERS = new Set([
  "openai",
  "anthropic",
  "gemini",
  "xai",
  "groq",
  "deepseek",
  "openrouter",
  "huggingface",
  "custom"
]);

const SECRET_KEY_PATTERN =
  /token|secret|password|api.?key|authorization|credential|private.?key/i;

const SECRET_VALUE_PATTERNS = [
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
  /\bsk-[A-Za-z0-9_-]{20,}\b/,
  /\bAIza[A-Za-z0-9_-]{20,}\b/,
  /\bghp_[A-Za-z0-9]{20,}\b/,
  /\bgithub_pat_[A-Za-z0-9_]{20,}\b/,
  /\bxox[baprs]-[A-Za-z0-9-]{20,}\b/
];

const SAFE_MODEL_PATTERN =
  /^[A-Za-z0-9._:/@+-]{1,200}$/;

const PROVIDER_MODULES = {
  openai: "../providers/openai",
  anthropic: "../providers/anthropic",
  gemini: "../providers/gemini",
  xai: "../providers/xai",
  groq: "../providers/groq",
  deepseek: "../providers/deepseek",
  openrouter: "../providers/openrouter",
  huggingface: "../providers/huggingface"
};

function normalizeProvider(value) {
  return String(value || "")
    .trim()
    .toLowerCase();
}

function normalizeModel(value) {
  return String(value || "")
    .trim()
    .slice(0, 200);
}

function containsSecretValue(value) {
  if (typeof value !== "string") {
    return false;
  }

  return SECRET_VALUE_PATTERNS.some(pattern =>
    pattern.test(value)
  );
}

function containsSecretKey(key) {
  return SECRET_KEY_PATTERN.test(String(key || ""));
}

function validateProviderName(provider) {
  const normalized = normalizeProvider(provider);

  if (!normalized) {
    return {
      ok: false,
      status: "provider_required"
    };
  }

  if (!SUPPORTED_PROVIDERS.has(normalized)) {
    return {
      ok: false,
      status: "unsupported_provider",
      provider: normalized
    };
  }

  return {
    ok: true,
    status: "provider_valid",
    provider: normalized
  };
}

function validateModel(model) {
  const normalized = normalizeModel(model);

  if (!normalized) {
    return {
      ok: true,
      status: "model_default"
    };
  }

  if (!SAFE_MODEL_PATTERN.test(normalized)) {
    return {
      ok: false,
      status: "invalid_model"
    };
  }

  return {
    ok: true,
    status: "model_valid",
    model: normalized
  };
}

function scanSecretSafety(value, path = "root") {
  if (value === null || value === undefined) {
    return {
      ok: true,
      status: "secret_safety_passed"
    };
  }

  if (typeof value === "string") {
    if (containsSecretValue(value)) {
      return {
        ok: false,
        status: "credential_pattern_detected",
        field: path
      };
    }

    return {
      ok: true,
      status: "secret_safety_passed"
    };
  }

  if (Array.isArray(value)) {
    for (let index = 0; index < value.length; index += 1) {
      const result = scanSecretSafety(
        value[index],
        `${path}[${index}]`
      );

      if (!result.ok) {
        return result;
      }
    }

    return {
      ok: true,
      status: "secret_safety_passed"
    };
  }

  if (typeof value === "object") {
    for (const [key, child] of Object.entries(value)) {
      const childPath = `${path}.${key}`;

      if (containsSecretKey(key)) {
        return {
          ok: false,
          status: "credential_field_detected",
          field: childPath
        };
      }

      const result = scanSecretSafety(
        child,
        childPath
      );

      if (!result.ok) {
        return result;
      }
    }
  }

  return {
    ok: true,
    status: "secret_safety_passed"
  };
}

function validateProviderConfiguration(config = {}) {
  const providerResult = validateProviderName(config.provider);
  if (!providerResult.ok) return providerResult;

  const modelResult = validateModel(config.model);
  if (!modelResult.ok) return modelResult;

  const metadataSafety = scanSecretSafety(config.metadata || {});
  if (!metadataSafety.ok) {
    return {
      ok: false,
      status: "secret_safety_blocked",
      field: metadataSafety.field
    };
  }

  const result = {
    ok: true,
    status: "provider_configuration_valid",
    provider: providerResult.provider,
    model: modelResult.model || ""
  };

  if (config.fallbackEnabled === true) {
    const fallbackProviderResult =
      validateProviderName(config.fallbackProvider);
    if (!fallbackProviderResult.ok) {
      return { ok: false, status: "fallback_provider_invalid" };
    }

    if (fallbackProviderResult.provider === providerResult.provider) {
      return { ok: false, status: "fallback_provider_must_differ" };
    }

    const fallbackModelResult = validateModel(config.fallbackModel);
    if (!fallbackModelResult.ok || !fallbackModelResult.model) {
      return { ok: false, status: "fallback_model_required" };
    }

    result.fallbackEnabled = true;
    result.fallbackProvider = fallbackProviderResult.provider;
    result.fallbackModel = fallbackModelResult.model;
  }

  return result;
}

function sanitizeHealthError(error) {
  let message = String(
    error?.message ||
    error ||
    "Provider health check failed"
  );

  for (const pattern of SECRET_VALUE_PATTERNS) {
    message = message.replace(
      pattern,
      "[REDACTED]"
    );
  }

  message = message
    .replace(
      /Bearer\s+[A-Za-z0-9._~+/=-]+/gi,
      "Bearer [REDACTED]"
    )
    .replace(
      /([?&]([\w.-]*(?:api.?key|access.?token|refresh.?token|token|secret|password|credential|authorization|auth)[\w.-]*)=)([^&#\s]*)/gi,
      "$1[REDACTED]"
    )
    .replace(
      /(\b(?:api.?key|access.?token|refresh.?token|custom.?token|token|secret|password|credential|authorization|auth)\b\s*[:=]\s*)(?:"[^"]*"|'[^']*'|[^\s&,;]+)/gi,
      "$1[REDACTED]"
    )
    .slice(0, 500);

  return message;
}

function loadProvider(provider) {
  if (provider === "custom") {
    const custom = require("../providers/custom");

    const customProviderName =
      process.env.CUSTOM_PROVIDER || "provider1";

    const customProvider =
      custom.getProvider(customProviderName);

    return {
      name: `custom-${customProviderName}`,
      generate: async function (prompt, options = {}) {
        return await customProvider.generate(
          prompt,
          options
        );
      }
    };
  }

  const modulePath =
    PROVIDER_MODULES[provider];

  if (!modulePath) {
    throw new Error(
      `No provider module configured for ${provider}`
    );
  }

  return require(modulePath);
}

async function testProviderHealth(
  config,
  options = {}
) {
  const validation =
    validateProviderConfiguration(config);

  if (!validation.ok) {
    return {
      ok: false,
      status: validation.status,
      provider: validation.provider || "",
      model: validation.model || ""
    };
  }

  const provider =
    validation.provider;

  const model =
    validation.model || undefined;

  const prompt =
    typeof options.prompt === "string" &&
    options.prompt.trim()
      ? options.prompt.trim().slice(0, 500)
      : "Mira provider health check. Reply with OK.";

  try {
    const providerModule =
      loadProvider(provider);

    if (
      !providerModule ||
      typeof providerModule.generate !== "function"
    ) {
      return {
        ok: false,
        status: "provider_generate_unavailable",
        provider,
        model: model || ""
      };
    }

    const response =
      await providerModule.generate(
        prompt,
        model
          ? { model }
          : {}
      );

    return {
      ok: true,
      status: "provider_health_passed",
      provider,
      model: model || "",
      responseReceived:
        response !== undefined &&
        response !== null
    };
  } catch (error) {
    return {
      ok: false,
      status: "provider_health_failed",
      provider,
      model: model || "",
      responseReceived: false,
      error: sanitizeHealthError(error)
    };
  }
}

function buildSafeAuditDetails(config = {}) {
  const validation =
    validateProviderConfiguration(config);

  return {
    provider:
      validation.provider || "",
    model:
      validation.model || "",
    configurationStatus:
      validation.status,
    secretSafety:
      validation.ok
        ? "passed"
        : "blocked"
  };
}

module.exports = {
  SUPPORTED_PROVIDERS,
  normalizeProvider,
  normalizeModel,
  containsSecretValue,
  containsSecretKey,
  validateProviderName,
  validateModel,
  scanSecretSafety,
  validateProviderConfiguration,
  sanitizeHealthError,
  testProviderHealth,
  buildSafeAuditDetails
};
