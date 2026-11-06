"use strict";

let responseSequence = 0;

function parseObject(value) {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value;
  }

  if (typeof value !== "string" || !value.trim()) {
    return { result: value ?? null };
  }

  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed
      : { result: parsed };
  } catch {
    return { result: value };
  }
}

function normalizeFunctionCall(call, index = 0, idPrefix = "gemini-call") {
  const nested = call?.function || call?.functionCall || call || {};
  const name = String(call?.name || nested?.name || "").trim();
  if (!name) return null;

  let args = call?.args ?? nested?.args ?? nested?.arguments ?? {};
  if (typeof args === "string") {
    try {
      args = JSON.parse(args);
    } catch {
      args = {};
    }
  }

  if (!args || typeof args !== "object" || Array.isArray(args)) {
    args = {};
  }

  return {
    id: String(call?.id || `${idPrefix}-${index + 1}`),
    name,
    args
  };
}

function getAssistantCalls(message) {
  if (Array.isArray(message?.functionCalls)) {
    return message.functionCalls
      .map(normalizeFunctionCall)
      .filter(Boolean);
  }

  if (Array.isArray(message?.tool_calls)) {
    return message.tool_calls
      .map(normalizeFunctionCall)
      .filter(Boolean);
  }

  return [];
}

function buildGeminiConversation(messages, prompt, systemInstruction) {
  const contents = [];
  const systemParts = [];
  const pendingToolNames = new Map();

  if (typeof systemInstruction === "string" && systemInstruction.trim()) {
    systemParts.push(systemInstruction.trim());
  }

  const source = Array.isArray(messages) ? messages : [];

  for (const message of source) {
    if (!message || typeof message !== "object") continue;

    const role = String(message.role || "").toLowerCase();
    const content = typeof message.content === "string"
      ? message.content
      : "";

    if (role === "system") {
      if (content.trim()) systemParts.push(content.trim());
      continue;
    }

    if (role === "user") {
      if (content.trim()) {
        contents.push({ role: "user", parts: [{ text: content }] });
      }
      continue;
    }

    if (role === "assistant" || role === "model") {
      const calls = getAssistantCalls(message);
      const parts = [];

      if (content.trim()) parts.push({ text: content });

      for (const call of calls) {
        pendingToolNames.set(call.id, call.name);
        const functionCall = {
          name: call.name,
          args: call.args
        };
        if (call.id) functionCall.id = call.id;
        parts.push({ functionCall });
      }

      if (parts.length > 0) {
        contents.push({ role: "model", parts });
      }
      continue;
    }

    if (role === "tool" || role === "function") {
      const callId = String(message.tool_call_id || message.id || "");
      const name = String(message.name || pendingToolNames.get(callId) || "").trim();

      if (name) {
        const functionResponse = {
          name,
          response: parseObject(content)
        };
        if (callId) functionResponse.id = callId;
        contents.push({
          role: "user",
          parts: [{ functionResponse }]
        });
      } else if (content.trim()) {
        contents.push({
          role: "user",
          parts: [{ text: "Tool result (tool name unavailable): " + content }]
        });
      }
    }
  }

  return {
    contents: contents.length > 0 ? contents : String(prompt || ""),
    systemInstruction: systemParts.length > 0
      ? systemParts.join("\n\n")
      : undefined
  };
}

function normalizeGeminiResponse(response) {
  const candidateParts = response?.candidates?.[0]?.content?.parts;
  const parts = Array.isArray(candidateParts) ? candidateParts : [];

  let rawCalls = Array.isArray(response?.functionCalls)
    ? response.functionCalls
    : [];

  if (rawCalls.length === 0) {
    rawCalls = parts
      .filter(part => part && part.functionCall)
      .map(part => part.functionCall);
  }

  responseSequence += 1;
  const idPrefix = `gemini-response-${responseSequence}`;
  const functionCalls = rawCalls
    .map((call, index) => normalizeFunctionCall(call, index, idPrefix))
    .filter(Boolean);

  let text = "";
  try {
    text = typeof response?.text === "string" ? response.text : "";
  } catch {
    text = "";
  }

  if (!text) {
    text = parts
      .filter(part => typeof part?.text === "string")
      .map(part => part.text)
      .join("\n");
  }

  return {
    text,
    functionCalls,
    message: {
      role: "assistant",
      content: text,
      functionCalls
    }
  };
}

module.exports = {
  buildGeminiConversation,
  normalizeGeminiResponse
};
