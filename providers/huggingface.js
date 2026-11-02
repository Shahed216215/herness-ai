"use strict";

require("dotenv").config();

const { secureProviderRequest } =
  require("../services/security/secure-provider-request");

async function generate(prompt, options = {}) {
  if (!process.env.HF_TOKEN)
    throw new Error("HF_TOKEN is not configured.");

  const result = await secureProviderRequest(
    "https://router.huggingface.co/v1/chat/completions",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${process.env.HF_TOKEN}`
      },
      data: {
        model: options.model ||
          process.env.HF_MODEL ||
          "openai/gpt-oss-120b:fastest",
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

module.exports = { name: "huggingface", generate };
