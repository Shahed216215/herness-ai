'use strict';

module.exports = {
  name: 'client_vault_save',
  declaration: {
    name: 'client_vault_save',
    description: 'Save an explicitly user-requested client record to the encrypted RESTRICTED HFM Client Vault. Use only when the user explicitly asks to save client/customer details to the vault and every supplied field value is present in the current user message. Never infer or fabricate fields. Passwords, tokens, API keys, private keys, authentication secrets, government IDs, full bank/card/account numbers, CVV, PIN, OTP, and recovery codes are rejected. The record is encrypted at rest, starts SOURCE_RECORDED/PENDING_REVIEW, and is excluded from trusted search. No local or Google Drive fallback.',
    parameters: {
      type: 'object',
      properties: {
        payload: {
          type: 'object',
          properties: {
            clientId: { type: 'string' },
            clientName: { type: 'string' },
            organization: { type: 'string' },
            contactName: { type: 'string' },
            email: { type: 'string' },
            phone: { type: 'string' },
            address: { type: 'string' },
            website: { type: 'string' },
            contractReference: { type: 'string' },
            projectReference: { type: 'string' },
            serviceScope: { type: 'string' },
            status: { type: 'string' },
            notes: { type: 'string' }
          },
          required: []
        }
      },
      required: ['payload']
    }
  },
  execute: async () => {
    const hfmEnabled =
      process.env.MIRA_HFM_MEMORY_WRITE_ENABLED === 'true' ||
      process.env.MIRA_HFM_MEMORY_READ_ENABLED === 'true' ||
      process.env.MIRA_HFM_STANDING_READ_AUTHORITY_ENABLED === 'true' ||
      process.env.MIRA_HFM_WORK_LEARNING_ENABLED === 'true';
    return JSON.stringify({
      success: false,
      saved: false,
      code: hfmEnabled ? 'HFM_TOOL_ROUTER_REQUIRED' : 'HFM_VAULT_CANONICAL_ONLY',
      localFallback: false,
      driveFallback: false
    });
  }
};
