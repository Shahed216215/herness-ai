'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const registry = require('../services/mira-hfm-test-registry');

const now = '2026-11-04T00:00:00.000Z';
const sha = 'a'.repeat(40);
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mira-hfm-registry-'));
const audit = [];
const auditWriter = event => audit.push(event);
function definition(version = 1) {
  return {
    registrySchemaVersion: '1.0.0', testId: 'MIRA-HFM-TST-MEMORY-0001',
    testDefinitionVersion: version, title: 'Memory read isolation',
    requirementIds: ['HFM-R-001'], sourceSections: ['Phase 2 / Memory'],
    objective: 'Prove project scoped read isolation.', fixtureId: 'fixture-memory-001',
    preconditions: ['Synthetic fixture only'], setup: ['Create isolated temporary directory'],
    action: 'Read records under one project scope.', failureInjection: ['Wrong project id'],
    expectedResult: 'Cross-project records are excluded.',
    prohibitedSideEffects: ['No production data access', 'No network request'],
    executionEnvironment: { runtime: 'Node.js 22', operatingSystem: 'Linux CI' },
    evidencePolicy: { required: true, minimumArtifacts: 1 },
    approvalState: 'APPROVED', createdAt: now, createdBy: 'ci-fixture', sourceCommit: sha
  };
}
function execution(id, status = 'TESTED_PASS') {
  const item = {
    executionId: id, testId: 'MIRA-HFM-TST-MEMORY-0001', testDefinitionVersion: 1,
    executionStatus: status, expectedResult: 'Cross-project records excluded.',
    actualResult: status === 'TESTED_PASS' ? 'Cross-project records excluded.' : 'No execution evidence.',
    evidenceReference: 'ci://fixture/log.txt', sourceCommit: sha, workflowRunId: 'run-001',
    jobId: 'job-001', runtime: 'Node.js 22', operatingSystem: 'Linux CI',
    startedAt: now, completedAt: now, executor: 'github-actions', verifier: 'isolated-fixture-review',
    productionDataTouched: false, networkRequests: 0, externalActions: 0,
    limitations: [], recordedAt: now
  };
  if (status === 'INCONCLUSIVE' || status === 'REVIEW_REQUIRED' || status === 'NOT_APPROVED') {
    item.statusReason = 'Synthetic fixture did not establish a pass.';
  }
  if (status === 'NOT_APPLICABLE') {
    item.notApplicableRationale = 'Not applicable to synthetic fixture.';
    item.reviewer = 'reviewer-fixture';
  }
  return item;
}
try {
  const def = definition();
  assert.deepEqual(registry.validateDefinition(def), []);
  registry.appendDefinition({ root, definition: def, auditWriter });
  console.log('CANONICAL_TEST_DEFINITION_APPEND=PASS');
  assert.throws(() => registry.appendDefinition({ root, definition: def, auditWriter }), /already exists/);
  console.log('DEFINITION_VERSION_IMMUTABLE=PASS');

  const validExecution = execution('exec-001');
  assert.deepEqual(registry.validateExecutionRecord(validExecution), []);
  registry.appendExecution({ root, execution: validExecution, auditWriter });
  console.log('EXECUTION_REQUIRES_REGISTERED_DEFINITION=PASS');
  assert.throws(() => registry.appendExecution({ root, execution: validExecution, auditWriter }), /already exists/);
  console.log('EXECUTION_RECORD_APPEND_ONLY=PASS');
  const noJob = { ...validExecution, executionId: 'exec-no-job' };
  delete noJob.jobId;
  assert.ok(registry.validateExecutionRecord(noJob).includes('CI_JOB_ID_REQUIRED'));
  console.log('CI_EXECUTION_REQUIRES_JOB_ID=PASS');
  assert.throws(() => registry.appendExecution({
    root, execution: { ...validExecution, executionId: 'exec-unknown', testId: 'MIRA-HFM-TST-STATE-0009' }, auditWriter
  }), /unknown test definition/);
  console.log('UNKNOWN_TEST_REFERENCE_REJECTED=PASS');
  assert.throws(() => registry.appendExecution({
    root, execution: { ...validExecution, executionId: 'exec-bad', executionStatus: 'PASS' }, auditWriter
  }), /EXECUTION_STATUS_INVALID/);
  console.log('UNKNOWN_EXECUTION_STATUS_REJECTED=PASS');

  const alias = {
    aliasId: 'legacy-test-memory-read', canonicalTestId: def.testId,
    historicalMeaning: 'Legacy memory read isolation test',
    sourceDocument: 'legacy-test-catalog.txt', sourceCommit: sha,
    mappingRationale: 'Reviewed one-to-one semantic match.',
    reviewedBy: 'reviewer-fixture', reviewedAt: now
  };
  registry.appendAlias({ root, alias, auditWriter });
  console.log('HISTORICAL_ALIAS_APPEND=PASS');
  assert.throws(() => registry.appendAlias({ root, alias: { ...alias, canonicalTestId: 'MIRA-HFM-TST-STATE-0009' }, auditWriter }), /target canonical test does not exist/);
  console.log('UNKNOWN_ALIAS_TARGET_REJECTED=PASS');
  assert.throws(() => registry.appendAlias({ root, alias, auditWriter }), /already has an owner/);
  console.log('DUPLICATE_ALIAS_OWNER_REJECTED=PASS');

  const definitions = registry.listRecords(root, 'definitions');
  const executions = registry.listRecords(root, 'executions');
  assert.equal(registry.aggregateRequirementCoverage({
    requirementId: 'HFM-R-001', mandatoryTestIds: [def.testId],
    definitions, executions
  }).status, 'PASS');
  console.log('ALL_MANDATORY_TESTS_PASS_AGGREGATION=PASS');

  const notExecuted = registry.aggregateRequirementCoverage({
    requirementId: 'HFM-R-001', mandatoryTestIds: [def.testId, 'MIRA-HFM-TST-STATE-0009'],
    definitions, executions
  });
  assert.equal(notExecuted.status, 'REVIEW_REQUIRED');
  assert.ok(notExecuted.statuses.some(x => x.status === 'REVIEW_REQUIRED'));
  console.log('MISSING_TEST_NEVER_AGGREGATES_TO_PASS=PASS');

  const inconclusive = registry.aggregateRequirementCoverage({
    requirementId: 'HFM-R-001', mandatoryTestIds: [def.testId],
    definitions, executions: [execution('exec-inconclusive', 'INCONCLUSIVE')]
  });
  assert.equal(inconclusive.status, 'REVIEW_REQUIRED');
  console.log('INCONCLUSIVE_NEVER_AGGREGATES_TO_PASS=PASS');

  const failed = registry.aggregateRequirementCoverage({
    requirementId: 'HFM-R-001', mandatoryTestIds: [def.testId],
    definitions, executions: [execution('exec-fail', 'TESTED_FAIL')]
  });
  assert.equal(failed.status, 'FAIL');
  console.log('TESTED_FAIL_AGGREGATES_TO_FAIL=PASS');

  const notRun = registry.aggregateRequirementCoverage({
    requirementId: 'HFM-R-001', mandatoryTestIds: [def.testId],
    definitions, executions: [execution('exec-not-run', 'NOT_EXECUTED')]
  });
  assert.equal(notRun.status, 'REVIEW_REQUIRED');
  console.log('NOT_EXECUTED_NEVER_AGGREGATES_TO_PASS=PASS');

  const notApplicable = registry.aggregateRequirementCoverage({
    requirementId: 'HFM-R-001', mandatoryTestIds: [def.testId],
    definitions, executions: [execution('exec-na', 'NOT_APPLICABLE')]
  });
  assert.equal(notApplicable.status, 'REVIEW_REQUIRED');
  const approvedNotApplicable = registry.aggregateRequirementCoverage({
    requirementId: 'HFM-R-001', mandatoryTestIds: [def.testId],
    definitions, executions: [execution('exec-na-approved', 'NOT_APPLICABLE')],
    approvedNotApplicable: [def.testId]
  });
  assert.equal(approvedNotApplicable.status, 'PASS');
  console.log('NOT_APPLICABLE_REQUIRES_REVIEW_APPROVAL=PASS');

  const unapprovedDefinition = { ...def, testDefinitionVersion: 2, approvalState: 'NOT_APPROVED' };
  registry.appendDefinition({ root, definition: unapprovedDefinition, auditWriter });
  assert.throws(() => registry.appendExecution({
    root, execution: { ...execution('exec-unapproved'), testDefinitionVersion: 2 }, auditWriter
  }), /unapproved test definition/);
  const unapprovedCoverage = registry.aggregateRequirementCoverage({
    requirementId: 'HFM-R-001', mandatoryTestIds: [def.testId],
    definitions: registry.listRecords(root, 'definitions'), executions
  });
  assert.equal(unapprovedCoverage.status, 'REVIEW_REQUIRED');
  console.log('UNAPPROVED_DEFINITION_CANNOT_EXECUTE_OR_PASS=PASS');

  assert.ok(registry.validateDefinition({ ...def, unexpected: true }).includes('DEFINITION_FIELDS_INVALID'));
  console.log('STRICT_SCHEMA_ADDITIONAL_FIELD_REJECTED=PASS');

  assert.ok(audit.some(x => x.action === 'hfm_test_registry_append_intent'));
  assert.ok(audit.some(x => x.action === 'hfm_test_registry_append_committed'));
  console.log('APPEND_AUDIT_INTENT_AND_COMMIT=PASS');

  console.log('TESTS_FAILED=0');
  console.log('RESULT=MIRA_HFM_CANONICAL_TEST_REGISTRY_ISOLATED_PASS');
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}
