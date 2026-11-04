'use strict';

// Read-only, snapshot-bound compatibility adapter. It never writes or mutates legacy stores.
const crypto = require('node:crypto');
const { validateCanonicalMemoryRecord } = require('./mira-memory-conflict-assessment');
const { filterTrustedRecords } = require('./mira-conflict-quarantine-registry');

const DOMAINS = new Set(['general_memory', 'knowledge', 'crm_conversation_message']);
const MAPPING_KEYS = [
  'domain', 'projectId', 'legacyId', 'memoryId', 'revision',
  'sourceDigest', 'sourceFileDigest', 'sourceOrdinal', 'classification', 'approvalReference', 'canonicalRecord'
];
function digest(value) {
  return crypto.createHash('sha256').update(JSON.stringify(value), 'utf8').digest('hex');
}
function text(value, label) {
  if (typeof value !== 'string' || !value.trim()) throw new Error(label + ' is required.');
}
function sourceLocator(domain, entry, sourceFileDigest, sourceOrdinal) {
  if (domain === 'general_memory') return 'legacy-memory:' + sourceFileDigest + ':' + sourceOrdinal;
  if (domain === 'knowledge') return entry.id;
  return entry.messageId;
}
function serializeLegacyPayload(domain, entry) {
  // Preserve the complete domain record, not only its content field.
  return JSON.stringify({ domain, record: entry });
}
function adaptLegacyEntry({
  domain, entry, mapping, projectId, sourceFileDigest, sourceOrdinal, parentConversation
}) {
  if (!DOMAINS.has(domain)) throw new Error('Unsupported legacy domain.');
  text(projectId, 'Explicit projectId');
  if (!entry || typeof entry !== 'object' || Array.isArray(entry)) throw new Error('Legacy entry must be an object.');
  if (!/^[a-f0-9]{64}$/.test(sourceFileDigest || '')) throw new Error('Exact sourceFileDigest is required.');
  if (!Number.isInteger(sourceOrdinal) || sourceOrdinal < 0) throw new Error('Valid sourceOrdinal is required.');
  if (!mapping || typeof mapping !== 'object' || Array.isArray(mapping) ||
      Object.keys(mapping).length !== MAPPING_KEYS.length ||
      MAPPING_KEYS.some(key => !Object.prototype.hasOwnProperty.call(mapping, key))) {
    throw new Error('An exact explicit identity mapping is required.');
  }
  if (mapping.domain !== domain || mapping.projectId !== projectId) throw new Error('Mapping domain/project scope mismatch.');
  text(mapping.legacyId, 'legacyId');
  text(mapping.memoryId, 'memoryId');
  if (!Number.isInteger(mapping.revision) || mapping.revision !== 1) throw new Error('Initial canonical revision must be 1.');
  if (typeof mapping.sourceDigest !== 'string' || !/^[a-f0-9]{64}$/.test(mapping.sourceDigest)) throw new Error('Valid sourceDigest is required.');
  if (mapping.sourceFileDigest !== sourceFileDigest || mapping.sourceOrdinal !== sourceOrdinal) {
    throw new Error('Source snapshot locator mismatch.');
  }
  if (!['PUBLIC', 'PROJECT_PRIVATE', 'RESTRICTED'].includes(mapping.classification)) {
    throw new Error('Explicit data classification is required.');
  }
  text(mapping.approvalReference, 'Approved mapping reference');
  const observedId = sourceLocator(domain, entry, sourceFileDigest, sourceOrdinal);
  if (typeof observedId !== 'string' || !observedId) {
    throw new Error(domain === 'knowledge' ? 'Legacy Knowledge id is absent.' :
      domain === 'crm_conversation_message' ? 'Persisted CRM messageId is absent.' :
      'General Memory source locator is invalid.');
  }
  if (observedId !== mapping.legacyId) throw new Error('Legacy identity/source locator mismatch.');
  if (digest(entry) !== mapping.sourceDigest) throw new Error('Legacy source digest mismatch.');
  if (domain === 'crm_conversation_message') {
    text(entry.conversationId, 'CRM conversationId');
    if (!parentConversation ||
        parentConversation.conversationId !== entry.conversationId ||
        parentConversation.mappingStatus !== 'APPROVED' ||
        parentConversation.projectId !== projectId ||
        typeof parentConversation.approvalReference !== 'string' ||
        !parentConversation.approvalReference.trim()) {
      throw new Error('Approved CRM conversation-to-project mapping is required.');
    }
  }
  const record = mapping.canonicalRecord;
  const errors = validateCanonicalMemoryRecord(record, 'canonicalRecord');
  if (errors.length) throw new Error('Canonical record invalid: ' + errors.join('; '));
  if (record.projectId !== projectId || record.memoryId !== mapping.memoryId ||
      record.version.revision !== mapping.revision ||
      record.content !== serializeLegacyPayload(domain, entry) ||
      record.source.sourceId !== mapping.legacyId ||
      record.access.classification !== mapping.classification ||
      record.integrity.status !== 'UNVERIFIED' ||
      record.trust.status !== 'SOURCE_RECORDED' ||
      record.lifecycle !== 'PENDING_REVIEW') {
    throw new Error('Canonical record does not preserve mapped identity, project, revision, full payload and provenance.');
  }
  return {
    domain, legacyId: mapping.legacyId, projectId, memoryId: mapping.memoryId,
    revision: mapping.revision, sourceDigest: mapping.sourceDigest,
    sourceFileDigest, sourceOrdinal, canonicalRecord: record
  };
}
function adaptLegacyEntries({
  domain, entries, mappings, projectId, sourceFileDigest, parentConversations = {}
}) {
  if (!Array.isArray(entries) || !Array.isArray(mappings)) throw new Error('entries and mappings must be arrays.');
  if (!/^[a-f0-9]{64}$/.test(sourceFileDigest || '')) throw new Error('Exact sourceFileDigest is required.');
  const byId = new Map();
  for (const mapping of mappings) {
    if (!mapping || typeof mapping.legacyId !== 'string' || !mapping.legacyId || byId.has(mapping.legacyId)) {
      throw new Error('Missing or duplicate legacy identity mapping.');
    }
    byId.set(mapping.legacyId, mapping);
  }
  const result = entries.map((entry, sourceOrdinal) => {
    const id = sourceLocator(domain, entry, sourceFileDigest, sourceOrdinal);
    if (typeof id !== 'string' || !id) throw new Error('Legacy record has no stable source locator.');
    const mapping = byId.get(id);
    if (!mapping) throw new Error('Explicit mapping missing for legacy identity: ' + id);
    const parentConversation = domain === 'crm_conversation_message'
      ? parentConversations[entry.conversationId]
      : undefined;
    return adaptLegacyEntry({
      domain, entry, mapping, projectId, sourceFileDigest, sourceOrdinal, parentConversation
    });
  });
  if (byId.size !== result.length) throw new Error('Unused mapping rejected.');
  if (new Set(result.map(item => item.memoryId)).size !== result.length) {
    throw new Error('Duplicate canonical memoryId mapping rejected.');
  }
  return result;
}
function filterAdaptedLegacyEntries({ adaptedEntries, pendingConflicts, projectId, authorizeAccess, actorContext }) {
  if (!Array.isArray(adaptedEntries) || !Array.isArray(pendingConflicts)) {
    throw new Error('Adapted entries and conflicts must be arrays.');
  }
  text(projectId, 'Explicit projectId');
  if (adaptedEntries.some(item => item.projectId !== projectId || item.canonicalRecord.projectId !== projectId)) {
    throw new Error('Cross-project adapted record rejected.');
  }
  const visible = filterTrustedRecords(
    adaptedEntries.map(item => item.canonicalRecord), pendingConflicts, projectId,
    authorizeAccess, actorContext
  );
  const ids = new Set(visible.map(item => item.memoryId));
  return adaptedEntries.filter(item => ids.has(item.memoryId));
}
module.exports = {
  adaptLegacyEntry, adaptLegacyEntries, filterAdaptedLegacyEntries,
  digest, serializeLegacyPayload, sourceLocator
};
