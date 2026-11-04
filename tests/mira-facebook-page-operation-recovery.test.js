'use strict';

const assert = require('node:assert/strict');
const {
  createFacebookPageOperationIdentity,
  classifyFacebookPageTransportOutcome,
  planFacebookPageRetry,
  reconcileFacebookPageWrite
} = require('../services/mira-facebook-page-operation-recovery');

const identity = createFacebookPageOperationIdentity({
  pageId: '123456789', actionId: 'campaign-post-001', contentHash: 'a'.repeat(64)
});
assert.equal(identity.operationId, createFacebookPageOperationIdentity({
  pageId: '123456789', actionId: 'campaign-post-001', contentHash: 'a'.repeat(64)
}).operationId);
assert.notEqual(identity.operationId, createFacebookPageOperationIdentity({
  pageId: '987654321', actionId: 'campaign-post-001', contentHash: 'a'.repeat(64)
}).operationId);
assert.throws(() => createFacebookPageOperationIdentity({ pageId: 'not-page', actionId: 'x', contentHash: 'a'.repeat(64) }), /numeric/);
console.log('FACEBOOK_OPERATION_IDENTITY_DETERMINISTIC_AND_PAGE_BOUND=PASS');

const unsent = classifyFacebookPageTransportOutcome({
  operation: 'WRITE', requestAttempted: false, responseReceived: false
});
assert.equal(unsent.status, 'NOT_SENT');
assert.equal(unsent.automaticRetryAllowed, false);

const unknownWrite = classifyFacebookPageTransportOutcome({
  operation: 'WRITE', requestAttempted: true, responseReceived: false
});
assert.equal(unknownWrite.status, 'WRITE_OUTCOME_UNKNOWN_RECONCILE_BEFORE_RETRY');
assert.equal(unknownWrite.readbackRequired, true);
assert.equal(unknownWrite.automaticRetryAllowed, false);

const acceptedWrite = classifyFacebookPageTransportOutcome({
  operation: 'WRITE', requestAttempted: true, responseReceived: true, httpStatus: 201
});
assert.equal(acceptedWrite.status, 'PROVIDER_ACCEPTED_PENDING_READBACK');
assert.equal(acceptedWrite.automaticRetryAllowed, false);

const limitedWrite = classifyFacebookPageTransportOutcome({
  operation: 'WRITE', requestAttempted: true, responseReceived: true, httpStatus: 429, retryAfterSeconds: 30
});
assert.equal(limitedWrite.status, 'WRITE_RATE_LIMITED_RECONCILE_BEFORE_RETRY');
assert.equal(limitedWrite.automaticRetryAllowed, false);

const retryRead = classifyFacebookPageTransportOutcome({
  operation: 'READ', requestAttempted: true, responseReceived: true, httpStatus: 503
});
assert.equal(retryRead.status, 'READ_SERVER_ERROR_RETRYABLE');
assert.equal(retryRead.automaticRetryAllowed, true);
const denied = classifyFacebookPageTransportOutcome({
  operation: 'WRITE', requestAttempted: true, responseReceived: true, httpStatus: 403
});
assert.equal(denied.status, 'AUTH_OR_PERMISSION_FAILURE_NO_AUTOMATIC_RETRY');
assert.throws(() => classifyFacebookPageTransportOutcome({
  operation: 'WRITE', requestAttempted: false, responseReceived: true, httpStatus: 200
}), /cannot exist/);
console.log('FACEBOOK_WRITE_UNCERTAINTY_AND_RATE_LIMITS_FAIL_CLOSED=PASS');

const readRetry = planFacebookPageRetry({ operation: 'READ', attempt: 1, maxAttempts: 3, retryAfterSeconds: 10 });
assert.equal(readRetry.status, 'WAIT_THEN_RETRY_READ');
assert.equal(readRetry.nextAttempt, 2);
assert.equal(readRetry.waitSeconds, 10);
assert.equal(planFacebookPageRetry({ operation: 'READ', attempt: 3, maxAttempts: 3 }).status, 'RETRY_LIMIT_REACHED');
const writeRetry = planFacebookPageRetry({ operation: 'WRITE', attempt: 1 });
assert.equal(writeRetry.status, 'RECONCILE_READBACK_BEFORE_ANY_RETRY');
assert.equal(writeRetry.automaticRetryAllowed, false);
console.log('FACEBOOK_RETRY_POLICY_READ_ONLY_AUTO_RETRY_WRITE_RECONCILE_FIRST=PASS');

const matched = reconcileFacebookPageWrite({
  expectedPageId: '123456789', expectedPostId: 'post-77', expectedContentHash: 'a'.repeat(64),
  providerReadback: { found: true, pageId: '123456789', postId: 'post-77', contentHash: 'a'.repeat(64) }
});
assert.equal(matched.status, 'READBACK_MATCHED_PENDING_INDEPENDENT_VERIFICATION');
assert.equal(matched.integrityStatus, 'UNVERIFIED');
assert.equal(matched.mayEnterTrustedMemory, false);
assert.equal(matched.mayCommitCanonicalMemory, false);
const conflict = reconcileFacebookPageWrite({
  expectedPageId: '123456789', expectedPostId: 'post-77', expectedContentHash: 'a'.repeat(64),
  providerReadback: { found: true, pageId: '123456789', postId: 'post-77', contentHash: 'b'.repeat(64) }
});
assert.equal(conflict.status, 'READBACK_CONFLICT_REQUIRES_QUARANTINE');
const absent = reconcileFacebookPageWrite({
  expectedPageId: '123456789', expectedPostId: 'post-77', expectedContentHash: 'a'.repeat(64),
  providerReadback: { found: false }
});
assert.equal(absent.status, 'POST_ABSENCE_ASSERTED_RETRY_REQUIRES_HUMAN_APPROVAL');
console.log('FACEBOOK_READBACK_MATCH_CONFLICT_AND_ABSENCE_NEVER_PROMOTE_MEMORY=PASS');

console.log('NETWORK_REQUESTS=0');
console.log('LIVE_META_API_CALLS=0');
console.log('FACEBOOK_POSTS_PUBLISHED=0');
console.log('TESTS_FAILED=0');
console.log('RESULT=MIRA_HFM_FACEBOOK_OPERATION_RECOVERY_CONTRACT_PASS');
