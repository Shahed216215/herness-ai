'use strict';

// Legacy JSON and Google Drive knowledge/memory stores are not HFM v0.2.
// When either HFM authority mode is enabled, never let those stores act as
// a source, fallback, or write destination. Emergency encrypted backup is
// implemented separately and is not routed through these legacy functions.
function assertLegacyStorageDisabled(env = process.env) {
  if (!env || typeof env !== 'object') {
    throw new TypeError('HFM_LEGACY_STORAGE_ENV_INVALID');
  }
  if (env.MIRA_HFM_STANDING_READ_AUTHORITY_ENABLED === 'true' ||
      env.MIRA_HFM_WORK_LEARNING_ENABLED === 'true' ||
      env.MIRA_HFM_MEMORY_READ_ENABLED === 'true' ||
      env.MIRA_HFM_MEMORY_WRITE_ENABLED === 'true') {
    const error = new Error('HFM_LEGACY_STORAGE_DISABLED_IN_HFM_MODE');
    error.code = 'HFM_LEGACY_STORAGE_DISABLED_IN_HFM_MODE';
    throw error;
  }
}

module.exports = Object.freeze({ assertLegacyStorageDisabled });
