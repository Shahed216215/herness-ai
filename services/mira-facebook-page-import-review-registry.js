'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

function object(value) { return value !== null && typeof value === 'object' && !Array.isArray(value); }
function digest(value) { return crypto.createHash('sha256').update(JSON.stringify(value), 'utf8').digest('hex'); }
function text(value, label, max = 512) {
  if (typeof value !== 'string' || !value.trim() || value.length > max) throw new Error(label + ' must be bounded non-empty text.');
  return value.trim();
}
function pageId(value) {
  const id = text(value, 'pageId', 32);
  if (!/^\d{1,32}$/.test(id)) throw new Error('pageId must be numeric.');
  return id;
}
function safeDirectory(directory) {
  const resolved = path.resolve(text(directory, 'directory', 4096));
  const root = path.parse(resolved).root;
  if (resolved === root) throw new Error('Filesystem root cannot be used as a Facebook review queue directory.');
  let current = root;
  for (const segment of resolved.slice(root.length).split(path.sep).filter(Boolean)) {
    current = path.join(current, segment);
    try { fs.lstatSync(current); }
    catch (error) {
      if (error.code !== 'ENOENT') throw error;
      try { fs.mkdirSync(current, { mode: 0o700 }); }
      catch (mkdirError) { if (mkdirError.code !== 'EEXIST') throw mkdirError; }
    }
    const stat = fs.lstatSync(current);
    if (stat.isSymbolicLink() || !stat.isDirectory()) throw new Error('Review queue path contains an unsafe directory component.');
  }
  const finalStat = fs.lstatSync(resolved);
  if ((finalStat.mode & 0o077) !== 0) throw new Error('Review queue directory permissions must be owner-only (0700).');
  return resolved;
}
function queuePath(directory, queueId) {
  if (!/^mira-fb-review-[a-f0-9]{64}$/.test(queueId)) throw new Error('Invalid Facebook review queue ID.');
  return path.join(directory, queueId + '.json');
}
function decisionPath(directory, queueId) {
  if (!/^mira-fb-review-[a-f0-9]{64}$/.test(queueId)) throw new Error('Invalid Facebook review queue ID.');
  return path.join(directory, queueId + '.decision.json');
}
function readRegularJson(filePath) {
  const stat = fs.lstatSync(filePath);
  if (stat.isSymbolicLink() || !stat.isFile() || (stat.mode & 0o077) !== 0 || stat.size > 64 * 1024) {
    throw new Error('Review queue entry is not a safe, bounded owner-only regular file.');
  }
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}
function writeImmutableJson(filePath, value) {
  const directory = path.dirname(filePath);
  const tempPath = path.join(directory, '.mira-fb-review-tmp-' + process.pid + '-' + crypto.randomBytes(12).toString('hex'));
  let fd;
  let linked = false;
  try {
    fd = fs.openSync(tempPath, 'wx', 0o600);
    fs.writeFileSync(fd, JSON.stringify(value, null, 2) + '\n', 'utf8');
    fs.fsyncSync(fd);
    fs.closeSync(fd);
    fd = undefined;
    fs.linkSync(tempPath, filePath);
    linked = true;
    fs.unlinkSync(tempPath);
    const dirFd = fs.openSync(directory, 'r');
    try { fs.fsyncSync(dirFd); } finally { fs.closeSync(dirFd); }
    if (digest(readRegularJson(filePath)) !== digest(value)) throw new Error('Review queue immutable-write readback mismatch.');
  } catch (error) {
    if (fd !== undefined) { try { fs.closeSync(fd); } catch {} }
    try { fs.unlinkSync(tempPath); } catch {}
    if (linked) { error.stateCommitted = true; error.code = error.code || 'FACEBOOK_REVIEW_QUEUE_COMMITTED_VERIFY_FAILED'; }
    throw error;
  }
}
function validateCandidate(candidate) {
  if (!object(candidate) || candidate.providerId !== 'facebook-page' ||
      !object(candidate.source) || candidate.source.sourceType !== 'facebook_page') {
    throw new Error('An untrusted Facebook Page import candidate is required.');
  }
  const id = pageId(candidate.source.pageId);
  const postId = text(candidate.source.sourceId, 'source.postId', 160);
  if (!/^[A-Za-z0-9._-]{1,160}$/.test(postId)) throw new Error('source.postId has an unsupported format.');
  const sourceUrl = text(candidate.source.sourceUrl, 'source.sourceUrl', 2048);
  let parsed;
  try { parsed = new URL(sourceUrl); } catch { throw new Error('source.sourceUrl is invalid.'); }
  if (parsed.protocol !== 'https:' || !['facebook.com', 'www.facebook.com', 'm.facebook.com'].includes(parsed.hostname.toLowerCase()) ||
      parsed.username || parsed.password || parsed.hash || (parsed.port && parsed.port !== '443')) {
    throw new Error('Review queue accepts only validated HTTPS Facebook post URLs.');
  }
  const parts = parsed.pathname.split('/').filter(Boolean);
  const resolvedPageId = parts.length === 3 && parts[1] === 'posts'
    ? parts[0]
    : parsed.pathname === '/permalink.php' ? parsed.searchParams.get('id') : null;
  const resolvedPostId = parts.length === 3 && parts[1] === 'posts'
    ? parts[2]
    : parsed.pathname === '/permalink.php' ? parsed.searchParams.get('story_fbid') : null;
  if (resolvedPageId !== id || resolvedPostId !== postId) {
    throw new Error('Facebook source URL does not match the candidate Page/post identity.');
  }
  if (typeof candidate.content !== 'string' || !candidate.content.trim() || candidate.content.length > 100000) {
    throw new Error('candidate.content must be bounded non-empty text for digest verification.');
  }
  const actualContentHash = crypto.createHash('sha256').update(candidate.content, 'utf8').digest('hex');
  if (!/^[a-f0-9]{64}$/.test(candidate.contentHash || '') || candidate.contentHash !== actualContentHash) {
    throw new Error('candidate.contentHash does not match the supplied content.');
  }
  const observedAt = text(candidate.source.observedAt, 'source.observedAt', 64);
  if (!Number.isFinite(Date.parse(observedAt))) throw new Error('source.observedAt must be a valid timestamp.');
  if (candidate.integrity?.status !== 'UNVERIFIED' || candidate.trust?.status !== 'SOURCE_RECORDED' ||
      candidate.lifecycle !== 'PENDING_REVIEW' ||
      candidate.verificationStatus !== 'MANUAL_IMPORT_PENDING_INDEPENDENT_READBACK') {
    throw new Error('Candidate trust and review state must remain unverified and pending.');
  }
  return { pageId: id, postId, sourceUrl: 'https://www.facebook.com/' + id + '/posts/' + postId + '/', contentHash: candidate.contentHash, observedAt };
}

/**
 * Persist only a minimal, immutable review locator. Raw post text and credentials
 * are deliberately not stored. A durable audit event is mandatory after enqueue.
 */
function enqueueFacebookPageImportReview({ directory, projectId, actor, candidate, auditWriter } = {}) {
  const safeProjectId = text(projectId, 'projectId', 128);
  const safeActor = text(actor, 'actor', 128);
  if (typeof auditWriter !== 'function') throw new Error('An explicit durable auditWriter is required.');
  const source = validateCandidate(candidate);
  const safeDirectoryPath = safeDirectory(directory);
  const queueId = 'mira-fb-review-' + crypto.createHash('sha256')
    .update(safeProjectId + '|' + source.pageId + '|' + source.postId, 'utf8').digest('hex');
  const target = queuePath(safeDirectoryPath, queueId);
  const now = new Date().toISOString();
  const envelope = {
    schemaVersion: '1.0.0',
    queueId,
    projectId: safeProjectId,
    providerId: 'facebook-page',
    pageId: source.pageId,
    postId: source.postId,
    sourceUrl: source.sourceUrl,
    contentHash: source.contentHash,
    observedAt: source.observedAt,
    receivedAt: now,
    createdBy: safeActor,
    status: 'PENDING_HUMAN_REVIEW',
    trustStatus: 'SOURCE_RECORDED',
    integrityStatus: 'UNVERIFIED',
    rawContentStored: false,
    canonicalMemoryWrite: false
  };
  envelope.envelopeDigest = digest(envelope);
  let alreadyExists = false;
  try {
    const existing = readRegularJson(target);
    if (existing.projectId !== safeProjectId || existing.pageId !== source.pageId ||
        existing.postId !== source.postId || existing.contentHash !== source.contentHash ||
        existing.sourceUrl !== source.sourceUrl) {
      throw new Error('A different import version already occupies this Page post review identity; manual conflict review is required.');
    }
    alreadyExists = true;
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  if (!alreadyExists) {
    try { writeImmutableJson(target, envelope); }
    catch (error) {
      if (error.code !== 'EEXIST') throw error;
      const existing = readRegularJson(target);
      if (existing.projectId !== safeProjectId || existing.pageId !== source.pageId ||
          existing.postId !== source.postId || existing.contentHash !== source.contentHash ||
          existing.sourceUrl !== source.sourceUrl) throw new Error('Concurrent conflicting Facebook import rejected.');
      alreadyExists = true;
    }
  }
  const stored = readRegularJson(target);
  let decisionStatus = null;
  try {
    const decisionStat = fs.lstatSync(decisionPath(safeDirectoryPath, queueId));
    if (decisionStat.isSymbolicLink() || !decisionStat.isFile()) throw new Error('Review decision entry is unsafe.');
    const decision = verifyFacebookPageImportReviewDecision({ directory: safeDirectoryPath, queueId, projectId: safeProjectId });
    if (decision.status !== 'VERIFIED') throw new Error('Review decision integrity verification failed.');
    decisionStatus = decision.reviewStatus;
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  try {
    auditWriter({
      actorRole: safeActor,
      action: 'facebook_page_import_review_queued',
      resource: 'facebook_page_import_review',
      resourceId: queueId,
      status: 'success',
      details: {
        projectId: safeProjectId,
        pageId: source.pageId,
        postId: source.postId,
        contentHash: source.contentHash,
        queueStatus: 'PENDING_HUMAN_REVIEW',
        outcome: alreadyExists ? 'ALREADY_QUEUED' : 'QUEUED',
        rawContentStored: false,
        canonicalMemoryWrite: false
      }
    });
  } catch (error) {
    error.code = 'FACEBOOK_REVIEW_QUEUE_AUDIT_FAILED';
    error.stateCommitted = true;
    error.queueId = queueId;
    throw error;
  }
  return Object.freeze({
    status: alreadyExists ? 'ALREADY_QUEUED' : 'QUEUED',
    queueId,
    envelopeDigest: stored.envelopeDigest,
    projectId: safeProjectId,
    pageId: source.pageId,
    postId: source.postId,
    reviewStatus: decisionStatus || stored.status,
    decisionStatus,
    rawContentStored: false,
    canonicalMemoryWrite: false,
    auditEmitted: true
  });
}
function verifyFacebookPageImportReview({ directory, queueId, projectId } = {}) {
  const safeDirectoryPath = safeDirectory(directory);
  const entry = readRegularJson(queuePath(safeDirectoryPath, queueId));
  const { envelopeDigest, ...body } = entry;
  const identity = 'mira-fb-review-' + crypto.createHash('sha256')
    .update(entry.projectId + '|' + entry.pageId + '|' + entry.postId, 'utf8').digest('hex');
  const valid = envelopeDigest === digest(body) && queueId === identity &&
    (!projectId || entry.projectId === projectId) &&
    entry.status === 'PENDING_HUMAN_REVIEW' &&
    entry.trustStatus === 'SOURCE_RECORDED' &&
    entry.integrityStatus === 'UNVERIFIED' &&
    entry.rawContentStored === false && entry.canonicalMemoryWrite === false;
  return { status: valid ? 'VERIFIED' : 'INTEGRITY_FAILED', queueId, projectId: entry.projectId, reviewStatus: entry.status };
}
function listFacebookPageImportReviews({ directory, projectId } = {}) {
  const safeDirectoryPath = safeDirectory(directory);
  const safeProjectId = text(projectId, 'projectId', 128);
  return fs.readdirSync(safeDirectoryPath)
    .filter(name => /^mira-fb-review-[a-f0-9]{64}\.json$/.test(name))
    .map(name => {
      const filePath = path.join(safeDirectoryPath, name);
      const stat = fs.lstatSync(filePath);
      if (stat.isSymbolicLink() || !stat.isFile()) throw new Error('Review queue contains an unsafe entry.');
      const entry = readRegularJson(filePath);
      if (entry.projectId !== safeProjectId) return null;
      const verification = verifyFacebookPageImportReview({ directory: safeDirectoryPath, queueId: entry.queueId, projectId: safeProjectId });
      if (verification.status !== 'VERIFIED') throw new Error('Review queue integrity verification failed.');
      let status = entry.status;
      let decision = null;
      try {
        const decisionStat = fs.lstatSync(decisionPath(safeDirectoryPath, entry.queueId));
        if (decisionStat.isSymbolicLink() || !decisionStat.isFile()) throw new Error('Review decision entry is unsafe.');
        const decisionResult = verifyFacebookPageImportReviewDecision({ directory: safeDirectoryPath, queueId: entry.queueId, projectId: safeProjectId });
        if (decisionResult.status !== 'VERIFIED') throw new Error('Review decision integrity verification failed.');
        status = decisionResult.reviewStatus;
        decision = decisionResult.reviewStatus;
      } catch (error) {
        if (error.code !== 'ENOENT') throw error;
      }
      return Object.freeze({ queueId: entry.queueId, pageId: entry.pageId, postId: entry.postId, status, decision, queueStatus: entry.status, contentHash: entry.contentHash });
    })
    .filter(Boolean);
}

function decideFacebookPageImportReview({
  directory, queueId, projectId, actor, decision, policyDecision,
  authorizeDecision, auditWriter
} = {}) {
  const safeDirectoryPath = safeDirectory(directory);
  const safeProjectId = text(projectId, 'projectId', 128);
  const safeActor = text(actor, 'actor', 128);
  const safePolicyDecision = text(policyDecision, 'policyDecision', 256);
  const decisions = new Set(['APPROVE_FOR_INDEPENDENT_VERIFICATION', 'REJECT_IMPORT', 'RETAIN_QUARANTINED']);
  if (!decisions.has(decision)) throw new Error('Unsupported Facebook import review decision.');
  if (typeof authorizeDecision !== 'function' || authorizeDecision({
    actor: safeActor, projectId: safeProjectId, queueId, decision, policyDecision: safePolicyDecision
  }) !== true) throw new Error('Facebook import review decision authorization denied.');
  if (typeof auditWriter !== 'function') throw new Error('An explicit durable auditWriter is required.');
  const queue = verifyFacebookPageImportReview({ directory: safeDirectoryPath, queueId, projectId: safeProjectId });
  if (queue.status !== 'VERIFIED') throw new Error('Facebook import review queue integrity verification failed.');
  const target = decisionPath(safeDirectoryPath, queueId);
  const status = decision === 'APPROVE_FOR_INDEPENDENT_VERIFICATION'
    ? 'APPROVED_FOR_INDEPENDENT_VERIFICATION'
    : decision === 'REJECT_IMPORT' ? 'REJECTED' : 'RETAINED_QUARANTINED';
  const envelope = {
    schemaVersion: '1.0.0', queueId, projectId: safeProjectId,
    queueEnvelopeDigest: readRegularJson(queuePath(safeDirectoryPath, queueId)).envelopeDigest,
    decision, status, actor: safeActor, policyDecision: safePolicyDecision,
    decidedAt: new Date().toISOString(),
    trustStatus: 'SOURCE_RECORDED', integrityStatus: 'UNVERIFIED',
    mayEnterTrustedMemory: false, canonicalMemoryWrite: false
  };
  envelope.envelopeDigest = digest(envelope);
  let alreadyExists = false;
  try {
    const existing = readRegularJson(target);
    const { envelopeDigest, ...body } = existing;
    if (envelopeDigest !== digest(body)) throw new Error('Existing Facebook review decision failed integrity verification.');
    if (existing.decision !== decision || existing.actor !== safeActor ||
        existing.policyDecision !== safePolicyDecision || existing.projectId !== safeProjectId) {
      throw new Error('An immutable, different review decision already exists.');
    }
    alreadyExists = true;
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  if (!alreadyExists) {
    try { writeImmutableJson(target, envelope); }
    catch (error) {
      if (error.code !== 'EEXIST') throw error;
      const existing = readRegularJson(target);
      if (existing.decision !== decision || existing.actor !== safeActor ||
          existing.policyDecision !== safePolicyDecision || existing.projectId !== safeProjectId) {
        throw new Error('Concurrent conflicting Facebook review decision rejected.');
      }
      alreadyExists = true;
    }
  }
  const stored = readRegularJson(target);
  try {
    auditWriter({
      actorRole: safeActor, action: 'facebook_page_import_review_decided',
      resource: 'facebook_page_import_review', resourceId: queueId, status: 'success',
      details: {
        projectId: safeProjectId, decision, reviewStatus: status,
        trustStatus: 'SOURCE_RECORDED', integrityStatus: 'UNVERIFIED',
        mayEnterTrustedMemory: false, canonicalMemoryWrite: false,
        outcome: alreadyExists ? 'ALREADY_DECIDED' : 'DECIDED'
      }
    });
  } catch (error) {
    error.code = 'FACEBOOK_REVIEW_DECISION_AUDIT_FAILED';
    error.stateCommitted = true;
    error.queueId = queueId;
    throw error;
  }
  return Object.freeze({
    status: alreadyExists ? 'ALREADY_DECIDED' : 'DECIDED',
    queueId, decision: stored.decision, reviewStatus: stored.status,
    trustStatus: stored.trustStatus, integrityStatus: stored.integrityStatus,
    mayEnterTrustedMemory: stored.mayEnterTrustedMemory,
    canonicalMemoryWrite: stored.canonicalMemoryWrite,
    envelopeDigest: stored.envelopeDigest
  });
}
function verifyFacebookPageImportReviewDecision({ directory, queueId, projectId } = {}) {
  const safeDirectoryPath = safeDirectory(directory);
  const entry = readRegularJson(decisionPath(safeDirectoryPath, queueId));
  const { envelopeDigest, ...body } = entry;
  const queue = verifyFacebookPageImportReview({ directory: safeDirectoryPath, queueId, projectId });
  const queuedEntry = readRegularJson(queuePath(safeDirectoryPath, queueId));
  const expectedStatus = entry.decision === 'APPROVE_FOR_INDEPENDENT_VERIFICATION'
    ? 'APPROVED_FOR_INDEPENDENT_VERIFICATION'
    : entry.decision === 'REJECT_IMPORT' ? 'REJECTED' : 'RETAINED_QUARANTINED';
  const valid = envelopeDigest === digest(body) && entry.queueId === queueId &&
    queue.status === 'VERIFIED' && entry.queueEnvelopeDigest === queuedEntry.envelopeDigest &&
    (!projectId || entry.projectId === projectId) &&
    ['APPROVE_FOR_INDEPENDENT_VERIFICATION', 'REJECT_IMPORT', 'RETAIN_QUARANTINED'].includes(entry.decision) &&
    entry.status === expectedStatus &&
    entry.trustStatus === 'SOURCE_RECORDED' && entry.integrityStatus === 'UNVERIFIED' &&
    entry.mayEnterTrustedMemory === false && entry.canonicalMemoryWrite === false;
  return { status: valid ? 'VERIFIED' : 'INTEGRITY_FAILED', queueId, reviewStatus: entry.status };
}

module.exports = { enqueueFacebookPageImportReview, verifyFacebookPageImportReview, listFacebookPageImportReviews, decideFacebookPageImportReview, verifyFacebookPageImportReviewDecision };
