'use strict';

function resolveServerBindHost(env = process.env) {
  return String(env && env.NODE_ENV || '').trim().toLowerCase() === 'production'
    ? '0.0.0.0'
    : '127.0.0.1';
}

module.exports = { resolveServerBindHost };
