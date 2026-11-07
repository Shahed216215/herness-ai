'use strict';

const { buildTrustedActorContext } = require('../services/mira-hfm-runtime-identity-context');

function registerHfmRuntimeReadinessRoute(app, requireAgentAuth, options = {}) {
  if (!app || typeof app.get !== 'function' ||
      typeof requireAgentAuth !== 'function' ||
      typeof options.inspect !== 'function') {
    throw new Error('Authenticated runtime readiness route dependencies are required.');
  }

  app.get('/api/hfm/runtime/readiness', requireAgentAuth, (req, res) => {
    const identity = buildTrustedActorContext(req);
    if (identity.status !== 'ACTOR_RESOLVED' || identity.actor.role !== 'admin') {
      return res.status(403).json({ ok: false, code: 'HFM_ADMIN_IDENTITY_REQUIRED' });
    }
    try {
      const report = options.inspect();
      return res.status(200).json({
        ok: true,
        runtimeReady: false,
        diagnostic: 'CONFIGURATION_ONLY',
        ...report
      });
    } catch (_error) {
      return res.status(503).json({
        ok: false,
        code: 'HFM_RUNTIME_DIAGNOSTIC_FAILED',
        productionReadiness: 'NOT_CERTIFIED'
      });
    }
  });
}

module.exports = registerHfmRuntimeReadinessRoute;
