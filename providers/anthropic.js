"use strict";

require("dotenv").config();

const { secureProviderRequest } =
  require("../services/security/secure-provider-request");

async function generate(prompt, options = {}) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY is not configured.");

  const model = options.model || process.env.ANTHROPIC_MODEL;
  if (!model) throw new Error("Claude model ID is required (set ANTHROPIC_MODEL or provide options.model).");

  const messages = Array.isArray(options.messages)
    ? options.messages.filter(m =>
        m && ["user", "assistant"].includes(m.role) &&
        typeof m.content === "string")
    : [{ role: "user", content: String(prompt ?? "") }];

  if (!messages.length) throw new Error("No valid messages provided to Claude.");

  const result = await secureProviderRequest(
    "https://api.anthropic.com/v1/messages",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01"
      },
      data: {
        model,
        max_tokens: 1024,
        system: typeof options.systemInstruction === "string"
          ? options.systemInstruction : undefined,
        messages
      }
    }
  );

  return {
    text: Array.isArray(result.data.content)
      ? result.data.content
          .filter(block => block && block.type === "text")
          .map(block => block.text || "").join("")
      : ""
  };
}

module.exports = { name: "anthropic", generate };
