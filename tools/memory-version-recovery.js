'use strict';

const recovery = require('../services/mira-state-version-recovery');

module.exports = {
  name: 'memory_version_recovery',
  declaration: {
    name: 'memory_version_recovery',
    description: 'List and verify immutable local Memory/Knowledge version snapshots, or restore one only with explicit confirmation. No version is automatically deleted; restore refuses corrupt current state.',
    parameters: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ['list', 'verify', 'restore'] },
        target: { type: 'string', enum: ['memory', 'knowledge'] },
        versionFile: { type: 'string' },
        confirm: { type: 'boolean' }
      },
      required: ['action', 'target']
    }
  },
  execute: async ({ action, target, versionFile, confirm } = {}) => {
    try {
      let result;
      if (action === 'list') result = recovery.listVersions(target);
      else if (action === 'verify') result = recovery.verifyVersion(target, versionFile);
      else if (action === 'restore') result = recovery.restoreVersion({ target, versionFile, confirm });
      else throw new Error('Unsupported action.');
      return JSON.stringify(result, null, 2);
    } catch (error) {
      const committed = error && error.stateCommitted === true;
      return JSON.stringify({
        success: false,
        restored: committed,
        dataModified: committed,
        status: committed ? 'restored_verification_failed' : 'recovery_failed',
        code: error.code || 'VERSION_RECOVERY_FAILED',
        message: error.message
      }, null, 2);
    }
  }
};
