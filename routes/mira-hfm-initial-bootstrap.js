'use strict';

const { bootstrapInitialHfmProject } = require('../services/mira-hfm-initial-project-bootstrap');
const { sameOriginRequest } = require('./mira-hfm-authority-approval');

function registerMiraHfmInitialBootstrapRoute(app, getRuntime, requireAdmin, bootstrapProject = bootstrapInitialHfmProject) {
  if (!app || typeof app.post !== 'function' ||
      typeof getRuntime !== 'function' || typeof requireAdmin !== 'function' ||
      typeof bootstrapProject !== 'function') {
    throw new TypeError('HFM_INITIAL_BOOTSTRAP_ROUTE_DEPENDENCIES_REQUIRED');
  }

  app.post('/api/hfm/bootstrap/initial-project',
    requireAdmin,
    async (req, res) => {
      if (!req.get || !req.get('origin') || !sameOriginRequest(req)) {
        return res.status(403).json({ success: false, error: 'Same-origin request required.' });
      }
      if (!req.session || req.session.authenticated !== true ||
          req.session.role !== 'admin' || req.role !== 'admin') {
        return res.status(401).json({ success: false, error: 'Authenticated admin session required.' });
      }
      const body = req.body || {};
      if (body.confirm !== true) {
        return res.status(400).json({ success: false, error: 'Explicit initial-project bootstrap confirmation is required.' });
      }
      if (typeof body.projectId !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._:-]{2,127}$/.test(body.projectId.trim())) {
        return res.status(400).json({ success: false, error: 'A valid projectId is required.' });
      }

      try {
        const runtime = await getRuntime();
        if (!runtime || runtime.status !== 'HFM_BOOTSTRAP_READY' ||
            !runtime.pool || typeof runtime.pool.connect !== 'function') {
          return res.status(503).json({ success: false, error: 'HFM initial bootstrap runtime is not ready.' });
        }
        const result = await bootstrapProject({
          req,
          pool: runtime.pool,
          env: process.env,
          projectId: body.projectId.trim(),
          confirm: true
        });
        return res.status(201).json({
          success: true,
          status: result.status,
          projectId: result.projectId,
          ownerActorId: result.ownerActorId,
          membershipRole: result.membershipRole,
          permissions: result.permissions,
          approvalRef: result.approvalRef,
          oneTimeOnly: result.oneTimeOnly,
          memoryRecordsImported: 0,
          nextStep: 'Select the newly created project through /api/hfm/projects/select.'
        });
      } catch (error) {
        const code = typeof error?.code === 'string' ? error.code : 'HFM_INITIAL_BOOTSTRAP_FAILED';
        const status = code === 'HFM_BOOTSTRAP_ALREADY_CONSUMED' ? 409
          : /^HFM_BOOTSTRAP_(ADMIN|VERIFIED|TRUSTED|RECENT|EXPLICIT)/.test(code) ? 403
          : code === 'HFM_BOOTSTRAP_PROJECT_ID_INVALID' ? 400
          : 503;
        return res.status(status).json({ success: false, error: code });
      }
    }
  );
}

module.exports = Object.freeze({ registerMiraHfmInitialBootstrapRoute });
