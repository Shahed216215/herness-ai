"use strict";

require("dotenv").config();

const { secureProviderRequest } =
  require("../services/security/secure-provider-request");

async function generate(prompt, options = {}) {
  const apiKey = process.env.XAI_API_KEY;
  if (!apiKey) throw new Error("XAI_API_KEY is not configured.");

  const model = options.model || process.env.XAI_MODEL;
  if (!model) throw new Error("Grok model ID is required (set XAI_MODEL or provide options.model).");

  const messages = [];
  if (typeof options.systemInstruction === "string" &&
      options.systemInstruction.trim()) {
    messages.push({ role: "system", content: options.systemInstruction });
  }
  if (Array.isArray(options.messages)) {
    for (const message of options.messages) {
      if (message && ["system", "user", "assistant"].includes(message.role) &&
          typeof message.content === "string") {
        messages.push({ role: message.role, content: message.content });
      }
    }
  } else {
    messages.push({ role: "user", content: String(prompt ?? "") });
  }
  if (!messages.length) throw new Error("No valid messages provided to Grok.");

  const result = await secureProviderRequest(
    "https://api.x.ai/v1/chat/completions",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${apiKey}`
      },
      data: { model, messages }
    }
  );

  return {
    text: result.data.choices?.[0]?.message?.content || ""
  };
}

module.exports = { name: "xai", generate };
