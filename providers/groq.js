require("dotenv").config();

const Groq = require("groq-sdk");
const { secureSdkFetch } = require("../services/security/secure-sdk-fetch");

let client = null;

const REQUEST_TIMEOUT_MS = 30000;
const MAX_RETRIES = 3;

function getClient() {
  if (!client) {
    if (!process.env.GROQ_API_KEY) {
      throw new Error(
        "GROQ_API_KEY is not configured."
      );
    }

    client = new Groq({
      apiKey: process.env.GROQ_API_KEY,
      timeout: REQUEST_TIMEOUT_MS,
      fetch: secureSdkFetch
    });
  }

  return client;
}

function sleep(ms) {
  return new Promise(resolve =>
    setTimeout(resolve, ms)
  );
}

function buildMessages(options, prompt) {
  const messages = [];

  if (
    typeof options.systemInstruction ===
      "string" &&
    options.systemInstruction.trim()
  ) {
    messages.push({
      role: "system",
      content: options.systemInstruction
    });
  }

  if (Array.isArray(options.messages)) {
    for (const message of options.messages) {
      if (
        !message ||
        typeof message !== "object"
      ) {
        continue;
      }

      if (
        ![
          "system",
          "user",
          "assistant",
          "tool"
        ].includes(message.role)
      ) {
        continue;
      }

      const role = message.role;
      if (role === "tool") {
        if (typeof message.tool_call_id !== "string" ||
            !message.tool_call_id.trim() ||
            typeof message.content !== "string") continue;
        messages.push({
          role: "tool",
          tool_call_id: message.tool_call_id.slice(0, 128),
          content: message.content
        });
        continue;
      }

      if (role === "assistant") {
        const normalized = { role: "assistant" };
        if (typeof message.content === "string") normalized.content = message.content;
        else normalized.content = null;
        if (Array.isArray(message.tool_calls)) {
          normalized.tool_calls = message.tool_calls
            .filter(call => call && typeof call.id === "string" &&
              call.function && typeof call.function.name === "string")
            .map(call => ({
              id: call.id.slice(0, 128),
              type: "function",
              function: {
                name: call.function.name.slice(0, 128),
                arguments: typeof call.function.arguments === "string"
                  ? call.function.arguments : "{}"
              }
            }));
        }
        messages.push(normalized);
        continue;
      }

      if (typeof message.content === "string") {
        messages.push({ role, content: message.content });
      }
    }
  } else {
    messages.push({
      role: "user",
      content: String(prompt || "")
    });
  }

  return messages;
}

function buildTools(toolDeclarations) {
  if (
    !Array.isArray(toolDeclarations) ||
    toolDeclarations.length === 0
  ) {
    return undefined;
  }

  return toolDeclarations
    .filter(
      tool =>
        tool &&
        typeof tool.name === "string"
    )
    .map(tool => ({
      type: "function",
      function: {
        name: tool.name,
        description:
          tool.description || "",
        parameters: {
          ...(tool.parameters || {}),
          type: "object"
        }
      }
    }));
}

function getErrorStatus(error) {
  return (
    error?.status ||
    error?.statusCode ||
    error?.response?.status
  );
}

function isRetryableError(error) {
  const status = getErrorStatus(error);

  return (
    status === 408 ||
    status === 409 ||
    status === 429 ||
    status === 500 ||
    status === 502 ||
    status === 503 ||
    status === 504 ||
    error?.name === "AbortError" ||
    error?.code === "ETIMEDOUT" ||
    error?.code === "ECONNRESET"
  );
}

async function generate(prompt, options = {}) {
  const groq = getClient();

  const tools = buildTools(
    options.tools
  );

  const messages = buildMessages(
    options,
    prompt
  );

  if (messages.length === 0) {
    throw new Error(
      "No messages provided to AI provider."
    );
  }

  const maxRetries = MAX_RETRIES;

  for (
    let attempt = 0;
    attempt < maxRetries;
    attempt++
  ) {
    try {
      const completion =
        await groq.chat.completions.create({
          model:
            options.model ||
            process.env.GROQ_MODEL ||
            "openai/gpt-oss-20b",

          messages,

          tools,

          tool_choice:
            tools ? "auto" : "none",

          temperature: 0.2,

          max_tokens:
            Number(options.maxTokens) ||
            1200
        });

      const message =
        completion.choices?.[0]?.message;

      if (!message) {
        throw new Error(
          "Groq returned no message."
        );
      }

      const functionCalls =
        Array.isArray(
          message.tool_calls
        )
          ? message.tool_calls
              .map(call => {
                let args = {};

                try {
                  args = JSON.parse(
                    call.function
                      ?.arguments || "{}"
                  );
                } catch {
                  args = {};
                }

                return {
                  id: call.id,
                  name:
                    call.function?.name,
                  args
                };
              })
              .filter(
                call =>
                  typeof call.name ===
                  "string"
              )
          : [];

      return {
        text:
          typeof message.content ===
          "string"
            ? message.content
            : "",

        functionCalls,

        message
      };
    } catch (error) {
      const status =
        getErrorStatus(error);

      if (
        !isRetryableError(error) ||
        attempt === maxRetries - 1
      ) {
        throw error;
      }

      const waitTime = Math.min(
        2000 *
          Math.pow(2, attempt),
        10000
      );

      console.log(
        `Groq request temporarily unavailable (status ${
          status || "unknown"
        }). Retrying in ${
          waitTime / 1000
        }s...`
      );

      await sleep(waitTime);
    }
  }

  throw new Error(
    "Groq request failed after retries."
  );
}

module.exports = {
  name: "groq",
  generate,
  buildMessages
};
