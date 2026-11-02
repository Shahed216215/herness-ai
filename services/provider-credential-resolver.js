"use strict";

const providerCredentialStore = require("./provider-credential-store");

const ENV_KEYS = Object.freeze({
  openai: {
    key: "OPENAI_API_KEY",
    model: "OPENAI_MODEL"
  }
});

function createCredentialResolver(options = {}) {
  const store = options.store || providerCredentialStore;
  const env = options.env || process.env;

  function getCredential(provider) {
    const names = ENV_KEYS[provider];

    if (!names) {
      throw new Error("Unsupported credential provider.");
    }

    // A store decryption/configuration error must fail closed.
    const managed = store.reveal(provider);

    if (managed !== null && managed !== undefined) {
      if (typeof managed.key !== "string" || !managed.key) {
        throw new Error("Managed provider credential is invalid.");
      }

      return {
        key: managed.key,
        model: typeof managed.model === "string" ? managed.model : ""
      };
    }

    const key = env[names.key];

    if (typeof key !== "string" || !key) {
      return null;
    }

    return {
      key,
      model: typeof env[names.model] === "string"
        ? env[names.model]
        : ""
    };
  }

  return Object.freeze({ getCredential });
}

const resolver = createCredentialResolver();

module.exports = Object.freeze({
  getCredential: resolver.getCredential,
  createCredentialResolver
});
