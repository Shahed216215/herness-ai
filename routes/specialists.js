'use strict';

const express = require('express');
const {
  createSpecialistRuntime
} = require('../services/multi-agent/specialist-runtime.cjs');
const {
  authorizeSpecialistRequest
} = require('../services/multi-agent/specialist-core-adapter.cjs');
const {
  recordAudit
} = require('../audit-log');

function registerSpecialistRoutes(
  app,
  requireAdminPermission,
  PERMISSIONS
) {
  const router = express.Router();
  const requireSystemAdmin =
    requireAdminPermission(PERMISSIONS.SYSTEM_ADMIN);

  router.post('/dispatch', requireSystemAdmin, async (req, res) => {
    const identity = {
      role: req.role,
      permissions: Array.isArray(req.permissions)
        ? req.permissions
        : []
    };

    const body = req.body || {};
    const requestId = typeof body.requestId === 'string'
      ? body.requestId.trim().slice(0, 100)
      : '';
    const specialist = typeof body.specialist === 'string'
      ? body.specialist.trim().slice(0, 40)
      : '';
    const task = typeof body.task === 'string'
      ? body.task.trim().slice(0, 2000)
      : '';

    if (!requestId || !specialist || !task) {
      return res.status(400).json({
        ok: false,
        error: 'INVALID_REQUEST'
      });
    }

    const runtime = createSpecialistRuntime({
      authorize: (request, selectedSpecialist) =>
        authorizeSpecialistRequest({
          identity,
          request,
          specialist: selectedSpecialist
        }),
      audit: async event => {
        // Real integrity-chain audit. If this throws, runtime fails closed.
        recordAudit({
          actorRole: identity.role || 'unknown',
          action: 'specialist_dispatch',
          resource: 'specialist',
          resourceId: requestId,
          status: event.outcome === 'success' ? 'success' : 'failure',
          details: {
            specialist: event.specialist,
            outcome: event.outcome,
            reason: event.reason || null,
            evidenceDigest: event.evidenceDigest || null,
            startedAt: event.startedAt || null,
            finishedAt: event.finishedAt || null
          }
        });
      }
    });

    const result = await runtime.dispatch({
      requestId,
      specialist,
      task
    });

    if (result.ok) {
      return res.status(200).json(result);
    }

    const denied = [
      'PERMISSION_DENIED',
      'CAPABILITY_NOT_REGISTERED',
      'CAPABILITY_NOT_VERIFIED',
      'CAPABILITY_SKILL_MISMATCH',
      'SKILL_NOT_REGISTERED',
      'SKILL_NOT_VERIFIED',
      'POLICY_DENIED',
      'CAPABILITY_DENIED',
      'UNKNOWN_SPECIALIST'
    ].includes(result.error);

    return res.status(denied ? 403 : 400).json(result);
  });

  app.use('/api/admin/specialists', router);
  return router;
}

module.exports = { registerSpecialistRoutes };
