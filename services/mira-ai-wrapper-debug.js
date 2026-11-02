const provider = require("../providers");

const originalGenerate = provider.generate;

provider.generate = async function (prompt, options = {}) {
  console.log("DEBUG_PROVIDER:", provider.name);
  console.log("DEBUG_PROMPT_LENGTH:", String(prompt || "").length);
  console.log(
    "DEBUG_OPTION_KEYS:",
    Object.keys(options).join(",")
  );
  console.log(
    "DEBUG_MODEL:",
    options.model || "[DEFAULT]"
  );
  console.log(
    "DEBUG_SYSTEM_LENGTH:",
    typeof options.systemInstruction === "string"
      ? options.systemInstruction.length
      : 0
  );
  console.log(
    "DEBUG_MESSAGES_COUNT:",
    Array.isArray(options.messages)
      ? options.messages.length
      : 0
  );
  console.log(
    "DEBUG_TOOLS_COUNT:",
    Array.isArray(options.tools)
      ? options.tools.length
      : 0
  );

  return originalGenerate.call(this, prompt, options);
};

const { generate } = require("./ai");

(async () => {
  try {
    const result = await generate(
      "Reply with exactly: MIRA_WRAPPER_OK",
      [],
      [
        {
          role: "user",
          content: "Reply with exactly: MIRA_WRAPPER_OK"
        }
      ],
      {
        model: "openai/gpt-oss-120b",
        systemInstruction: "You are Mira. Reply briefly.",
        maxTokens: 50
      }
    );

    console.log("WRAPPER_DEBUG_SUCCESS");
    console.log(
      "TEXT:",
      JSON.stringify(result?.text || "")
    );

  } catch (error) {
    console.error(
      "WRAPPER_DEBUG_ERROR:",
      error?.message || String(error)
    );
    console.error(
      "STATUS:",
      error?.status ||
      error?.statusCode ||
      "unknown"
    );
  }
})();
