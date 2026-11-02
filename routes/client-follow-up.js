'use strict';

const {
  processClientFollowUp
} = require('../services/mira-client-follow-up-engine');

const {
  list,
  get
} = require('../client-follow-up-store');

function registerClientFollowUpRoutes(
  app,
  requireAgentAuth,
  requireAgentPermission,
  PERMISSIONS
) {
  if (
    !app ||
    typeof app.post !== 'function' ||
    typeof app.get !== 'function'
  ) {
    throw new Error(
      'Express app with route methods is required.'
    );
  }

  if (
    typeof requireAgentAuth !== 'function' ||
    typeof requireAgentPermission !== 'function'
  ) {
    throw new Error(
      'Agent middleware is required.'
    );
  }

  if (
    !PERMISSIONS ||
    !PERMISSIONS.CLIENT_PROJECTS
  ) {
    throw new Error(
      'CLIENT_PROJECTS permission is required.'
    );
  }

  app.post(
    '/api/client-follow-ups/process',
    requireAgentAuth,
    requireAgentPermission(
      PERMISSIONS.CLIENT_PROJECTS
    ),
    (req, res) => {
      try {
        const result =
          processClientFollowUp(
            req.body || {}
          );

        return res.status(
          result.ok ? 201 : 409
        ).json(result);
      } catch (error) {
        return res.status(400).json({
          ok: false,
          error: error.message
        });
      }
    }
  );

  app.get(
    '/api/client-follow-ups',
    requireAgentAuth,
    requireAgentPermission(
      PERMISSIONS.CLIENT_PROJECTS
    ),
    (req, res) => {
      try {
        return res.json({
          ok: true,
          followUps: list({
            projectId:
              req.query.projectId,
            clientId:
              req.query.clientId,
            status:
              req.query.status
          })
        });
      } catch (error) {
        return res.status(500).json({
          ok: false,
          error: error.message
        });
      }
    }
  );

  app.get(
    '/api/client-follow-ups/:id',
    requireAgentAuth,
    requireAgentPermission(
      PERMISSIONS.CLIENT_PROJECTS
    ),
    (req, res) => {
      try {
        const followUp =
          get(req.params.id);

        if (!followUp) {
          return res.status(404).json({
            ok: false,
            error: 'FOLLOW_UP_NOT_FOUND'
          });
        }

        return res.json({
          ok: true,
          followUp
        });
      } catch (error) {
        return res.status(500).json({
          ok: false,
          error: error.message
        });
      }
    }
  );

  return {
    registered: true,
    routes: [
      'POST /api/client-follow-ups/process',
      'GET /api/client-follow-ups',
      'GET /api/client-follow-ups/:id'
    ],
    externalSendImplemented: false
  };
}

module.exports =
  registerClientFollowUpRoutes;
