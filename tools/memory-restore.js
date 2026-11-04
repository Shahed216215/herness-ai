'use strict';

const { restoreMemory } = require('../services/mira-local-memory-store');
const { checkToolSafety } = require('../services/mira-tool-execution-policy');

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

  execute: async (args = {}) => {
    const safety = checkToolSafety("memory_restore", args);
    if (!safety || safety.passed !== true) {
      return JSON.stringify({
        success: false,
        restored: false,
        status: "BLOCKED",
        code: "TOOL_POLICY_DENIED",
        reason: safety?.reason || "Tool execution policy could not be verified."
      });
    }
    const { confirm } = args;
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
      const committed = error && error.stateCommitted === true;
      return JSON.stringify({
        success: false,
        restored: committed,
        dataModified: committed,
        status: committed ? 'restored_audit_failed' : 'restore_failed',
        code: error && error.code ? error.code : 'RESTORE_FAILED',
        message: error.message
      });
    }
  }
};
