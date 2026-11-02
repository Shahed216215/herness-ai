'use strict';

const { restoreMemory } = require('../services/mira-local-memory-store');

module.exports = {
  name: 'memory_restore',

  declaration: {
    name: 'memory_restore',
    description:
      'Restore Mira Memory from a validated local backup. Explicit user confirmation is required.',
    parameters: {
      type: 'object',
      properties: {
        confirm: {
          type: 'boolean',
          description: 'Must be true to perform the Memory restore.'
        }
      },
      required: ['confirm']
    }
  },

  execute: async ({ confirm } = {}) => {
    if (confirm !== true) {
      return JSON.stringify({
        success: false,
        restored: false,
        dataModified: false,
        message: 'Explicit confirmation is required.'
      });
    }

    try {
      return JSON.stringify(restoreMemory(), null, 2);
    } catch (error) {
      return JSON.stringify({
        success: false,
        restored: false,
        dataModified: false,
        message: error.message
      });
    }
  }
};
