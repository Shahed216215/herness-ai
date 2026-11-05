'use strict';

const { authorizeAndAuditOperation } = require('../autonomous-approval-audit');
const { recordAudit } = require('../audit-log');
const { archiveFacebookResearchEvidenceWithProvider } = require('./mira-facebook-research-memory-provider');

const CONFIRMATION = 'ARCHIVE_UNTRUSTED_RESEARCH_EVIDENCE';

function fail(code, message) {
  const error = new Error(message);
  error.code = code;
  throw error;
}

async function archiveResearchEvidenceWithHumanApproval({
  actor,
  confirmed,
  pageId,
  pageName = null,
  evidence,
  authorize = authorizeAndAuditOperation,
  audit = recordAudit,
  archiveEvidence = archiveFacebookResearchEvidenceWithProvider,
  env = process.env
} = {}) {
  if (typeof actor !== 'string' || !actor.trim() || actor.trim().length > 100) {
    fail('RESEARCH_ARCHIVE_ACTOR_REQUIRED', 'A named administrator is required.');
  }
  if (confirmed !== true) {
    fail('RESEARCH_ARCHIVE_CONFIRMATION_REQUIRED', 'Explicit human confirmation is required.');
  }
  if (typeof pageId !== 'string' || !/^\d{1,32}$/.test(pageId)) {
    fail('RESEARCH_ARCHIVE_INVALID_INPUT', 'A numeric Facebook Page ID is required.');
  }
  if (!Array.isArray(evidence) || evidence.length < 1 || evidence.length > 10) {
    fail('RESEARCH_ARCHIVE_INVALID_INPUT', 'Between 1 and 10 reviewed evidence items are required.');
  }
  const archiveBackend = String(env && env.MIRA_FACEBOOK_RESEARCH_MEMORY_BACKEND || 'local').trim().toLowerCase();
  if (env && env.NODE_ENV === 'production' && archiveBackend === 'local' &&
      env.MIRA_FACEBOOK_RESEARCH_MEMORY_DURABLE_STORAGE_CONFIRMED !== 'true') {
    fail('RESEARCH_ARCHIVE_DURABILITY_NOT_CONFIRMED', 'Production local archive writes require an explicitly confirmed persistent storage mount.');
  }
  if (typeof authorize !== 'function' || typeof audit !== 'function' || typeof archiveEvidence !== 'function') {
    fail('RESEARCH_ARCHIVE_WORKFLOW_UNAVAILABLE', 'The approval workflow dependencies are unavailable.');
  }

  const authorization = await authorize({
    actorRole: 'admin',
    operation: 'file_modify',
    permissionGranted: true,
    approved: true,
    resource: 'facebook_research_archive',
    resourceId: pageId
  });
  if (!authorization || !authorization.result || authorization.result.allowed !== true) {
    fail('RESEARCH_ARCHIVE_POLICY_DENIED', 'Global operation policy denied the archive write.');
  }

  audit({
    actorRole: 'admin',
    action: 'FACEBOOK_RESEARCH_ARCHIVE_APPROVED',
    resource: 'facebook_research_archive',
    resourceId: pageId,
    status: 'success',
    details: {
      actor: actor.trim(),
      confirmation: CONFIRMATION,
      evidenceCount: evidence.length,
      archivePolicy: 'UNTRUSTED_RESEARCH_ONLY',
      canonicalMemoryWrite: false
    }
  });

  let result;
  try {
    result = await archiveEvidence({ pageId, pageName, evidence });
  } catch (error) {
    try {
      audit({
        actorRole: 'admin',
        action: 'FACEBOOK_RESEARCH_ARCHIVE_RESULT',
        resource: 'facebook_research_archive',
        resourceId: pageId,
        status: 'failed',
        details: {
          actor: actor.trim(),
          errorCode: /^[A-Za-z0-9_-]{1,64}$/.test(String(error && error.code || '')) ? String(error.code) : 'ARCHIVE_WRITE_FAILED',
          canonicalMemoryWrite: false
        }
      });
    } catch (_) {}
    throw error;
  }

  if (!result || result.status !== 'ARCHIVE_WRITE_VERIFIED' || result.canonicalMemoryWrite !== false) {
    try {
      audit({
        actorRole: 'admin',
        action: 'FACEBOOK_RESEARCH_ARCHIVE_RESULT',
        resource: 'facebook_research_archive',
        resourceId: pageId,
        status: 'inconclusive',
        details: {
          actor: actor.trim(),
          archiveStatus: String(result && result.status || 'NO_RESULT').slice(0, 64),
          canonicalMemoryWrite: false
        }
      });
    } catch (_) {}
    fail('RESEARCH_ARCHIVE_WRITE_UNVERIFIED', 'Archive readback did not verify an untrusted-only write.');
  }

  try {
    audit({
      actorRole: 'admin',
      action: 'FACEBOOK_RESEARCH_ARCHIVE_RESULT',
      resource: 'facebook_research_archive',
      resourceId: pageId,
      status: 'success',
      details: {
        actor: actor.trim(),
        storedCount: Number(result.storedCount) || 0,
        duplicateCount: Number(result.duplicateCount) || 0,
        archivePolicy: 'UNTRUSTED_RESEARCH_ONLY',
        canonicalMemoryWrite: false
      }
    });
  } catch (_) {
    return {
      status: 'ARCHIVE_WRITE_VERIFIED_AUDIT_INCOMPLETE',
      stateCommitted: true,
      pageId,
      storedCount: Number(result.storedCount) || 0,
      duplicateCount: Number(result.duplicateCount) || 0,
      canonicalMemoryWrite: false
    };
  }

  return Object.freeze({
    status: 'ARCHIVE_WRITE_VERIFIED',
    pageId,
    storedCount: Number(result.storedCount) || 0,
    duplicateCount: Number(result.duplicateCount) || 0,
    archivePolicy: 'UNTRUSTED_RESEARCH_ONLY',
    canonicalMemoryWrite: false,
    mayEnterTrustedMemory: false
  });
}

module.exports = {
  CONFIRMATION,
  archiveResearchEvidenceWithHumanApproval
};
