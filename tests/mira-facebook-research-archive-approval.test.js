'use strict';

const assert = require('node:assert/strict');
const {
  CONFIRMATION,
  archiveResearchEvidenceWithHumanApproval
} = require('../services/mira-facebook-research-archive-approval');
const registerRoutes = require('../routes/mira-facebook-research-archive');

const pageId = '118056109579206';
const evidence = [{
  pageId,
  evidenceId: 'fbweb-evidence-001',
  sourceUrl: 'https://www.facebook.com/' + pageId + '/posts/555001',
  title: 'Synthetic public Page post',
  snippet: 'Synthetic untrusted evidence.',
  sourceType: 'FACEBOOK_PAGE_POST',
  identityBinding: 'PAGE_ID_PRESENT_IN_INDEXED_RESULT',
  trustStatus: 'SOURCE_RECORDED',
  integrityStatus: 'UNVERIFIED',
  lifecycle: 'PENDING_REVIEW',
  observedAt: '2026-11-05T00:00:00.000Z',
  publishedAt: null
}];

(async () => {
  let authorizeCalls = 0, auditCalls = 0, archiveCalls = 0;
  const authorize = async input => {
    authorizeCalls++;
    assert.equal(input.operation, 'file_modify');
    assert.equal(input.permissionGranted, true);
    assert.equal(input.approved, true);
    return { result: { allowed: true } };
  };
  const audit = input => {
    auditCalls++;
    assert.equal(input.resource, 'facebook_research_archive');
  };
  const archiveEvidence = async input => {
    archiveCalls++;
    assert.equal(input.pageId, pageId);
    assert.equal(input.evidence.length, 1);
    return {
      status: 'ARCHIVE_WRITE_VERIFIED',
      storedCount: 1,
      duplicateCount: 0,
      canonicalMemoryWrite: false
    };
  };

  await assert.rejects(
    () => archiveResearchEvidenceWithHumanApproval({
      actor: 'admin', confirmed: false, pageId, evidence,
      authorize, audit, archiveEvidence
    }),
    error => error.code === 'RESEARCH_ARCHIVE_CONFIRMATION_REQUIRED'
  );
  await assert.rejects(
    () => archiveResearchEvidenceWithHumanApproval({
      actor: '', confirmed: true, pageId, evidence,
      authorize, audit, archiveEvidence
    }),
    error => error.code === 'RESEARCH_ARCHIVE_ACTOR_REQUIRED'
  );
  assert.equal(authorizeCalls, 0);
  assert.equal(auditCalls, 0);
  assert.equal(archiveCalls, 0);

  const denied = await assert.rejects(
    () => archiveResearchEvidenceWithHumanApproval({
      actor: 'named-admin', confirmed: true, pageId, evidence,
      authorize: async () => ({ result: { allowed: false } }),
      audit, archiveEvidence
    }),
    error => error.code === 'RESEARCH_ARCHIVE_POLICY_DENIED'
  );
  assert.equal(archiveCalls, 0);

  const success = await archiveResearchEvidenceWithHumanApproval({
    actor: 'named-admin', confirmed: true, pageId, evidence,
    authorize, audit, archiveEvidence
  });
  assert.equal(success.status, 'ARCHIVE_WRITE_VERIFIED');
  assert.equal(success.storedCount, 1);
  assert.equal(success.canonicalMemoryWrite, false);
  assert.equal(success.mayEnterTrustedMemory, false);
  assert.equal(authorizeCalls, 1);
  assert.equal(auditCalls, 2);
  assert.equal(archiveCalls, 1);

  let blockedWriteCalls = 0;
  await assert.rejects(
    () => archiveResearchEvidenceWithHumanApproval({
      actor: 'named-admin', confirmed: true, pageId, evidence,
      authorize, audit: () => { throw new Error('audit unavailable'); },
      archiveEvidence: async () => { blockedWriteCalls++; }
    }),
    /audit unavailable/
  );
  assert.equal(blockedWriteCalls, 0);

  let auditIncompleteCalls = 0;
  const auditIncomplete = await archiveResearchEvidenceWithHumanApproval({
    actor: 'named-admin', confirmed: true, pageId, evidence,
    authorize,
    audit: () => {
      auditIncompleteCalls++;
      if (auditIncompleteCalls === 2) throw new Error('audit result unavailable');
    },
    archiveEvidence
  });
  assert.equal(auditIncomplete.status, 'ARCHIVE_WRITE_VERIFIED_AUDIT_INCOMPLETE');
  assert.equal(auditIncomplete.stateCommitted, true);
  assert.equal(auditIncomplete.canonicalMemoryWrite, false);

  let routeHandler;
  const app = {
    post(path, middleware, handler) {
      assert.equal(path, '/api/admin/facebook-research-archive/import');
      assert.equal(typeof middleware, 'function');
      routeHandler = handler;
    }
  };
  registerRoutes(
    app,
    () => (req, res, next) => next(),
    { SYSTEM_ADMIN: 'SYSTEM_ADMIN' },
    { archiveApproved: async input => ({
      status: 'ARCHIVE_WRITE_VERIFIED',
      pageId: input.pageId,
      storedCount: input.evidence.length,
      duplicateCount: 0,
      canonicalMemoryWrite: false
    }) }
  );
  const response = () => ({
    code: 200,
    body: null,
    status(value) { this.code = value; return this; },
    json(value) { this.body = value; return this; }
  });
  const noSession = response();
  await routeHandler({ session: null, body: { confirmArchiveImport: CONFIRMATION } }, noSession);
  assert.equal(noSession.code, 403);
  assert.equal(noSession.body.code, 'NAMED_ADMIN_BROWSER_SESSION_REQUIRED');

  const noConfirm = response();
  await routeHandler({
    session: { authenticated: true, role: 'admin', username: 'named-admin' },
    body: { pageId, evidence }
  }, noConfirm);
  assert.equal(noConfirm.code, 403);
  assert.equal(noConfirm.body.code, 'RESEARCH_ARCHIVE_CONFIRMATION_REQUIRED');

  const routeSuccess = response();
  await routeHandler({
    session: { authenticated: true, role: 'admin', username: 'named-admin' },
    body: { pageId, evidence, confirmArchiveImport: CONFIRMATION }
  }, routeSuccess);
  assert.equal(routeSuccess.code, 200);
  assert.equal(routeSuccess.body.status, 'ARCHIVE_WRITE_VERIFIED');

  console.log('HFM_PHASE6_ARCHIVE_REQUIRES_NAMED_ADMIN_SESSION=PASS');
  console.log('HFM_PHASE6_ARCHIVE_REQUIRES_EXPLICIT_CONFIRMATION=PASS');
  console.log('HFM_PHASE6_ARCHIVE_GLOBAL_POLICY_AND_AUDIT=PASS');
  console.log('HFM_PHASE6_ARCHIVE_UNTRUSTED_ONLY_NO_CANONICAL_WRITE=PASS');
  console.log('HFM_PHASE6_ARCHIVE_AUDIT_FAILURE_BLOCKS_WRITE=PASS');
  console.log('HFM_PHASE6_ARCHIVE_POSTWRITE_AUDIT_FAILURE_REPORTED=PASS');
  console.log('LIVE_NETWORK_REQUESTS=0');
  console.log('TESTS_FAILED=0');
})().catch(error => {
  process.stderr.write(error.stack + '\n');
  process.exitCode = 1;
});
