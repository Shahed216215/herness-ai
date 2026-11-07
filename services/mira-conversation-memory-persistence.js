'use strict';

// Conversation transcript persistence is legacy local Memory, not canonical HFM.
// When any HFM Memory mode is active, never write a local fallback.
function persistConversationMessage(message, options = {}) {
  const env = options.env || process.env;
  const addMemory = options.addMemory;
  if (!env || typeof env !== 'object') {
    const error = new TypeError('MIRA_CONVERSATION_MEMORY_ENV_INVALID');
    error.code = 'MIRA_CONVERSATION_MEMORY_ENV_INVALID';
    throw error;
  }
  if (typeof addMemory !== 'function') {
    const error = new TypeError('MIRA_CONVERSATION_MEMORY_WRITER_REQUIRED');
    error.code = 'MIRA_CONVERSATION_MEMORY_WRITER_REQUIRED';
    throw error;
  }
  const hfmMode = env.MIRA_HFM_STANDING_READ_AUTHORITY_ENABLED === 'true' ||
    env.MIRA_HFM_WORK_LEARNING_ENABLED === 'true' ||
    env.MIRA_HFM_MEMORY_WRITE_ENABLED === 'true';
  if (hfmMode) {
    return Object.freeze({
      persisted: false,
      source: 'HFM_CANONICAL_TRANSCRIPT_NOT_CONFIGURED',
      localFallback: false,
      driveFallback: false
    });
  }
  addMemory(message);
  return Object.freeze({
    persisted: true,
    source: 'LEGACY_LOCAL_TRANSCRIPT',
    localFallback: false,
    driveFallback: false
  });
}

module.exports = Object.freeze({ persistConversationMessage });
