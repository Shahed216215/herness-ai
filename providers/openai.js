"use strict";

require("dotenv").config();

const OpenAI = require("openai");
const { secureSdkFetch } = require("../services/security/secure-sdk-fetch");
const { getCredential } = require("../services/provider-credential-resolver");

async function generate(prompt, options = {}) {
  const credential = getCredential("openai");

  if (!credential || typeof credential.key !== "string" || !credential.key) {
    throw new Error("OpenAI credential is not configured.");
  }

  const requestedModel =
    typeof options.model === "string" ? options.model.trim() : "";

  const managedOrEnvironmentModel =
    typeof credential.model === "string" ? credential.model.trim() : "";

  const environmentModel =
    typeof process.env.OPENAI_MODEL === "string"
      ? process.env.OPENAI_MODEL.trim()
      : "";

  const model =
    requestedModel || managedOrEnvironmentModel || environmentModel;

  if (!model) {
    throw new Error("OpenAI model is not configured.");
  }

  // Resolve credentials per invocation so managed-key changes are picked up.
  // Never log or return the credential.
  const client = new OpenAI({
    apiKey: credential.key,
    timeout: 30000,
    maxRetries: 2,
    fetch: secureSdkFetch
  });

  const response = await client.responses.create({
    model,
    instructions: options.systemInstruction,
    input: prompt
  });

  return {
    text: response.output_text
  };
}

module.exports = {
  name: "openai",
  generate
};
