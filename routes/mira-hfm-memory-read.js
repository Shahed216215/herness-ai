'use strict';

const { retrieveProjectMemory } = require('../services/mira-hfm-authorized-memory-reader');
const { sameOriginRequest } = require('./mira-hfm-authority-approval');

function registerMiraHfmMemoryReadRoute(
  app, getRuntime, requireAdmin, readMemory = retrieveProjectMemory, env = process.env
) {
  if (!app || typeof app.post !== 'function' ||
      typeof getRuntime !== 'function' || typeof requireAdmin !== 'function' ||
      typeof readMemory !== 'function' || !env || typeof env !== 'object') {
    throw new TypeError('HFM_MEMORY_READ_ROUTE_DEPENDENCIES_REQUIRED');
  }

  app.post('/api/hfm/memory/read', requireAdmin, async (req, res) => {
    if (!req.get || !req.get('origin') || !sameOriginRequest(req)) {
      return res.status(403).json({ success: false, error: 'Same-origin request required.' });
    }
    if (!req.session || req.session.authenticated !== true ||
        req.session.role !== 'admin' || req.role !== 'admin') {
      return res.status(401).json({ success: false, error: 'Authenticated admin session required.' });
    }
    const binding = req.session.hfmProjectBinding;
    if (!binding || binding.verified !== true ||
        typeof binding.projectId !== 'string' || !binding.projectId.trim()) {
      return res.status(403).json({ success: false, error: 'A verified selected HFM project is required.' });
    }

    const standingMode = env.MIRA_HFM_STANDING_READ_AUTHORITY_ENABLED === 'true';
    const pending = req.session.hfmPendingMemoryAuthority;
    if (!standingMode && (!pending ||
        pending.operation !== 'memory.read' ||
        pending.resource !== 'memory:project:' + binding.projectId ||
        pending.projectId !== binding.projectId ||
        !pending.grant || typeof pending.grant !== 'object')) {
      return res.status(403).json({ success: false, error: 'A server-held one-time Memory authority is required.' });
    }
    if (!standingMode && (!Number.isFinite(Date.parse(pending.expiresAt)) ||
        Date.parse(pending.expiresAt) <= Date.now())) {
      delete req.session.hfmPendingMemoryAuthority;
      return req.session.save(error => {
        if (error) return res.status(503).json({ success: false, error: 'Unable to clear expired authority.' });
        return res.status(403).json({ success: false, error: 'The Memory authority has expired.' });
      });
    }

    const body = req.body || {};
    const cursor = body.cursor;
    if (cursor !== undefined && cursor !== null && cursor !== '') {
      if (!standingMode || typeof cursor !== 'string' || cursor.length > 2048) {
        return res.status(400).json({ success: false, error: 'A bounded page cursor is available only in standing-read mode.' });
      }
    }
    const limit = body.limit === undefined ? 50 : body.limit;
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
      return res.status(400).json({ success: false, error: 'limit must be an integer from 1 to 100.' });
    }
    const allowedRecordTypes = standingMode
      ? ['learning_note', 'knowledge_item']
      : ['daily_activity', 'learning_note', 'knowledge_item',
        'social_post_draft', 'client_vault_record', 'financial_vault_record'];
    if (body.recordType !== undefined && !allowedRecordTypes.includes(body.recordType)) {
      return res.status(400).json({
        success: false,
        error: standingMode
          ? 'Standing authority is limited to Learning and Knowledge records.'
          : 'Unsupported Memory recordType filter.'
      });
    }
    if (standingMode && body.lifecycle !== undefined && body.lifecycle !== 'ACTIVE') {
      return res.status(400).json({ success: false, error: 'Standing authority permits ACTIVE records only.' });
    }
    if (!standingMode && body.lifecycle !== undefined &&
        !['ACTIVE', 'TRASHED'].includes(body.lifecycle)) {
      return res.status(400).json({ success: false, error: 'Unsupported Memory lifecycle filter.' });
    }

    try {
      const runtime = await getRuntime();
      if (!runtime || runtime.status !== 'MEMORY_READ_READY' ||
          !runtime.pool || typeof runtime.pool.connect !== 'function') {
        return res.status(503).json({ success: false, error: 'HFM Memory reader is not ready.' });
      }

      const performRead = async grant => {
        try {
          const result = await readMemory({
            pool: runtime.pool,
            req,
            ...(standingMode
              ? { standingReadAuthority: true, recordTypes: ['learning_note', 'knowledge_item'] }
              : { authorityGrant: grant }),
            limit,
            recordType: body.recordType,
            lifecycle: standingMode ? 'ACTIVE' : body.lifecycle,
            ...(standingMode && cursor ? { cursor } : {}),
            env
          });
          return res.json({
            success: true,
            status: result.status,
            projectId: result.projectId,
            count: result.count,
            records: result.records,
            nextCursor: standingMode ? (result.nextCursor || null) : null,
            scanStartedAt: standingMode ? (result.scanStartedAt || null) : null,
            authorityConsumed: result.authorityConsumed,
            standingAuthority: result.standingAuthority === true,
            standingAuthorityId: result.standingAuthorityId,
            authorityExpiresAt: result.authorityExpiresAt,
            approvalRequiredPerRead: result.approvalRequiredPerRead === true,
            localFallback: false,
            driveFallback: false
          });
        } catch (error) {
          const code = typeof error?.code === 'string' ? error.code : 'HFM_MEMORY_READ_FAILED';
          const status = /TRUSTED_PROJECT|AUTHORITY_GRANT|STANDING_READ_SCOPE|RECORD_TYPE/.test(code) ? 403 : 503;
          return res.status(status).json({ success: false, error: code });
        }
      };

      if (standingMode) return performRead(undefined);

      // Consume the one-time server-held grant before starting the database read.
      const grant = pending.grant;
      delete req.session.hfmPendingMemoryAuthority;
      return req.session.save(async saveError => {
        if (saveError) {
          req.session.hfmPendingMemoryAuthority = pending;
          return res.status(503).json({ success: false, error: 'Unable to consume server-side session authority.' });
        }
        return performRead(grant);
      });
    } catch (_error) {
      return res.status(503).json({ success: false, error: 'HFM Memory reader runtime unavailable.' });
    }
  });
}

module.exports = Object.freeze({ registerMiraHfmMemoryReadRoute });
