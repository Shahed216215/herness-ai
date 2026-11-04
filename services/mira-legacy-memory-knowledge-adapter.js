'use strict';

// Read-only compatibility adapter. No implicit identity, project scope, migration or writes.
const crypto = require('node:crypto');
const { validateCanonicalMemoryRecord } = require('./mira-memory-conflict-assessment');
const { filterTrustedRecords } = require('./mira-conflict-quarantine-registry');

const DOMAINS = new Set(['conversation_memory', 'knowledge']);
const KEYS = ['domain', 'projectId', 'legacyId', 'memoryId', 'revision', 'sourceDigest', 'canonicalRecord'];
function digest(value) {
  return crypto.createHash('sha256').update(JSON.stringify(value), 'utf8').digest('hex');
}
function text(value, label) {
  if (typeof value !== 'string' || !value.trim()) throw new Error(label + ' is required.');
}
function adaptLegacyEntry({ domain, entry, mapping, projectId }) {
  if (!DOMAINS.has(domain)) throw new Error('Unsupported legacy domain.');
  text(projectId, 'Explicit projectId');
  if (!entry || typeof entry !== 'object' || Array.isArray(entry)) throw new Error('Legacy entry must be an object.');
  if (!mapping || typeof mapping !== 'object' || Array.isArray(mapping) ||
      Object.keys(mapping).length !== KEYS.length || KEYS.some(k => !Object.prototype.hasOwnProperty.call(mapping, k))) {
    throw new Error('An exact explicit identity mapping is required.');
  }
  if (mapping.domain !== domain || mapping.projectId !== projectId) throw new Error('Mapping domain/project scope mismatch.');
  text(mapping.legacyId, 'legacyId'); text(mapping.memoryId, 'memoryId');
  if (!Number.isInteger(mapping.revision) || mapping.revision < 1) throw new Error('Positive canonical revision is required.');
  if (typeof mapping.sourceDigest !== 'string' || !/^[a-f0-9]{64}$/.test(mapping.sourceDigest)) throw new Error('Valid sourceDigest is required.');
  const observedId = domain === 'knowledge' ? entry.id : entry.messageId;
  if (typeof observedId !== 'string' || !observedId) {
    throw new Error(domain === 'conversation_memory' ? 'Legacy conversation messageId is absent; explicit identity backfill is required.' : 'Legacy Knowledge id is absent.');
  }
  if (observedId !== mapping.legacyId) throw new Error('Legacy identity mismatch.');
  if (digest(entry) !== mapping.sourceDigest) throw new Error('Legacy source digest mismatch.');
  const record = mapping.canonicalRecord;
  const errors = validateCanonicalMemoryRecord(record, 'canonicalRecord');
  if (errors.length) throw new Error('Canonical record invalid: ' + errors.join('; '));
  if (record.projectId !== projectId || record.memoryId !== mapping.memoryId ||
      record.version.revision !== mapping.revision || record.content !== entry.content ||
      record.source.sourceId !== mapping.legacyId) {
    throw new Error('Canonical record does not preserve mapped identity, project, revision, provenance and content.');
  }
  return { domain, legacyId: mapping.legacyId, projectId, memoryId: mapping.memoryId, revision: mapping.revision, sourceDigest: mapping.sourceDigest, canonicalRecord: record };
}
function adaptLegacyEntries({ domain, entries, mappings, projectId }) {
  if (!Array.isArray(entries) || !Array.isArray(mappings)) throw new Error('entries and mappings must be arrays.');
  const byId = new Map();
  for (const m of mappings) {
    if (!m || typeof m.legacyId !== 'string' || !m.legacyId || byId.has(m.legacyId)) throw new Error('Missing or duplicate legacy identity mapping.');
    byId.set(m.legacyId, m);
  }
  const result = entries.map(entry => {
    const id = domain === 'knowledge' ? entry?.id : entry?.messageId;
    if (typeof id !== 'string' || !id) throw new Error('Legacy record has no stable immutable identity; no implicit identity is generated.');
    const mapping = byId.get(id);
    if (!mapping) throw new Error('Explicit mapping missing for legacy identity: ' + id);
    return adaptLegacyEntry({ domain, entry, mapping, projectId });
  });
  if (byId.size !== result.length) throw new Error('Unused mapping rejected.');
  if (new Set(result.map(x => x.memoryId)).size !== result.length) throw new Error('Duplicate canonical memoryId mapping rejected.');
  return result;
}
function filterAdaptedLegacyEntries({ adaptedEntries, pendingConflicts, projectId }) {
  if (!Array.isArray(adaptedEntries) || !Array.isArray(pendingConflicts)) throw new Error('Adapted entries and conflicts must be arrays.');
  text(projectId, 'Explicit projectId');
  if (adaptedEntries.some(x => x.projectId !== projectId || x.canonicalRecord.projectId !== projectId)) throw new Error('Cross-project adapted record rejected.');
  const visible = filterTrustedRecords(adaptedEntries.map(x => x.canonicalRecord), pendingConflicts, projectId);
  const ids = new Set(visible.map(x => x.memoryId));
  return adaptedEntries.filter(x => ids.has(x.memoryId));
}
module.exports = { adaptLegacyEntry, adaptLegacyEntries, filterAdaptedLegacyEntries, digest };
