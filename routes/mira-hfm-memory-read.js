'use strict';

const { retrieveProjectMemory } = require('../services/mira-hfm-authorized-memory-reader');
const { sameOriginRequest } = require('./mira-hfm-authority-approval');

function registerMiraHfmMemoryReadRoute(app, getRuntime, requireAdmin, readMemory = retrieveProjectMemory) {
  if (!app || typeof app.post !== 'function' ||
      typeof getRuntime !== 'function' || typeof requireAdmin !== 'function' || typeof readMemory !== 'function') {
    throw new TypeError('HFM_MEMORY_READ_ROUTE_DEPENDENCIES_REQUIRED');
  }

  app.post('/api/hfm/memory/read',
    requireAdmin,
    async (req, res) => {
      if (!sameOriginRequest(req)) {
        return res.status(403).json({ success: false, error: 'Same-origin request required.' });
      }
      if (!req.session || req.session.authenticated !== true ||
          req.session.role !== 'admin' || req.role !== 'admin') {
        return res.status(401).json({ success: false, error: 'Authenticated admin session required.' });
      }
      const binding = req.session.hfmProjectBinding;
      const pending = req.session.hfmPendingMemoryAuthority;
      if (!binding || binding.verified !== true || !pending ||
          pending.projectId !== binding.projectId ||
          !pending.grant || typeof pending.grant !== 'object') {
        return res.status(403).json({ success: false, error: 'A server-held authority for the selected project is required.' });
      }
      if (!Number.isFinite(Date.parse(pending.expiresAt)) ||
          Date.parse(pending.expiresAt) <= Date.now()) {
        delete req.session.hfmPendingMemoryAuthority;
        return req.session.save(error => {
          if (error) return res.status(503).json({ success: false, error: 'Unable to clear expired authority.' });
          return res.status(403).json({ success: false, error: 'The Memory authority has expired.' });
        });
      }
      const body = req.body || {};
      const limit = body.limit === undefined ? 50 : body.limit;
      if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
        return res.status(400).json({ success: false, error: 'limit must be an integer from 1 to 100.' });
      }
      try {
        const runtime = await getRuntime();
        if (!runtime || runtime.status !== 'MEMORY_READ_READY' ||
            !runtime.pool || typeof runtime.pool.connect !== 'function') {
          return res.status(503).json({ success: false, error: 'HFM Memory reader is not ready.' });
        }

        // Remove the server-held grant before starting the read. A failed save
        // never reaches the database; a retry requires a fresh human approval.
        const grant = pending.grant;
        delete req.session.hfmPendingMemoryAuthority;
        return req.session.save(async saveError => {
          if (saveError) {
            req.session.hfmPendingMemoryAuthority = pending;
            return res.status(503).json({ success: false, error: 'Unable to consume server-side session authority.' });
          }
          try {
            const result = await readMemory({
              pool: runtime.pool,
              req,
              authorityGrant: grant,
              limit,
              env: process.env
            });
            return res.json({
              success: true,
              status: result.status,
              projectId: result.projectId,
              count: result.count,
              records: result.records,
              authorityConsumed: result.authorityConsumed,
              localFallback: false,
              driveFallback: false
            });
          } catch (error) {
            const code = typeof error?.code === 'string' ? error.code : 'HFM_MEMORY_READ_FAILED';
            const status = /TRUSTED_PROJECT|AUTHORITY_GRANT/.test(code) ? 403 : 503;
            return res.status(status).json({ success: false, error: code });
          }
        });
      } catch (_error) {
        return res.status(503).json({ success: false, error: 'HFM Memory reader runtime unavailable.' });
      }
    }
  );
}

module.exports = Object.freeze({ registerMiraHfmMemoryReadRoute });
