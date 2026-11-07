'use strict';

module.exports = {
  name: 'knowledge_review_queue',
  declaration: {
    type: 'function',
    function: {
      name: 'knowledge_review_queue',
      description: 'Show private HFM knowledge sources awaiting human review. Use only when the user explicitly asks to show, list, or review pending/unverified knowledge. This queue is not trusted task context and must never be treated as verified facts.',
      parameters: {
        type: 'object',
        properties: {
          limit: { type: 'integer', minimum: 1, maximum: 50 }
        },
        additionalProperties: false
      }
    }
  },
  execute: async ({ limit = 20 } = {}) => {
    if (process.env.MIRA_HFM_STANDING_READ_AUTHORITY_ENABLED === 'true' ||
        process.env.MIRA_HFM_WORK_LEARNING_ENABLED === 'true' ||
        process.env.MIRA_HFM_MEMORY_WRITE_ENABLED === 'true') {
      return JSON.stringify({
        success: false,
        code: 'HFM_TOOL_ROUTER_REQUIRED',
        localFallback: false,
        driveFallback: false
      });
    }
    return JSON.stringify({
      success: false,
      code: 'HFM_STANDING_READ_AUTHORITY_DISABLED',
      localFallback: false,
      driveFallback: false
    });
  }
};
