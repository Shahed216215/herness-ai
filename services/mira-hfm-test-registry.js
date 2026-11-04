'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { isCanonicalTimestamp } = require('./mira-hfm-timestamp-profile');

const EXECUTION_STATUSES = new Set([
  'TESTED_PASS', 'TESTED_FAIL', 'INCONCLUSIVE', 'NOT_APPROVED',
  'REVIEW_REQUIRED', 'NOT_APPLICABLE', 'NOT_EXECUTED'
]);
const APPROVAL_STATES = new Set(['APPROVED', 'REVIEW_REQUIRED', 'NOT_APPROVED']);
const DEFINITION_REQUIRED = [
  'registrySchemaVersion', 'testId', 'testDefinitionVersion', 'title',
  'requirementIds', 'sourceSections', 'objective', 'fixtureId',
  'preconditions', 'setup', 'action', 'failureInjection', 'expectedResult',
  'prohibitedSideEffects', 'executionEnvironment', 'evidencePolicy',
  'approvalState', 'createdAt', 'createdBy', 'sourceCommit'
];
const DEFINITION_OPTIONAL = ['supersedesTestId', 'tags', 'notes', 'knownLimitations', 'aliasIds'];
const EXECUTION_REQUIRED = [
  'executionId', 'testId', 'testDefinitionVersion', 'executionStatus',
  'expectedResult', 'actualResult', 'evidenceReference', 'sourceCommit',
  'runtime', 'operatingSystem', 'startedAt', 'completedAt', 'executor',
  'verifier', 'productionDataTouched', 'networkRequests', 'externalActions',
  'limitations', 'recordedAt'
];
const EXECUTION_OPTIONAL = ['workflowRunId', 'localRunId', 'jobId', 'statusReason', 'notApplicableRationale', 'reviewer'];
const ALIAS_REQUIRED = [
  'aliasId', 'canonicalTestId', 'historicalMeaning', 'sourceDocument',
  'sourceCommit', 'mappingRationale', 'reviewedBy', 'reviewedAt'
];
const ALIAS_OPTIONAL = [];

function isPlainObject(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}
function exactKeys(value, required, optional = []) {
  if (!isPlainObject(value)) return false;
  const allowed = new Set([...required, ...optional]);
  return required.every(key => Object.prototype.hasOwnProperty.call(value, key)) &&
    Object.keys(value).every(key => allowed.has(key));
}
function nonEmpty(value) {
  return typeof value === 'string' && value.trim().length > 0;
}
function isCommit(value) {
  return typeof value === 'string' && /^[a-f0-9]{40}$/.test(value);
}
function validateDefinition(definition) {
  const errors = [];
  if (!exactKeys(definition, DEFINITION_REQUIRED, DEFINITION_OPTIONAL)) return ['DEFINITION_FIELDS_INVALID'];
  if (definition.registrySchemaVersion !== '1.0.0') errors.push('REGISTRY_SCHEMA_VERSION_INVALID');
  if (!/^MIRA-HFM-TST-[A-Z0-9]+-\d{4}$/.test(definition.testId || '')) errors.push('TEST_ID_INVALID');
  if (!Number.isInteger(definition.testDefinitionVersion) || definition.testDefinitionVersion < 1) errors.push('TEST_DEFINITION_VERSION_INVALID');
  for (const field of ['title', 'objective', 'fixtureId', 'action', 'expectedResult', 'createdBy']) {
    if (!nonEmpty(definition[field])) errors.push(field.toUpperCase() + '_REQUIRED');
  }
  for (const field of ['requirementIds', 'sourceSections', 'preconditions', 'setup', 'failureInjection', 'prohibitedSideEffects']) {
    if (!Array.isArray(definition[field])) errors.push(field.toUpperCase() + '_MUST_BE_ARRAY');
  }
  for (const field of ['requirementIds', 'sourceSections']) {
    if (!Array.isArray(definition[field]) || definition[field].length === 0 || definition[field].some(item => !nonEmpty(item))) {
      errors.push(field.toUpperCase() + '_MUST_BE_NONEMPTY_STRINGS');
    }
  }
  if (!isPlainObject(definition.executionEnvironment)) errors.push('EXECUTION_ENVIRONMENT_INVALID');
  if (!isPlainObject(definition.evidencePolicy) || typeof definition.evidencePolicy.required !== 'boolean') errors.push('EVIDENCE_POLICY_INVALID');
  if (!APPROVAL_STATES.has(definition.approvalState)) errors.push('APPROVAL_STATE_INVALID');
  if (!isCanonicalTimestamp(definition.createdAt)) errors.push('CREATED_AT_NONCANONICAL');
  if (!isCommit(definition.sourceCommit)) errors.push('SOURCE_COMMIT_INVALID');
  if (definition.supersedesTestId !== undefined && !/^MIRA-HFM-TST-[A-Z0-9]+-\d{4}$/.test(definition.supersedesTestId)) errors.push('SUPERSEDES_TEST_ID_INVALID');
  return errors;
}
function validateExecutionRecord(record) {
  const errors = [];
  if (!exactKeys(record, EXECUTION_REQUIRED, EXECUTION_OPTIONAL)) return ['EXECUTION_FIELDS_INVALID'];
  if (!nonEmpty(record.executionId)) errors.push('EXECUTION_ID_REQUIRED');
  if (!/^MIRA-HFM-TST-[A-Z0-9]+-\d{4}$/.test(record.testId || '')) errors.push('TEST_ID_INVALID');
  if (!Number.isInteger(record.testDefinitionVersion) || record.testDefinitionVersion < 1) errors.push('TEST_DEFINITION_VERSION_INVALID');
  if (!EXECUTION_STATUSES.has(record.executionStatus)) errors.push('EXECUTION_STATUS_INVALID');
  for (const field of ['expectedResult', 'actualResult', 'evidenceReference', 'runtime', 'operatingSystem', 'executor', 'verifier']) {
    if (!nonEmpty(record[field])) errors.push(field.toUpperCase() + '_REQUIRED');
  }
  if (!isCommit(record.sourceCommit)) errors.push('SOURCE_COMMIT_INVALID');
  if (!isCanonicalTimestamp(record.startedAt) || !isCanonicalTimestamp(record.completedAt) ||
      !isCanonicalTimestamp(record.recordedAt) || record.completedAt < record.startedAt) {
    errors.push('EXECUTION_TIMESTAMPS_INVALID');
  }
  if (typeof record.productionDataTouched !== 'boolean') errors.push('PRODUCTION_DATA_DECLARATION_REQUIRED');
  if (!Number.isInteger(record.networkRequests) || record.networkRequests < 0) errors.push('NETWORK_REQUEST_COUNT_INVALID');
  if (!Number.isInteger(record.externalActions) || record.externalActions < 0) errors.push('EXTERNAL_ACTION_COUNT_INVALID');
  if (!Array.isArray(record.limitations)) errors.push('LIMITATIONS_MUST_BE_ARRAY');
  if (!nonEmpty(record.workflowRunId) && !nonEmpty(record.localRunId)) errors.push('RUN_IDENTIFIER_REQUIRED');
  if (nonEmpty(record.workflowRunId) && nonEmpty(record.localRunId)) errors.push('RUN_IDENTIFIER_AMBIGUOUS');
  if (nonEmpty(record.workflowRunId) && !nonEmpty(record.jobId)) errors.push('CI_JOB_ID_REQUIRED');
  if (isCanonicalTimestamp(record.completedAt) && isCanonicalTimestamp(record.recordedAt) && record.recordedAt < record.completedAt) errors.push('RECORDED_AT_PRECEDES_COMPLETION');
  if (record.executionStatus === 'TESTED_PASS' && (!nonEmpty(record.evidenceReference) || !isCommit(record.sourceCommit))) {
    errors.push('TESTED_PASS_EVIDENCE_REQUIRED');
  }
  if (record.executionStatus === 'NOT_APPLICABLE' &&
      (!nonEmpty(record.notApplicableRationale) || !nonEmpty(record.reviewer))) {
    errors.push('NOT_APPLICABLE_REVIEW_REQUIRED');
  }
  if (['INCONCLUSIVE', 'REVIEW_REQUIRED', 'NOT_APPROVED', 'NOT_EXECUTED'].includes(record.executionStatus) &&
      !nonEmpty(record.statusReason)) errors.push('STATUS_REASON_REQUIRED');
  return errors;
}
function validateAliasRecord(record) {
  const errors = [];
  if (!exactKeys(record, ALIAS_REQUIRED, ALIAS_OPTIONAL)) return ['ALIAS_FIELDS_INVALID'];
  if (!nonEmpty(record.aliasId) || !nonEmpty(record.canonicalTestId) ||
      !nonEmpty(record.historicalMeaning) || !nonEmpty(record.sourceDocument) ||
      !nonEmpty(record.mappingRationale) || !nonEmpty(record.reviewedBy)) errors.push('ALIAS_REQUIRED_FIELD_MISSING');
  if (!/^MIRA-HFM-TST-[A-Z0-9]+-\d{4}$/.test(record.canonicalTestId || '')) errors.push('ALIAS_TARGET_INVALID');
  if (!isCommit(record.sourceCommit)) errors.push('ALIAS_SOURCE_COMMIT_INVALID');
  if (!isCanonicalTimestamp(record.reviewedAt)) errors.push('ALIAS_REVIEW_TIMESTAMP_INVALID');
  return errors;
}
function sha256(value) {
  return crypto.createHash('sha256').update(value, 'utf8').digest('hex');
}
function safeCollectionDirectory(root, collection) {
  if (!['definitions', 'executions', 'aliases'].includes(collection)) throw new Error('Unsupported registry collection.');
  fs.mkdirSync(root, { recursive: true, mode: 0o700 });
  const rootStat = fs.lstatSync(root);
  if (rootStat.isSymbolicLink() || !rootStat.isDirectory()) throw new Error('Registry root is not a safe directory.');
  const directory = path.join(root, collection);
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  const stat = fs.lstatSync(directory);
  if (stat.isSymbolicLink() || !stat.isDirectory()) throw new Error('Registry collection is not a safe directory.');
  return directory;
}
function listRecords(root, collection) {
  const directory = safeCollectionDirectory(root, collection);
  return fs.readdirSync(directory).filter(name => name.endsWith('.json')).sort().map(name => {
    const file = path.join(directory, name);
    const stat = fs.lstatSync(file);
    if (stat.isSymbolicLink() || !stat.isFile()) throw new Error('Unsafe registry record file.');
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  });
}
function appendImmutable({ root, collection, key, record, auditWriter }) {
  if (typeof auditWriter !== 'function') throw new Error('Registry auditWriter is required.');
  if (!nonEmpty(key) || /[\\/]/.test(key) || key.includes('..')) throw new Error('Unsafe registry record key.');
  const directory = safeCollectionDirectory(root, collection);
  const target = path.join(directory, key + '.json');
  const payload = JSON.stringify(record, null, 2) + '\n';
  const recordDigest = sha256(payload);
  auditWriter({ action: 'hfm_test_registry_append_intent', collection, key, recordDigest });
  let fd;
  try {
    fd = fs.openSync(target, 'wx', 0o600);
    fs.writeFileSync(fd, payload, 'utf8');
    fs.fsyncSync(fd);
    fs.closeSync(fd);
    fd = undefined;
    const readback = fs.readFileSync(target, 'utf8');
    if (sha256(readback) !== recordDigest) throw new Error('Registry append readback digest mismatch.');
    auditWriter({ action: 'hfm_test_registry_append_committed', collection, key, recordDigest });
    return { ok: true, key, recordDigest };
  } catch (error) {
    if (fd !== undefined) { try { fs.closeSync(fd); } catch {} }
    if (error.code === 'EEXIST') throw new Error('Immutable registry record already exists.');
    if (fs.existsSync(target)) {
      error.stateCommitted = true;
      error.recordDigest = recordDigest;
    }
    throw error;
  }
}
function appendDefinition({ root, definition, auditWriter }) {
  const errors = validateDefinition(definition);
  if (errors.length) throw new Error('Invalid test definition: ' + errors.join('; '));
  const all = listRecords(root, 'definitions');
  const sameId = all.filter(item => item.testId === definition.testId);
  if (sameId.some(item => item.testDefinitionVersion === definition.testDefinitionVersion)) {
    throw new Error('Test definition version is immutable and already exists.');
  }
  if (definition.supersedesTestId && !all.some(item => item.testId === definition.supersedesTestId)) {
    throw new Error('Superseded test definition does not exist.');
  }
  const key = definition.testId + '__v' + definition.testDefinitionVersion;
  return appendImmutable({ root, collection: 'definitions', key, record: definition, auditWriter });
}
function appendExecution({ root, execution, auditWriter }) {
  const errors = validateExecutionRecord(execution);
  if (errors.length) throw new Error('Invalid execution record: ' + errors.join('; '));
  const definitions = listRecords(root, 'definitions');
  const definition = definitions.find(item => item.testId === execution.testId &&
      item.testDefinitionVersion === execution.testDefinitionVersion);
  if (!definition) throw new Error('Execution references an unknown test definition version.');
  if (['TESTED_PASS', 'TESTED_FAIL', 'INCONCLUSIVE'].includes(execution.executionStatus) &&
      definition.approvalState !== 'APPROVED') {
    throw new Error('Execution of an unapproved test definition is blocked.');
  }
  const key = execution.executionId;
  return appendImmutable({ root, collection: 'executions', key, record: execution, auditWriter });
}
function appendAlias({ root, alias, auditWriter }) {
  const errors = validateAliasRecord(alias);
  if (errors.length) throw new Error('Invalid alias record: ' + errors.join('; '));
  const definitions = listRecords(root, 'definitions');
  if (!definitions.some(item => item.testId === alias.canonicalTestId)) {
    throw new Error('Alias target canonical test does not exist.');
  }
  const aliases = listRecords(root, 'aliases');
  if (aliases.some(item => item.aliasId === alias.aliasId)) throw new Error('Historical alias already has an owner.');
  return appendImmutable({ root, collection: 'aliases', key: alias.aliasId, record: alias, auditWriter });
}
function aggregateRequirementCoverage({ requirementId, mandatoryTestIds, definitions, executions, approvedNotApplicable = [] }) {
  if (!nonEmpty(requirementId) || !Array.isArray(mandatoryTestIds) ||
      !Array.isArray(definitions) || !Array.isArray(executions) || !Array.isArray(approvedNotApplicable)) {
    throw new Error('Coverage inputs are invalid.');
  }
  const statuses = [];
  for (const testId of mandatoryTestIds) {
    const versions = definitions.filter(item => item.testId === testId &&
      Array.isArray(item.requirementIds) && item.requirementIds.includes(requirementId))
      .sort((a, b) => b.testDefinitionVersion - a.testDefinitionVersion);
    if (!versions.length) {
      statuses.push({ testId, status: 'REVIEW_REQUIRED', reason: 'MANDATORY_TEST_NOT_REGISTERED' });
      continue;
    }
    const definition = versions[0];
    if (definition.approvalState !== 'APPROVED') {
      statuses.push({ testId, status: 'REVIEW_REQUIRED', reason: 'TEST_DEFINITION_NOT_APPROVED' });
      continue;
    }
    const runs = executions.filter(item => item.testId === testId &&
      item.testDefinitionVersion === definition.testDefinitionVersion)
      .sort((a, b) => b.recordedAt.localeCompare(a.recordedAt));
    const latest = runs[0];
    if (!latest) {
      statuses.push({ testId, status: 'NOT_EXECUTED' });
      continue;
    }
    if (latest.executionStatus === 'NOT_APPLICABLE' &&
        approvedNotApplicable.includes(testId) &&
        nonEmpty(latest.notApplicableRationale) && nonEmpty(latest.reviewer)) {
      statuses.push({ testId, status: 'NOT_APPLICABLE_APPROVED' });
    } else {
      statuses.push({ testId, status: latest.executionStatus });
    }
  }
  const values = statuses.map(item => item.status);
  let status = 'PASS';
  if (values.includes('TESTED_FAIL')) status = 'FAIL';
  else if (values.some(value => value !== 'TESTED_PASS' && value !== 'NOT_APPLICABLE_APPROVED')) status = 'REVIEW_REQUIRED';
  return { requirementId, status, testCount: statuses.length, statuses };
}
module.exports = {
  EXECUTION_STATUSES, validateDefinition, validateExecutionRecord, validateAliasRecord,
  appendDefinition, appendExecution, appendAlias, listRecords, aggregateRequirementCoverage
};
