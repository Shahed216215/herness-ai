require("dotenv").config();

const { GoogleGenAI } = require("@google/genai");
const { secureSdkFetch } = require("../services/security/secure-sdk-fetch");
const {
  buildGeminiConversation,
  normalizeGeminiResponse
} = require("../services/mira-gemini-conversation-adapter");

const ai = new GoogleGenAI({
  apiKey: process.env.GEMINI_API_KEY,
  httpOptions: { timeout: 30000, fetch: secureSdkFetch }
});

async function generate(prompt, options = {}) {
  const conversation = buildGeminiConversation(
    options.messages,
    prompt,
    options.systemInstruction
  );

  const response = await ai.models.generateContent({
    model: options.model || "gemini-3.6-flash",
    contents: conversation.contents,
    config: {
      systemInstruction: conversation.systemInstruction,
      tools: options.tools?.length
        ? [{ functionDeclarations: options.tools }]
        : undefined
    }
  });

  return normalizeGeminiResponse(response);
}

module.exports = {
  name: "gemini",
  generate
};
