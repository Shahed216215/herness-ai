'use strict';

const {
  issueStandingReadAuthority,
  setStandingReadAuthorityStatus
} = require('../services/mira-hfm-standing-read-authority');
const { sameOriginRequest } = require('./mira-hfm-authority-approval');

function registerMiraHfmStandingReadAuthorityRoutes(app, getRuntime, requireAdmin) {
  if (!app || typeof app.post !== 'function' ||
      typeof getRuntime !== 'function' || typeof requireAdmin !== 'function') {
    throw new TypeError('HFM_STANDING_READ_ROUTE_DEPENDENCIES_REQUIRED');
  }

  const guard = (req, res) => {
    if (!req.get || !req.get('origin') || !sameOriginRequest(req)) {
      res.status(403).json({ success: false, error: 'Same-origin request required.' });
      return false;
    }
    if (!req.session || req.session.authenticated !== true ||
        req.session.role !== 'admin' || req.role !== 'admin' ||
        !req.session.hfmPrincipal) {
      res.status(401).json({ success: false, error: 'Authenticated HFM admin session required.' });
      return false;
    }
    const binding = req.session.hfmProjectBinding;
    if (!binding || binding.verified !== true ||
        typeof binding.projectId !== 'string' || !binding.projectId.trim()) {
      res.status(403).json({ success: false, error: 'Verified selected HFM project required.' });
      return false;
    }
    return true;
  };

  app.post('/api/hfm/memory/standing-authority/issue', requireAdmin, async (req, res) => {
    if (!guard(req, res)) return;
    const body = req.body || {};
    if (body.confirm !== true) {
      return res.status(400).json({ success: false, error: 'Explicit standing-authority confirmation is required.' });
    }
    if (typeof body.purpose !== 'string' || !body.purpose.trim() || body.purpose.length > 512) {
      return res.status(400).json({ success: false, error: 'A bounded standing-authority purpose is required.' });
    }
    try {
      const runtime = await getRuntime();
      if (!runtime || runtime.status !== 'AUTHORITY_ISSUER_READY' ||
          !runtime.pool || typeof runtime.pool.connect !== 'function') {
        return res.status(503).json({ success: false, error: 'HFM authority issuer is not ready.' });
      }
      const result = await issueStandingReadAuthority({
        req, pool: runtime.pool, env: process.env,
        purpose: body.purpose.trim(), approvalConfirmed: true
      });
      return res.status(201).json({ success: true, ...result });
    } catch (error) {
      const code = typeof error?.code === 'string' ? error.code : 'HFM_STANDING_READ_ISSUE_FAILED';
      const status = /^HFM_(APPROVAL|STANDING_READ)_(ADMIN|TRUSTED|EXPLICIT|RECENT|PROJECT_CONTEXT|PROJECT_BINDING)/.test(code)
        ? 403 : 503;
      return res.status(status).json({ success: false, error: code });
    }
  });

  for (const [path, status] of [
    ['/api/hfm/memory/standing-authority/pause', 'PAUSED'],
    ['/api/hfm/memory/standing-authority/resume', 'ACTIVE'],
    ['/api/hfm/memory/standing-authority/revoke', 'REVOKED']
  ]) {
    app.post(path, requireAdmin, async (req, res) => {
      if (!guard(req, res)) return;
      const body = req.body || {};
      if (typeof body.standingAuthorityId !== 'string' ||
          !body.standingAuthorityId.trim() || body.standingAuthorityId.length > 256) {
        return res.status(400).json({ success: false, error: 'A valid standingAuthorityId is required.' });
      }
      try {
        const runtime = await getRuntime();
        if (!runtime || runtime.status !== 'AUTHORITY_ISSUER_READY' ||
            !runtime.pool || typeof runtime.pool.connect !== 'function') {
          return res.status(503).json({ success: false, error: 'HFM authority issuer is not ready.' });
        }
        const result = await setStandingReadAuthorityStatus({
          req, pool: runtime.pool, env: process.env,
          standingAuthorityId: body.standingAuthorityId.trim(), status
        });
        return res.json({ success: true, ...result });
      } catch (error) {
        const code = typeof error?.code === 'string' ? error.code : 'HFM_STANDING_READ_STATUS_UPDATE_FAILED';
        const statusCode = /^HFM_(APPROVAL|STANDING_READ)_(ADMIN|TRUSTED|PROJECT_CONTEXT|PROJECT_BINDING)/.test(code)
          ? 403 : 503;
        return res.status(statusCode).json({ success: false, error: code });
      }
    });
  }
}

module.exports = Object.freeze({ registerMiraHfmStandingReadAuthorityRoutes });
