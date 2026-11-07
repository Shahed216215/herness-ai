'use strict';

const { sameOriginRequest } = require('./mira-hfm-authority-approval');
const { approveAndIssueMemoryOperationAuthority } = require('../services/mira-hfm-authority-approval');
const { executeWithConsumedAuthority } = require('../services/mira-hfm-authority-transaction');
const { retrieveProjectMemory } = require('../services/mira-hfm-authorized-memory-reader');
const { buildDailyKnowledgePost, saveDailyKnowledgePost } = require('../services/mira-hfm-daily-knowledge-post');

function localDateInTimeZone(date, timeZone) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone, year: 'numeric', month: '2-digit', day: '2-digit'
  }).formatToParts(date);
  const map = Object.fromEntries(parts.map(part => [part.type, part.value]));
  return map.year + '-' + map.month + '-' + map.day;
}

function registerMiraHfmDailySocialDraftRoute(
  app, getReaderRuntime, getWriterRuntime, getIssuerRuntime, requireAdmin,
  issueAuthority = approveAndIssueMemoryOperationAuthority,
  readMemory = retrieveProjectMemory,
  executeAuthority = executeWithConsumedAuthority,
  buildDraft = buildDailyKnowledgePost,
  saveDraft = saveDailyKnowledgePost
) {
  if (!app || typeof app.post !== 'function' ||
      typeof getReaderRuntime !== 'function' || typeof getWriterRuntime !== 'function' ||
      typeof getIssuerRuntime !== 'function' || typeof requireAdmin !== 'function' ||
      typeof issueAuthority !== 'function' || typeof readMemory !== 'function' ||
      typeof executeAuthority !== 'function' || typeof buildDraft !== 'function' ||
      typeof saveDraft !== 'function') {
    throw new TypeError('HFM_DAILY_SOCIAL_DRAFT_ROUTE_DEPENDENCIES_REQUIRED');
  }

  app.post('/api/hfm/social-drafts/generate-daily', requireAdmin, async (req, res) => {
    if (!req.get || !req.get('origin') || !sameOriginRequest(req)) {
      return res.status(403).json({ success: false, error: 'Same-origin request required.' });
    }
    if (!req.session || req.session.authenticated !== true ||
        req.session.role !== 'admin' || req.role !== 'admin' ||
        !req.session.hfmPrincipal) {
      return res.status(401).json({ success: false, error: 'Verified admin session required.' });
    }
    const binding = req.session.hfmProjectBinding;
    if (!binding || binding.verified !== true ||
        typeof binding.projectId !== 'string' || !binding.projectId.trim()) {
      return res.status(403).json({ success: false, error: 'Verified selected HFM project required.' });
    }
    const body = req.body || {};
    if (body.confirm !== true) {
      return res.status(400).json({ success: false, error: 'Explicit confirmation is required to generate and save a private daily post draft.' });
    }
    const timeZone = body.timeZone === undefined ? 'Asia/Dhaka' : body.timeZone;
    if (timeZone !== 'Asia/Dhaka') {
      return res.status(400).json({ success: false, error: 'Daily post timezone must remain Asia/Dhaka for this workflow.' });
    }

    try {
      const [reader, writer, issuer] = await Promise.all([
        getReaderRuntime(), getWriterRuntime(), getIssuerRuntime()
      ]);
      if (!reader || reader.status !== 'MEMORY_READ_READY' ||
          !reader.pool || typeof reader.pool.connect !== 'function') {
        return res.status(503).json({ success: false, error: 'HFM Memory reader is not ready.' });
      }
      if (!writer || writer.status !== 'MEMORY_WRITER_READY' ||
          !writer.pool || typeof writer.pool.connect !== 'function') {
        return res.status(503).json({ success: false, error: 'HFM Memory writer is not ready.' });
      }
      if (!issuer || issuer.status !== 'AUTHORITY_ISSUER_READY' ||
          !issuer.pool || typeof issuer.pool.connect !== 'function') {
        return res.status(503).json({ success: false, error: 'HFM authority issuer is not ready.' });
      }

      const projectId = binding.projectId;
      const now = new Date().toISOString();
      const localDate = localDateInTimeZone(new Date(now), timeZone);
      const readPurpose = 'Read active daily activity and learning notes to prepare the approved daily social draft.';
      const readAuthority = await issueAuthority({
        req, pool: issuer.pool, env: process.env,
        operation: 'memory.read',
        resource: 'memory:project:' + projectId,
        purpose: readPurpose,
        approvalConfirmed: true
      });
      if (!readAuthority || readAuthority.status !== 'AUTHORITY_ISSUED' ||
          readAuthority.operation !== 'memory.read' ||
          readAuthority.resource !== 'memory:project:' + projectId ||
          readAuthority.projectId !== projectId || !readAuthority.grant) {
        return res.status(503).json({ success: false, error: 'Daily source-read authority was not verified.' });
      }

      const sourceResult = await readMemory({
        pool: reader.pool,
        req,
        authorityGrant: readAuthority.grant,
        limit: 100,
        lifecycle: 'ACTIVE',
        recordTypes: ['daily_activity', 'learning_note'],
        env: process.env
      });
      const generated = buildDraft({
        projectId,
        localDate,
        timeZone,
        records: sourceResult.records,
        now
      });
      if (!generated || generated.status !== 'DRAFT_READY' || !generated.draft) {
        return res.json({
          success: true,
          status: generated && generated.status ? generated.status : 'NO_DAILY_SOURCE_RECORDS',
          projectId,
          localDate,
          sourceCounts: generated && generated.sourceCounts ? generated.sourceCounts : { activities: 0, learnings: 0 },
          draftSaved: false,
          autoPublish: false
        });
      }

      const resource = 'memory:' + generated.draft.memoryId;
      const writePurpose = 'Save a private daily social_post_draft for manual review and Facebook publication.';
      const writeAuthority = await issueAuthority({
        req, pool: issuer.pool, env: process.env,
        operation: 'memory.write',
        resource,
        purpose: writePurpose,
        approvalConfirmed: true
      });
      if (!writeAuthority || writeAuthority.status !== 'AUTHORITY_ISSUED' ||
          writeAuthority.operation !== 'memory.write' || writeAuthority.resource !== resource ||
          writeAuthority.projectId !== projectId || !writeAuthority.grant) {
        return res.status(503).json({ success: false, error: 'Daily draft write authority was not verified.' });
      }

      const committed = await executeAuthority({
        pool: writer.pool,
        verifiedPrincipal: req.session.hfmPrincipal,
        request: {
          authorityId: writeAuthority.grant.authorityId,
          projectId,
          operation: 'memory.write',
          resource,
          purpose: writeAuthority.grant.purpose,
          requestId: writeAuthority.grant.requestId
        },
        perform: (client, context) => saveDraft({
          client, context, projectId, localDate, timeZone,
          records: sourceResult.records, now,
          allowPrivateWrite: true,
          env: process.env
        })
      });
      if (!committed || committed.status !== 'AUTHORIZED_AND_COMMITTED' ||
          !committed.value || !committed.value.saved ||
          !['CREATED', 'ALREADY_COMMITTED'].includes(committed.value.saved.status)) {
        return res.status(503).json({ success: false, error: 'Daily draft commit is not confirmed.' });
      }
      return res.status(201).json({
        success: true,
        status: committed.value.saved.status,
        projectId,
        localDate,
        memoryId: committed.value.draft.memoryId,
        sourceCounts: committed.value.sourceCounts,
        draftSaved: true,
        lifecycle: 'ACTIVE',
        classification: 'PROJECT_PRIVATE',
        manualReviewRequired: true,
        autoPublish: false
      });
    } catch (error) {
      const code = typeof error?.code === 'string' ? error.code : 'HFM_DAILY_SOCIAL_DRAFT_FAILED';
      const status = /TRUSTED|SCOPE|OPERATION_NOT_GRANTED|AUTHORITY/.test(code) ? 403 : 503;
      return res.status(status).json({ success: false, error: code });
    }
  });
}

module.exports = Object.freeze({ registerMiraHfmDailySocialDraftRoute, localDateInTimeZone });
