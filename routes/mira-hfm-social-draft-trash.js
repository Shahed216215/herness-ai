'use strict';

const { sameOriginRequest } = require('./mira-hfm-authority-approval');
const { approveAndIssueMemoryOperationAuthority } = require('../services/mira-hfm-authority-approval');
const { executeWithConsumedAuthority } = require('../services/mira-hfm-authority-transaction');
const { trashMemoryRecord } = require('../services/mira-hfm-memory-repository');

const MEMORY_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{2,127}$/;
const IDEMPOTENCY_KEY = /^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/;

function registerMiraHfmSocialDraftTrashRoute(
  app, getWriterRuntime, getIssuerRuntime, requireAdmin,
  issueAuthority = approveAndIssueMemoryOperationAuthority,
  executeAuthority = executeWithConsumedAuthority,
  trashRecord = trashMemoryRecord
) {
  if (!app || typeof app.post !== 'function' ||
      typeof getWriterRuntime !== 'function' || typeof getIssuerRuntime !== 'function' ||
      typeof requireAdmin !== 'function' || typeof issueAuthority !== 'function' ||
      typeof executeAuthority !== 'function' || typeof trashRecord !== 'function') {
    throw new TypeError('HFM_SOCIAL_DRAFT_TRASH_ROUTE_DEPENDENCIES_REQUIRED');
  }

  app.post('/api/hfm/social-drafts/trash', requireAdmin, async (req, res) => {
    if (!sameOriginRequest(req)) {
      return res.status(403).json({ success: false, error: 'Same-origin request required.' });
    }
    if (!req.session || req.session.authenticated !== true ||
        req.session.role !== 'admin' || req.role !== 'admin' ||
        !req.session.hfmPrincipal) {
      return res.status(401).json({ success: false, error: 'Verified admin session required.' });
    }
    const binding = req.session.hfmProjectBinding;
    if (!binding || binding.verified !== true || typeof binding.projectId !== 'string') {
      return res.status(403).json({ success: false, error: 'Verified selected HFM project required.' });
    }
    const body = req.body || {};
    if (body.confirm !== true) {
      return res.status(400).json({ success: false, error: 'Explicit confirmation is required to move the published draft to Trash.' });
    }
    if (typeof body.memoryId !== 'string' || !MEMORY_ID.test(body.memoryId.trim())) {
      return res.status(400).json({ success: false, error: 'A valid social draft memoryId is required.' });
    }
    if (typeof body.purpose !== 'string' || !body.purpose.trim() || body.purpose.length > 512) {
      return res.status(400).json({ success: false, error: 'A bounded purpose is required.' });
    }
    const idempotencyKey = typeof body.idempotencyKey === 'string' &&
      IDEMPOTENCY_KEY.test(body.idempotencyKey) ? body.idempotencyKey : null;
    if (!idempotencyKey) {
      return res.status(400).json({ success: false, error: 'A stable idempotencyKey is required for safe retry and reconciliation.' });
    }

    try {
      const [writer, issuer] = await Promise.all([getWriterRuntime(), getIssuerRuntime()]);
      if (!writer || writer.status !== 'MEMORY_WRITER_READY' ||
          !writer.pool || typeof writer.pool.connect !== 'function') {
        return res.status(503).json({ success: false, error: 'HFM Memory writer is not ready.' });
      }
      if (!issuer || issuer.status !== 'AUTHORITY_ISSUER_READY' ||
          !issuer.pool || typeof issuer.pool.connect !== 'function') {
        return res.status(503).json({ success: false, error: 'HFM authority issuer is not ready.' });
      }

      const memoryId = body.memoryId.trim();
      const resource = 'memory:' + memoryId;
      const authority = await issueAuthority({
        req,
        pool: issuer.pool,
        env: process.env,
        operation: 'memory.trash',
        resource,
        purpose: body.purpose.trim(),
        approvalConfirmed: true
      });
      if (!authority || authority.status !== 'AUTHORITY_ISSUED' ||
          authority.operation !== 'memory.trash' || authority.resource !== resource ||
          !authority.grant || authority.projectId !== binding.projectId) {
        return res.status(503).json({ success: false, error: 'HFM trash authority issuance was not verified.' });
      }

      const committed = await executeAuthority({
        pool: writer.pool,
        verifiedPrincipal: req.session.hfmPrincipal,
        request: {
          authorityId: authority.grant.authorityId,
          projectId: binding.projectId,
          operation: 'memory.trash',
          resource,
          purpose: authority.grant.purpose,
          requestId: authority.grant.requestId
        },
        perform: (client, context) => trashRecord({
          client,
          context,
          memoryId,
          idempotencyKey,
          expectedRecordType: 'social_post_draft',
          env: process.env,
          allowPrivateLifecycle: false,
          allowRestrictedLifecycle: false
        })
      });

      if (!committed || committed.status !== 'AUTHORIZED_AND_COMMITTED' ||
          !committed.value || !['TRASHED', 'ALREADY_COMMITTED'].includes(committed.value.status)) {
        return res.status(503).json({ success: false, error: 'HFM trash result is not confirmed.' });
      }
      return res.json({
        success: true,
        status: committed.value.status,
        memoryId,
        revision: committed.value.revision || null,
        lifecycle: 'TRASHED',
        recoverable: true,
        hardDelete: false,
        idempotencyKey
      });
    } catch (error) {
      const code = typeof error?.code === 'string' ? error.code : 'HFM_SOCIAL_DRAFT_TRASH_FAILED';
      const status = /NOT_FOUND|RECORD_TYPE|OPERATION_NOT_GRANTED|SCOPE_MISMATCH|TRUSTED_ACTOR/.test(code)
        ? 403 : 503;
      return res.status(status).json({ success: false, error: code });
    }
  });
}

module.exports = Object.freeze({ registerMiraHfmSocialDraftTrashRoute });
