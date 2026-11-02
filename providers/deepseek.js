"use strict";

require("dotenv").config();

const { secureProviderRequest } =
  require("../services/security/secure-provider-request");

async function generate(prompt, options = {}) {
  if (!process.env.DEEPSEEK_API_KEY)
    throw new Error("DEEPSEEK_API_KEY is not configured.");

  const result = await secureProviderRequest(
    "https://api.deepseek.com/chat/completions",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${process.env.DEEPSEEK_API_KEY}`
      },
      data: {
        model: options.model ||
          process.env.DEEPSEEK_MODEL ||
          "deepseek-chat",
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

module.exports = { name: "deepseek", generate };
