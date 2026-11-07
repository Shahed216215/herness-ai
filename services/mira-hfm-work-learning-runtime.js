'use strict';

const { retrieveProjectScopedWorkLearning } = require('./mira-hfm-work-learning-retrieval');
const { compareTimestampToNow, compareTimestamps } = require('./mira-hfm-timestamp');
const { PAGE_SIZE, MAX_STANDING_READ_PAGES } = require('./mira-hfm-standing-read-pages');

const MAX_MEMORY_SCAN = 100;

function fail(code) {
  const error = new Error(code);
  error.code = code;
  throw error;
}

function buildHfmAuthorizeRequest(hostContext, recordIds) {
  const allowedIds = new Set(recordIds);
  return input => {
    const baseValid = input &&
      input.actorId === hostContext.actorId &&
      input.actorType === 'HUMAN' &&
      input.projectId === hostContext.projectId &&
      input.purpose === hostContext.purpose &&
      input.requestId === hostContext.requestId &&
      input.authorityRef === hostContext.authorityRef;
    const resourceValid = input.operation === 'LIST'
      ? input.resourceScope === 'project:' + hostContext.projectId
      : input.operation === 'READ' &&
        typeof input.resourceScope === 'string' &&
        input.resourceScope.startsWith('memory:') &&
        allowedIds.has(input.resourceScope.slice('memory:'.length));
    const allowed = baseValid && resourceValid;
    return Object.freeze({
      decision: allowed ? 'ALLOW' : 'DENY',
      replayStatus: 'FRESH',
      actorId: hostContext.actorId,
      actorType: 'HUMAN',
      projectId: hostContext.projectId,
      purpose: hostContext.purpose,
      requestId: hostContext.requestId,
      operation: input.operation,
      resourceScope: input.resourceScope,
      authorityRef: hostContext.authorityRef,
      issuedAt: hostContext.issuedAt,
      expiresAt: hostContext.expiresAt
    });
  };
}

async function retrieveHfmWorkLearning(options = {}) {
  const env = options.env || process.env;
  const now = options.now instanceof Date && Number.isFinite(options.now.getTime())
    ? options.now
    : new Date();
  if (env.MIRA_HFM_WORK_LEARNING_ENABLED !== 'true') {
    return Object.freeze({
      status: 'DISABLED',
      projectId: null,
      currentTaskId: options.currentTaskId || '',
      transfers: Object.freeze([]),
      count: 0,
      source: 'HFM_V02',
      localFallback: false,
      driveFallback: false
    });
  }
  if (env.MIRA_HFM_STANDING_READ_AUTHORITY_ENABLED !== 'true') {
    fail('HFM_WORK_LEARNING_STANDING_AUTHORITY_DISABLED');
  }
  const bridge = options.bridge || retrieveProjectScopedWorkLearning;
  if (typeof bridge !== 'function') {
    fail('HFM_WORK_LEARNING_RUNTIME_DEPENDENCY_INVALID');
  }
  const task = options.task && typeof options.task === 'object' ? options.task : {};
  const taskText = [
    task.title,
    task.description,
    ...(Array.isArray(task.requirements) ? task.requirements : [])
  ].filter(value => typeof value === 'string' && value.trim()).join(' ').trim();
  const currentTaskId = typeof task.id === 'string' ? task.id.trim()
    : typeof task.taskId === 'string' ? task.taskId.trim() : '';
  if (!taskText || !currentTaskId) fail('HFM_WORK_LEARNING_TASK_CONTEXT_REQUIRED');

  const memory = options.preflight;
  const hostContext = memory && memory.hostAuthorizationContext;
  const nowMs = now.getTime();
  const issuedAtOrder = hostContext
    ? compareTimestampToNow(hostContext.issuedAt, nowMs) : null;
  const expiresAtOrder = hostContext
    ? compareTimestampToNow(hostContext.expiresAt, nowMs) : null;
  const expiresAfterIssue = hostContext
    ? compareTimestamps(hostContext.expiresAt, hostContext.issuedAt) : null;
  const scanStartedOrder = memory
    ? compareTimestampToNow(memory.scanStartedAt, nowMs) : null;
  if (!memory || memory.status !== 'AUTHORIZED_AND_COMMITTED' ||
      memory.standingAuthority !== true ||
      memory.authorityConsumed !== false ||
      memory.approvalRequiredPerRead !== false ||
      memory.memoryWrites !== false ||
      memory.localFallback !== false ||
      memory.driveFallback !== false ||
      memory.candidateScanMayBeIncomplete !== false ||
      memory.nextCursor !== null ||
      !Array.isArray(memory.records) ||
      !Number.isInteger(memory.count) ||
      memory.count !== memory.records.length ||
      !Number.isInteger(memory.pageCount) ||
      memory.pageCount < 1 || memory.pageCount > MAX_STANDING_READ_PAGES ||
      !Number.isInteger(memory.candidateScanCount) ||
      memory.candidateScanCount !== memory.records.length ||
      memory.candidateScanLimit !== PAGE_SIZE * MAX_STANDING_READ_PAGES ||
      memory.candidateScanCount > memory.candidateScanLimit ||
      memory.records.length > memory.candidateScanLimit ||
      !memory.hostAuthorizationContext ||
      typeof memory.projectId !== 'string' || !memory.projectId ||
      memory.standingAuthorityId !== hostContext.authorityRef ||
      memory.authorityExpiresAt !== hostContext.expiresAt ||
      hostContext.projectId !== memory.projectId ||
      hostContext.actorType !== 'HUMAN' ||
      typeof hostContext.actorId !== 'string' || !hostContext.actorId.startsWith('mira:') ||
      typeof hostContext.authorityRef !== 'string' || !hostContext.authorityRef ||
      typeof hostContext.requestId !== 'string' || !hostContext.requestId ||
      typeof hostContext.purpose !== 'string' || !hostContext.purpose ||
      issuedAtOrder === null || issuedAtOrder > 0 ||
      expiresAtOrder !== 1 || expiresAfterIssue === null || expiresAfterIssue <= 0 ||
      scanStartedOrder === null || scanStartedOrder > 0) {
    fail('HFM_WORK_LEARNING_PREFLIGHT_SNAPSHOT_REQUIRED');
  }
  const seenMemoryIds = new Set();
  for (const record of memory.records) {
    if (!record || typeof record.memoryId !== 'string' || !record.memoryId ||
        seenMemoryIds.has(record.memoryId) ||
        record.projectId !== memory.projectId ||
        !['learning_note', 'knowledge_item'].includes(record.recordType) ||
        record.lifecycle !== 'ACTIVE') {
      fail('HFM_WORK_LEARNING_RECORD_SCOPE_INVALID');
    }
    seenMemoryIds.add(record.memoryId);
  }

  const result = bridge({
    records: memory.records,
    pendingConflicts: Array.isArray(options.pendingConflicts) ? options.pendingConflicts : [],
    projectId: hostContext.projectId,
    requestContext: hostContext,
    authorizeRequest: buildHfmAuthorizeRequest(hostContext, memory.records.map(record => record.memoryId)),
    taskText,
    currentTaskId,
    limit: options.limit === undefined ? 5 : options.limit,
    now
  });
  return Object.freeze({
    ...result,
    status: 'HFM_WORK_LEARNING_RETRIEVED',
    source: 'HFM_V02_STANDING_READ',
    authorityRef: hostContext.authorityRef,
    authorityExpiresAt: hostContext.expiresAt,
    approvalRequiredPerRead: false,
    localFallback: false,
    driveFallback: false,
    memoryWrites: false,
    scannedPages: memory.pageCount,
    scannedRecords: memory.candidateScanCount,
    candidateScanMayBeIncomplete: false,
    nextCursor: null
  });
}

module.exports = Object.freeze({
  MAX_MEMORY_SCAN,
  buildHfmAuthorizeRequest,
  retrieveHfmWorkLearning
});
