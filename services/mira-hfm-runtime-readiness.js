'use strict';

const { getMemoryWriterConfig } = require('./mira-hfm-memory-postgres-runtime');
const { configFrom: getAuthorityIssuerConfig } = require('./mira-hfm-authority-issuer-runtime');

function vaultStatus(env) {
  const version = env.MIRA_VAULT_ACTIVE_KEK_VERSION;
  if (typeof version !== 'string' || !/^v[1-9][0-9]*$/.test(version)) {
    return Object.freeze({ status: 'NOT_CONFIGURED', reason: 'VAULT_ACTIVE_KEY_VERSION_MISSING' });
  }
  const encoded = env['MIRA_VAULT_KEK_' + version.toUpperCase()];
  if (typeof encoded !== 'string' || encoded.length !== 44) {
    return Object.freeze({ status: 'NOT_CONFIGURED', reason: 'VAULT_KEY_MISSING' });
  }
  const key = Buffer.from(encoded, 'base64');
  const valid = key.length === 32 && key.toString('base64') === encoded;
  key.fill(0);
  return Object.freeze({
    status: valid ? 'CONFIGURED' : 'INVALID',
    reason: valid ? null : 'VAULT_KEY_INVALID',
    activeKeyVersion: version
  });
}

function safeConfig(read, env, fallbackReason) {
  try {
    const config = read(env);
    return Object.freeze({
      status: config.enabled ? 'CONFIGURED' : 'NOT_CONFIGURED',
      reason: config.reason || (config.enabled ? null : fallbackReason)
    });
  } catch (error) {
    return Object.freeze({
      status: 'INVALID',
      reason: error && typeof error.code === 'string' && /^[A-Z0-9_]+$/.test(error.code)
        ? error.code : 'CONFIGURATION_INVALID'
    });
  }
}

/*
 * Configuration-only diagnostic. It never opens a database connection,
 * reads records, initializes pools, or returns secret values/URLs.
 */
function inspectHfmRuntimeConfiguration(env = process.env) {
  const authorityIssuer = safeConfig(getAuthorityIssuerConfig, env, 'AUTHORITY_ISSUER_NOT_CONFIGURED');
  const memoryWriter = safeConfig(getMemoryWriterConfig, env, 'MEMORY_WRITER_NOT_CONFIGURED');
  const vault = vaultStatus(env);
  const required = [authorityIssuer, memoryWriter, vault];
  const configured = required.every(item => item.status === 'CONFIGURED');
  return Object.freeze({
    status: configured ? 'CONFIGURED_NOT_CONNECTED' : 'NOT_CONFIGURED',
    databaseConnectivity: 'NOT_TESTED',
    poolInitialization: 'LAZY_ON_DEMAND',
    authorityIssuer,
    memoryWriter: Object.freeze({
      ...memoryWriter,
      writesEnabled: env.MIRA_HFM_MEMORY_WRITE_ENABLED === 'true'
    }),
    vault,
    legacyMemoryKnowledge: 'NOT_INTEGRATED',
    productionReadiness: 'NOT_CERTIFIED'
  });
}

module.exports = Object.freeze({ inspectHfmRuntimeConfiguration });
