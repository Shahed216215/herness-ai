require("dotenv").config();
const { secureProviderRequest } = require("../../services/security/secure-provider-request");

async function generate(prompt, options = {}) {
  if (!process.env.CUSTOM_PROVIDER2_URL) {
    throw new Error("CUSTOM_PROVIDER2_URL is not configured.");
  }


  const headers = {
    "Content-Type": "application/json"
  };

  if (process.env.CUSTOM_PROVIDER2_KEY) {
    headers["Authorization"] =
      `Bearer ${process.env.CUSTOM_PROVIDER2_KEY}`;
  }

  const result = await secureProviderRequest(
    process.env.CUSTOM_PROVIDER2_URL,
    {
      headers: {
        "Content-Type": "application/json",
        ...(process.env.CUSTOM_PROVIDER2_KEY
          ? { "Authorization": "Bearer " + process.env.CUSTOM_PROVIDER2_KEY }
          : {})
      },
      data: {
        model:
          options.model ||
          process.env.CUSTOM_PROVIDER2_MODEL ||
          "custom-model",
        prompt,
        systemInstruction:
          typeof options.systemInstruction === "string"
            ? options.systemInstruction
            : "",
        messages: [
          {
            role: "system",
            content:
              typeof options.systemInstruction === "string"
                ? options.systemInstruction
                : ""
          },
          {
            role: "user",
            content: String(prompt || "")
          }
        ]
      }
    },
    {
      allowPrivate:
        process.env.MIRA_ALLOW_PRIVATE_CUSTOM_PROVIDER_URLS === "true"
    }
  );

  const data = result.data;

  return {
    text:
      data.text ||
      data.response ||
      data.output ||
      data.choices?.[0]?.message?.content ||
      ""
  };
}

module.exports = {
  name: "custom-provider-2",
  generate
};
