'use strict';

const { createAuthorityIssuerPool } = require('./mira-hfm-authority-issuer-runtime');
let poolPromise = null;

async function getAuthorityIssuerPool(options = {}) {
  if (!poolPromise) {
    poolPromise = createAuthorityIssuerPool(options).then(result => {
      if (result.status !== 'AUTHORITY_ISSUER_READY' || !result.pool) {
        throw Object.assign(new Error(result.reason || 'AUTHORITY_ISSUER_NOT_READY'), {
          code: result.reason || 'AUTHORITY_ISSUER_NOT_READY'
        });
      }
      return result.pool;
    }).catch(error => {
      poolPromise = null;
      throw error;
    });
  }
  return poolPromise;
}

module.exports = Object.freeze({ getAuthorityIssuerPool });
