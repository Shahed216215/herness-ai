'use strict';

function normalizeMessage(message) {
  if (!message || typeof message !== 'object') return null;
  const role = message.role;
  if (!['user', 'assistant', 'tool'].includes(role)) return null;

  if (role === 'tool') {
    if (typeof message.tool_call_id !== 'string' || !message.tool_call_id.trim() ||
        typeof message.content !== 'string') return null;
    return {
      role: 'tool',
      tool_call_id: message.tool_call_id.slice(0, 128),
      content: message.content
    };
  }

  if (role === 'assistant') {
    const normalized = {
      role: 'assistant',
      content: typeof message.content === 'string' ? message.content : null
    };
    if (Array.isArray(message.tool_calls)) {
      normalized.tool_calls = message.tool_calls
        .filter(call => call && typeof call.id === 'string' &&
          call.function && typeof call.function.name === 'string')
        .map(call => ({
          id: call.id.slice(0, 128),
          type: 'function',
          function: {
            name: call.function.name.slice(0, 128),
            arguments: typeof call.function.arguments === 'string'
              ? call.function.arguments : '{}'
          }
        }));
    }
    return normalized;
  }

  return typeof message.content === 'string'
    ? { role, content: message.content }
    : null;
}

function buildGroqMessages(options = {}, prompt) {
  const messages = [];
  if (typeof options.systemInstruction === 'string' && options.systemInstruction.trim()) {
    messages.push({ role: 'system', content: options.systemInstruction });
  }
  if (Array.isArray(options.messages)) {
    for (const message of options.messages) {
      const normalized = normalizeMessage(message);
      if (normalized) messages.push(normalized);
    }
  } else {
    messages.push({ role: 'user', content: String(prompt || '') });
  }
  return messages;
}

module.exports = { normalizeMessage, buildGroqMessages };
