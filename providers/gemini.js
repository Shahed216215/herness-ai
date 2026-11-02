require("dotenv").config();

const { GoogleGenAI } = require("@google/genai");
const { secureSdkFetch } = require("../services/security/secure-sdk-fetch");

const ai = new GoogleGenAI({
  apiKey: process.env.GEMINI_API_KEY,
  httpOptions: { timeout: 30000, fetch: secureSdkFetch }
});

async function generate(prompt, options = {}) {
  return await ai.models.generateContent({
    model: options.model || "gemini-3.6-flash",
    contents: prompt,
    config: {
      systemInstruction: options.systemInstruction,
      tools: options.tools?.length
        ? [{ functionDeclarations: options.tools }]
        : undefined
    }
  });
}

module.exports = {
  name: "gemini",
  generate
};
