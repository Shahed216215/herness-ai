'use strict';

const {
  BINDING_VERSION
} = require('../services/mira-hfm-project-binding-context');
const {
  buildTrustedActorContext
} = require('../services/mira-hfm-runtime-identity-context');
const {
  findActiveProjectMembership
} = require('../services/mira-hfm-project-selection-read-runtime');

function registerMiraHfmProjectSelectionRoute(app, getRuntime) {
  if (!app || typeof app.post !== 'function' ||
      !getRuntime || typeof getRuntime !== 'function') {
    throw new TypeError('HFM_PROJECT_SELECTION_ROUTE_DEPENDENCIES_REQUIRED');
  }

  app.post('/api/hfm/projects/select', async (req, res) => {
    if (!req.session || req.session.authenticated !== true ||
        !['user', 'admin'].includes(req.session.role)) {
      return res.status(401).json({
        success: false,
        error: 'Authenticated session required.'
      });
    }

    req.role = req.session.role;
    const identity = buildTrustedActorContext(req);
    if (identity.status !== 'ACTOR_RESOLVED') {
      return res.status(401).json({
        success: false,
        error: 'Verified session identity required.'
      });
    }

    const projectId = req.body && req.body.projectId;
    if (typeof projectId !== 'string' || !projectId.trim() || projectId.length > 128) {
      return res.status(400).json({
        success: false,
        error: 'A valid projectId is required.'
      });
    }

    try {
      const runtime = await getRuntime();
      if (!runtime || runtime.status !== 'PROJECT_READ_READY' ||
          !runtime.pool || typeof runtime.pool.connect !== 'function') {
        return res.status(503).json({
          success: false,
          error: 'HFM project selection is not enabled.'
        });
      }

      const membership = await findActiveProjectMembership({
        pool: runtime.pool,
        req,
        projectId: projectId.trim()
      });
      if (membership.status !== 'ACTIVE_MEMBERSHIP_VERIFIED') {
        return res.status(403).json({
          success: false,
          error: 'Active project membership is required.'
        });
      }

      const previousBinding = req.session.hfmProjectBinding;
      const selectedAt = new Date().toISOString();
      req.session.hfmProjectBinding = {
        verified: true,
        bindingVersion: BINDING_VERSION,
        actorId: identity.actor.actorId,
        projectId: membership.projectId,
        selectedAt
      };

      return req.session.save(error => {
        if (error) {
          if (previousBinding === undefined) delete req.session.hfmProjectBinding;
          else req.session.hfmProjectBinding = previousBinding;
          return res.status(503).json({
            success: false,
            error: 'Unable to persist project selection.'
          });
        }
        return res.json({
          success: true,
          project: {
            projectId: membership.projectId,
            membershipRole: membership.membershipRole,
            permissions: membership.permissions
          },
          bindingVersion: BINDING_VERSION,
          selectedAt
        });
      });
    } catch (_error) {
      return res.status(503).json({
        success: false,
        error: 'HFM project membership verification is unavailable.'
      });
    }
  });
}

module.exports = Object.freeze({ registerMiraHfmProjectSelectionRoute });
