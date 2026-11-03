'use strict';

const { mapLegacyRecord } = require('./legacy-adapter');
const { sha256Canonical } = require('./core');

function previewLegacyMigration(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input) ||
      !Array.isArray(input.records) || input.records.length > 10000 ||
      typeof input.domain !== 'string' || typeof input.projectId !== 'string' ||
      !input.projectId.trim() || typeof input.observedAt !== 'string') {
    return { ok: false, status: 'VALIDATION_FAILED', reason: 'MIGRATION_PREVIEW_INPUT_INVALID' };
  }

  const mapped = [];
  const rejected = [];
  const identities = new Map();
  const conflicts = [];
  const duplicates = [];

  for (let index = 0; index < input.records.length; index += 1) {
    const result = mapLegacyRecord({
      domain: input.domain,
      projectId: input.projectId,
      observedAt: input.observedAt,
      accessClassification: input.accessClassification,
      record: input.records[index]
    });
    if (!result.ok) {
      rejected.push({ index, sourceId: input.records[index] && input.records[index].id || null, errors: result.errors });
      continue;
    }

    const record = result.record;
    const existing = identities.get(record.memoryId);
    if (!existing) {
      identities.set(record.memoryId, { index, hash: record.version.contentHash, record });
      mapped.push(record);
      continue;
    }

    if (existing.hash === record.version.contentHash) {
      duplicates.push({ firstIndex: existing.index, duplicateIndex: index, memoryId: record.memoryId });
    } else {
      conflicts.push({
        memoryId: record.memoryId,
        firstIndex: existing.index,
        conflictingIndex: index,
        firstHash: existing.hash,
        conflictingHash: record.version.contentHash,
        bothVersionsPreserved: true
      });
    }
  }

  const status = rejected.length || conflicts.length ? 'REVIEW_REQUIRED' : 'PREVIEW_READY';
  return {
    ok: true,
    status,
    summary: {
      sourceRecordsProvided: input.records.length,
      mappedUniqueRecords: mapped.length,
      duplicates: duplicates.length,
      conflicts: conflicts.length,
      rejected: rejected.length
    },
    records: mapped,
    duplicates,
    conflicts,
    rejected,
    migrationPerformed: false,
    persistencePerformed: false,
    sourceStorageRead: false,
    sourceStorageModified: false,
    previewHash: sha256Canonical({
      domain: input.domain,
      projectId: input.projectId,
      records: mapped.map(record => ({
        memoryId: record.memoryId,
        contentHash: record.version.contentHash
      })),
      duplicates,
      conflicts,
      rejected
    })
  };
}

module.exports = { previewLegacyMigration };
