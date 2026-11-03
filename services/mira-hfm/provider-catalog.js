'use strict';

const { inspectProviderAdapter, createUnavailableProvider } = require('./provider-contract');

const PROVIDER_ROLES = Object.freeze({
  facebook_page_primary: 'PRIMARY_PRIVATE_MEMORY_PROVIDER',
  facebook_group_import: 'SECONDARY_AUTHORIZED_IMPORT_SOURCE',
  public_web_retrieval: 'PUBLIC_EVIDENCE_RETRIEVAL_ONLY',
  google_drive_emergency_backup: 'ENCRYPTED_EMERGENCY_BACKUP_ONLY'
});

/*
 * Provider selection is explicit and exact. This catalog never probes,
 * authenticates, connects, or silently substitutes another provider.
 */
function createProviderCatalog(configuredAdapters) {
  const configured = configuredAdapters && typeof configuredAdapters === 'object' &&
    !Array.isArray(configuredAdapters) ? configuredAdapters : {};
  const entries = Object.create(null);

  for (const [providerId, role] of Object.entries(PROVIDER_ROLES)) {
    const candidate = configured[providerId];
    const inspection = candidate ? inspectProviderAdapter(candidate) : null;
    const accepted = !!candidate && candidate.providerId === providerId && inspection.valid;
    entries[providerId] = Object.freeze({
      providerId,
      role,
      status: accepted ? 'READY_FOR_CAPABILITY_EVALUATION' :
        candidate ? 'REJECTED_CONFIGURATION' : 'NOT_CONFIGURED',
      provider: accepted ? candidate : createUnavailableProvider(providerId),
      capabilities: accepted ? inspection.capabilities : {
        READ: 'NOT_CONFIGURED', WRITE: 'NOT_CONFIGURED',
        SEARCH: 'NOT_CONFIGURED', VERIFY: 'NOT_CONFIGURED',
        BACKUP: 'NOT_CONFIGURED', RESTORE: 'NOT_CONFIGURED'
      },
      missingMethods: inspection ? inspection.missingMethods : []
    });
  }

  return Object.freeze({
    resolve(providerId) {
      if (typeof providerId !== 'string' || !Object.prototype.hasOwnProperty.call(entries, providerId)) {
        return { ok: false, status: 'NOT_SUPPORTED', reason: 'PROVIDER_ROLE_UNKNOWN' };
      }
      const entry = entries[providerId];
      return {
        ok: true,
        providerId: entry.providerId,
        role: entry.role,
        status: entry.status,
        provider: entry.provider,
        capabilities: entry.capabilities,
        missingMethods: entry.missingMethods
      };
    },
    list() {
      return Object.values(entries).map(entry => ({
        providerId: entry.providerId,
        role: entry.role,
        status: entry.status,
        capabilities: entry.capabilities,
        missingMethods: entry.missingMethods
      }));
    },
    noFallback: true,
    networkAccessPerformed: false
  });
}

module.exports = { PROVIDER_ROLES, createProviderCatalog };
