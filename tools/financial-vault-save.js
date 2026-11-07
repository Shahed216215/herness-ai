'use strict';

module.exports = {
  name: 'financial_vault_save',
  declaration: {
    name: 'financial_vault_save',
    description: 'Save an explicitly user-requested financial/transaction record to the encrypted RESTRICTED HFM Financial Vault. Use only when the user explicitly asks to save a financial, invoice, payment, or transaction record and every supplied field value is present in the current user message. Never infer or fabricate fields. Full card/account/routing numbers, IBAN/SWIFT, CVV/CVC, PIN, OTP, passwords, tokens, API keys, private keys, and recovery codes are rejected; only accountLast4 is allowed. The record is encrypted at rest, starts SOURCE_RECORDED/PENDING_REVIEW, and is excluded from trusted search. No local or Google Drive fallback.',
    parameters: {
      type: 'object',
      properties: {
        payload: {
          type: 'object',
          properties: {
            transactionReference: { type: 'string' },
            invoiceReference: { type: 'string' },
            counterparty: { type: 'string' },
            amount: { type: ['number', 'string'] },
            currency: { type: 'string' },
            transactionDate: { type: 'string' },
            dueDate: { type: 'string' },
            category: { type: 'string' },
            status: { type: 'string' },
            paymentMethod: { type: 'string', enum: ['cash', 'bank_transfer', 'card', 'mobile_money', 'other'] },
            accountLast4: { type: 'string' },
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
