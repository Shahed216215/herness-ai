'use strict';

const { createKnowledgeBackup } = require('../services/mira-knowledge-state-recovery');

module.exports = {
  name: 'knowledge_backup',
  declaration: {
    name: 'knowledge_backup',
    description: 'Create a verified local, versioned backup of Mira Knowledge. This operation is offline and does not contact Google Drive.',
    parameters: { type: 'object', properties: {} }
  },
  execute: async () => {
    try {
      return JSON.stringify(createKnowledgeBackup(), null, 2);
    } catch (error) {
      return JSON.stringify({
        success: false,
        code: error.code || 'KNOWLEDGE_BACKUP_FAILED',
        message: error.message,
        quarantineFile: error.quarantineFile || null
      }, null, 2);
    }
  }
};
