'use strict';

const { buildTrustedActorContext } = require('../services/mira-hfm-runtime-identity-context');
const { executeWithConsumedAuthority } = require('../services/mira-hfm-authority-transaction');
const workflow = require('../services/mira-hfm-social-post-workflow');

const PURPOSES = Object.freeze({
  LIST: 'social-post-archive-read',
  STATUS: 'social-post-status-read',
  COPY: 'social-post-copy',
  PUBLISH: 'social-post-user-confirmed-published',
  DELETE: 'social-post-payload-erasure'
});

function fail(code) {
  const error = new Error(code);
  error.code = code;
  return error;
}

function requiredText(value, max = 256) {
  if (typeof value !== 'string' || !value.trim() || value.trim() !== value || value.length > max) {
    throw fail('HFM_SOCIAL_POST_REQUEST_INVALID');
  }
  return value;
}

function statusForError(error) {
  const code = String(error && error.code || '');
  if (/NOT_FOUND/.test(code)) return 404;
  if (/AUTHORITY|AUTHORIZATION|TRUSTED_ACTOR|MEMBERSHIP|NOT_GRANTED|PERMISSION|OWNER|PROJECT_SCOPE|CLASSIFICATION|CONFIRMATION_REQUIRED|PRIVATE_READ/.test(code)) return 403;
  if (/IDEMPOTENCY|TRANSITION|ALREADY|CONFLICT/.test(code)) return 409;
  if (/UNKNOWN|PREFLIGHT|WRITER|DATABASE|CONNECTION|TIMEOUT/.test(code)) return 503;
  return 400;
}

function registerMiraHfmSocialPostRoutes(app, requireAgentAuth, options = {}) {
  if (!app || typeof app.get !== 'function' || typeof app.post !== 'function' || typeof app.delete !== 'function') {
    throw new Error('Express app with GET, POST and DELETE routes is required.');
  }
  if (typeof requireAgentAuth !== 'function') throw new Error('requireAgentAuth middleware is required.');
  if (typeof options.getPool !== 'function') throw new Error('HFM writer pool resolver is required.');

  async function perform(req, request, operation, resource, purpose, callback) {
    const identity = buildTrustedActorContext(req);
    if (identity.status !== 'ACTOR_RESOLVED') throw fail('HFM_TRUSTED_ACTOR_REQUIRED');
    const pool = await options.getPool();
    if (!pool || typeof pool.connect !== 'function') throw fail('MEMORY_WRITER_NOT_READY');
    const result = await executeWithConsumedAuthority({
      pool,
      verifiedPrincipal: req.session.hfmPrincipal,
      request: {
        authorityId: requiredText(request.authorityId),
        projectId: requiredText(request.projectId),
        operation,
        resource,
        purpose,
        requestId: requiredText(request.requestId)
      },
      perform: callback
    });
    if (result.status !== 'AUTHORIZED_AND_COMMITTED') throw fail('HFM_SOCIAL_POST_OPERATION_NOT_COMMITTED');
    return result.value;
  }

  function sendError(res, error) {
    return res.status(statusForError(error)).json({
      ok: false,
      code: error && error.code || 'HFM_SOCIAL_POST_REQUEST_FAILED'
    });
  }

  app.get('/api/hfm/social-posts', requireAgentAuth, async (req, res) => {
    try {
      const projectId = requiredText(req.query.projectId);
      const value = await perform(req, req.query, 'memory.read',
        'memory:project:' + projectId, PURPOSES.LIST,
        async (client, context) => {
          if (context.actorId !== context.projectOwnerActorId) {
            throw fail('HFM_SOCIAL_POST_PROJECT_OWNER_READ_REQUIRED');
          }
          return workflow.listSocialPostDrafts({
            client, context, limit: Number(req.query.limit) || 25,
            allowPrivateRead: true
          });
        });
      return res.json({ ok: true, ...value });
    } catch (error) { return sendError(res, error); }
  });

  app.get('/api/hfm/social-posts/:memoryId', requireAgentAuth, async (req, res) => {
    try {
      const memoryId = requiredText(req.params.memoryId, 128);
      const projectId = requiredText(req.query.projectId);
      const value = await perform(req, req.query, 'memory.read',
        'memory:' + memoryId, PURPOSES.STATUS,
        (client, context) => workflow.getSocialPostStatus({ client, context, memoryId }));
      if (value.status === 'NOT_FOUND') return res.status(404).json({ ok: false, code: 'HFM_SOCIAL_POST_NOT_FOUND' });
      return res.json({ ok: true, ...value });
    } catch (error) { return sendError(res, error); }
  });

  app.post('/api/hfm/social-posts/:memoryId/copy', requireAgentAuth, async (req, res) => {
    try {
      const memoryId = requiredText(req.params.memoryId, 128);
      const projectId = requiredText(req.body && req.body.projectId);
      if (req.body.clipboardCopySucceeded !== true) throw fail('HFM_SOCIAL_POST_CLIPBOARD_CONFIRMATION_REQUIRED');
      const value = await perform(req, req.body, workflow.OPERATIONS.COPY,
        'memory:' + memoryId, PURPOSES.COPY,
        (client, context) => workflow.markSocialPostCopied({
          client, context, memoryId,
          idempotencyKey: requiredText(req.body.idempotencyKey)
        }));
      return res.json({ ok: true, ...value });
    } catch (error) { return sendError(res, error); }
  });

  app.post('/api/hfm/social-posts/:memoryId/published', requireAgentAuth, async (req, res) => {
    try {
      const memoryId = requiredText(req.params.memoryId, 128);
      requiredText(req.body && req.body.projectId);
      const value = await perform(req, req.body, workflow.OPERATIONS.PUBLISH,
        'memory:' + memoryId, PURPOSES.PUBLISH,
        (client, context) => workflow.confirmSocialPostPublished({
          client, context, memoryId,
          idempotencyKey: requiredText(req.body.idempotencyKey),
          userConfirmedPublished: req.body.userConfirmedPublished === true
        }));
      return res.json({ ok: true, ...value });
    } catch (error) { return sendError(res, error); }
  });

  app.delete('/api/hfm/social-posts/:memoryId', requireAgentAuth, async (req, res) => {
    try {
      const memoryId = requiredText(req.params.memoryId, 128);
      requiredText(req.body && req.body.projectId);
      const value = await perform(req, req.body, workflow.OPERATIONS.DELETE,
        'memory:' + memoryId, PURPOSES.DELETE,
        (client, context) => workflow.deleteSocialPostPayload({
          client, context, memoryId,
          idempotencyKey: requiredText(req.body.idempotencyKey),
          userConfirmedDelete: req.body.userConfirmedDelete === true
        }));
      return res.json({ ok: true, ...value });
    } catch (error) { return sendError(res, error); }
  });
}

module.exports = registerMiraHfmSocialPostRoutes;
