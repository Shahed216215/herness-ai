'use strict';

const { approveAndIssueMemoryReadAuthority } = require('../services/mira-hfm-authority-approval');

function sameOriginRequest(req) {
  const origin = req.get && req.get('origin');
  if (!origin) return true;
  try {
    const parsed = new URL(origin);
    return parsed.host === req.get('host') &&
      parsed.protocol === (req.secure ? 'https:' : 'http:');
  } catch (_error) {
    return false;
  }
}

function registerMiraHfmAuthorityApprovalRoute(app, getRuntime, requireAdmin) {
  if (!app || typeof app.post !== 'function' ||
      typeof getRuntime !== 'function' || typeof requireAdmin !== 'function') {
    throw new TypeError('HFM_AUTHORITY_APPROVAL_ROUTE_DEPENDENCIES_REQUIRED');
  }

  app.post('/api/hfm/memory/authorize',
    requireAdmin,
    async (req, res) => {
      if (!sameOriginRequest(req)) {
        return res.status(403).json({ success: false, error: 'Same-origin request required.' });
      }
      if (!req.session || req.session.authenticated !== true ||
          req.session.role !== 'admin' || req.role !== 'admin') {
        return res.status(401).json({ success: false, error: 'Authenticated admin session required.' });
      }
      if (!req.session.hfmPrincipal || !req.session.hfmProjectBinding) {
        return res.status(403).json({ success: false, error: 'Verified admin identity and selected project required.' });
      }
      const body = req.body || {};
      if (body.confirm !== true) {
        return res.status(400).json({ success: false, error: 'Explicit approval confirmation is required.' });
      }
      if (typeof body.purpose !== 'string' || !body.purpose.trim() || body.purpose.length > 512) {
        return res.status(400).json({ success: false, error: 'A bounded approval purpose is required.' });
      }
      try {
        const runtime = await getRuntime();
        if (!runtime || runtime.status !== 'AUTHORITY_ISSUER_READY' ||
            !runtime.pool || typeof runtime.pool.connect !== 'function') {
          return res.status(503).json({ success: false, error: 'HFM authority issuer is not ready.' });
        }
        const result = await approveAndIssueMemoryReadAuthority({
          req,
          pool: runtime.pool,
          env: process.env,
          purpose: body.purpose.trim(),
          approvalConfirmed: true
        });
        if (req.session.hfmPendingMemoryAuthority) {
          return res.status(409).json({ success: false, error: 'An unconsumed HFM Memory authority is already pending.' });
        }
        const previousPending = req.session.hfmPendingMemoryAuthority;
        req.session.hfmPendingMemoryAuthority = {
          projectId: result.projectId,
          grant: result.grant,
          expiresAt: result.expiresAt
        };
        return req.session.save(error => {
          if (error) {
            if (previousPending === undefined) delete req.session.hfmPendingMemoryAuthority;
            else req.session.hfmPendingMemoryAuthority = previousPending;
            return res.status(503).json({ success: false, error: 'Unable to persist server-side Memory authority.' });
          }
          return res.status(201).json({
            success: true,
            status: result.status,
            projectId: result.projectId,
            operation: result.operation,
            singleUse: result.singleUse,
            expiresAt: result.expiresAt,
            authorityHeldServerSide: true
          });
        });
      } catch (error) {
        const code = typeof error?.code === 'string' ? error.code : 'HFM_AUTHORITY_ISSUE_FAILED';
        const status = /^HFM_APPROVAL_(ADMIN|TRUSTED|RECENT|EXPLICIT|ISSUER)/.test(code) ? 403 : 503;
        return res.status(status).json({ success: false, error: code });
      }
    }
  );
}

module.exports = Object.freeze({ registerMiraHfmAuthorityApprovalRoute, sameOriginRequest });
