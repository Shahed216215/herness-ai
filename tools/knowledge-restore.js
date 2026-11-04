'use strict';

const { restoreKnowledge } = require('../services/mira-knowledge-state-recovery');

module.exports = {
  name: 'knowledge_restore',
  declaration: {
    name: 'knowledge_restore',
    description: 'Restore Mira Knowledge from the verified local backup. Explicit confirmation is required. No Google Drive or network access is performed. Legacy unchecksummed backup restore requires an additional explicit allowLegacy=true.',
    parameters: {
      type: 'object',
      properties: {
        confirm: {
          type: 'boolean',
          description: 'Must be true to perform the local Knowledge restore.'
        },
        allowLegacy: {
          type: 'boolean',
          description: 'Must be true to allow a legacy version-1 backup without a checksum.'
        }
      },
      required: ['confirm']
    }
  },
  execute: async ({ confirm, allowLegacy } = {}) => {
    if (confirm !== true) {
      return JSON.stringify({
        success: false,
        restored: false,
        dataModified: false,
        message: 'Explicit confirmation is required.'
      });
    }
    try {
      return JSON.stringify(restoreKnowledge({ confirm, allowLegacy }), null, 2);
    } catch (error) {
      const committed = error && error.stateCommitted === true;
      return JSON.stringify({
        success: false,
        restored: committed,
        dataModified: committed,
        status: committed ? 'restored_verification_failed' : 'restore_failed',
        code: error && error.code ? error.code : 'KNOWLEDGE_RESTORE_FAILED',
        message: error.message
      }, null, 2);
    }
  }
};
