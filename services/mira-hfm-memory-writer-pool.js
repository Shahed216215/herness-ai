'use strict';

const { createMemoryWriterPool } = require('./mira-hfm-memory-postgres-runtime');

let poolPromise = null;

async function getMemoryWriterPool(options = {}) {
  if (!poolPromise) {
    poolPromise = createMemoryWriterPool(options).then(result => {
      if (result.status !== 'MEMORY_WRITER_READY' || !result.pool) {
        throw Object.assign(new Error(result.reason || 'MEMORY_WRITER_NOT_READY'), {
          code: result.reason || 'MEMORY_WRITER_NOT_READY'
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

module.exports = Object.freeze({ getMemoryWriterPool });
