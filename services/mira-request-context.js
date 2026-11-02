"use strict";

const DEFAULT_MAX_MESSAGES = 8;
const DEFAULT_MAX_CHARS = 4500;
const DEFAULT_MAX_MESSAGE_CHARS = 1800;

function selectRecentMessages(memory, options = {}) {
  const maxMessages = Number.isInteger(options.maxMessages) &&
    options.maxMessages > 0
    ? options.maxMessages
    : DEFAULT_MAX_MESSAGES;

  const maxChars = Number.isInteger(options.maxChars) &&
    options.maxChars > 0
    ? options.maxChars
    : DEFAULT_MAX_CHARS;

  const maxMessageChars =
    Number.isInteger(options.maxMessageChars) &&
    options.maxMessageChars > 0
      ? options.maxMessageChars
      : DEFAULT_MAX_MESSAGE_CHARS;

  if (!Array.isArray(memory)) return [];

  const normalized = memory
    .filter(entry => entry && typeof entry === "object")
    .map(entry => ({
      role: entry.role === "agent" ? "assistant" : entry.role,
      content: typeof entry.content === "string"
        ? entry.content
        : String(entry.content || "")
    }))
    .filter(entry =>
      ["system", "user", "assistant"].includes(entry.role)
    );

  const selected = [];
  let usedChars = 0;

  for (let i = normalized.length - 1;
       i >= 0 && selected.length < maxMessages;
       i--) {
    const entry = normalized[i];
    const size = entry.content.length;

    if (size > maxMessageChars) continue;
    if (usedChars + size > maxChars) continue;

    selected.push(entry);
    usedChars += size;
  }

  return selected.reverse();
}

module.exports = { selectRecentMessages };
