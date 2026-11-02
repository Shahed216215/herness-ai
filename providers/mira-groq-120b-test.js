const provider = require("./groq");

(async () => {
  try {
    const result = await provider.generate(
      "Reply with exactly: MIRA_120B_OK",
      {
        model: "openai/gpt-oss-120b",
        systemInstruction: "You are Mira. Reply briefly.",
        messages: [
          {
            role: "user",
            content: "Reply with exactly: MIRA_120B_OK"
          }
        ],
        tools: [],
        maxTokens: 50
      }
    );

    console.log("GROQ_PROVIDER_120B_SUCCESS");
    console.log(
      "TEXT:",
      JSON.stringify(result?.text || "")
    );

  } catch (error) {
    console.error(
      "GROQ_PROVIDER_120B_ERROR:",
      error?.message || String(error)
    );
    console.error(
      "ERROR_NAME:",
      error?.name || "unknown"
    );
    console.error(
      "STATUS:",
      error?.status ||
      error?.statusCode ||
      "unknown"
    );
  }
})();
