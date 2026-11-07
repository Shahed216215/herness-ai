'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const test = require('node:test');

const issuer = require('../services/mira-hfm-authority-issuer');
const issuerSource = fs.readFileSync(require.resolve('../services/mira-hfm-authority-issuer'), 'utf8');
const approvalRouteSource = fs.readFileSync(require.resolve('../routes/mira-hfm-authority-approval'), 'utf8');

test('one-time authority issuer is server-only and requires a verified consumed approval receipt', () => {
  assert.equal(typeof issuer.issueMemoryOperationAuthority, 'function');
  assert.equal(typeof issuer.validateApproval, 'function');
  assert.equal(Object.prototype.hasOwnProperty.call(issuer, 'registerHfmAuthorityRoutes'), false);
  assert.match(issuerSource, /validateApproval\(/);
  assert.match(issuerSource, /verifyApprovalToken/);
  assert.match(issuerSource, /consume:\s*true/);
  assert.match(issuerSource, /singleUse:\s*true/);
  assert.match(issuerSource, /maxUses !== 1/);
  assert.doesNotMatch(issuerSource, /req\.body\.actorId|req\.body\.userId|req\.body\.ownerActorId/);
  console.log('HFM_AUTHORITY_ISSUER_SERVER_ONLY_APPROVAL_RECEIPT_REQUIRED=PASS');
});

test('HTTP approval route is separate, authenticated and read-only', () => {
  assert.match(approvalRouteSource, /\/api\/hfm\/memory\/authorize/);
  assert.match(approvalRouteSource, /allowedOperations = \['memory\.read'\]/);
  assert.match(approvalRouteSource, /req\.session\.hfmProjectBinding\.projectId/);
  assert.match(approvalRouteSource, /authorityHeldServerSide:\s*true/);
  assert.doesNotMatch(approvalRouteSource, /body\.actorId|body\.userId|body\.ownerActorId/);
  assert.doesNotMatch(approvalRouteSource, /allowedOperations = \[[^\]]*memory\.write/);
  console.log('HFM_AUTHORITY_APPROVAL_ROUTE_READ_ONLY_AND_SERVER_BOUND=PASS');
});
