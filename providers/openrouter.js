"use strict";

require("dotenv").config();

const { secureProviderRequest } =
  require("../services/security/secure-provider-request");

async function generate(prompt, options = {}) {
  if (!process.env.OPENROUTER_API_KEY)
    throw new Error("OPENROUTER_API_KEY is not configured.");

  const result = await secureProviderRequest(
    "https://openrouter.ai/api/v1/chat/completions",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${process.env.OPENROUTER_API_KEY}`
      },
      data: {
        model: options.model ||
          process.env.OPENROUTER_MODEL ||
          "openai/gpt-4o-mini",
        messages: [
          {
            role: "system",
            content: options.systemInstruction || ""
          },
          {
            role: "user",
            content: String(prompt ?? "")
          }
        ]
      }
    }
  );

  return {
    text: result.data.choices?.[0]?.message?.content || ""
  };
}

module.exports = { name: "openrouter", generate };
