'use strict';
const crypto = require('node:crypto');
function secureProviderRequest(...args) {
  return require('./security/secure-provider-request').secureProviderRequest(...args);
}
const TABLE = 'mira_hfm_learning_proposals';
const AUDIT_TABLE = 'mira_hfm_learning_proposal_audit_events';
const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;
function fail(code, message) { const e = new Error(message); e.code = code; throw e; }
function canonicalJson(value) {
  if (Array.isArray(value)) return '[' + value.map(canonicalJson).join(',') + ']';
  if (value && typeof value === 'object') return '{' + Object.keys(value).sort().map(k => JSON.stringify(k) + ':' + canonicalJson(value[k])).join(',') + '}';
  return JSON.stringify(value);
}
function digest(value) { return crypto.createHash('sha256').update(canonicalJson(value), 'utf8').digest('hex'); }
function validateConfig(env = process.env) {
  let url;
  try { url = new URL(typeof env.SUPABASE_URL === 'string' ? env.SUPABASE_URL.trim() : ''); }
  catch { fail('HFM_LEARNING_SUPABASE_CONFIG_INVALID', 'Supabase URL is missing or invalid.'); }
  const key = typeof env.SUPABASE_SERVICE_ROLE_KEY === 'string' ? env.SUPABASE_SERVICE_ROLE_KEY.trim() : '';
  if (url.protocol !== 'https:' || !/^[a-z0-9-]+\.supabase\.co$/i.test(url.hostname) ||
      url.username || url.password || url.hash || (url.port && url.port !== '443') ||
      url.pathname !== '/' || url.search || key.length < 20 || key.length > 4096) {
    fail('HFM_LEARNING_SUPABASE_CONFIG_INVALID', 'Supabase configuration is not a standard HTTPS project URL and bounded service-role credential.');
  }
  return { baseUrl: url.origin, key };
}
function responseRows(response) {
  const data = response && response.data;
  if (!Array.isArray(data) || Buffer.byteLength(JSON.stringify(data), 'utf8') > MAX_RESPONSE_BYTES)
    fail('HFM_LEARNING_SUPABASE_RESPONSE_INVALID', 'Supabase returned an invalid or oversized row collection.');
  return data;
}
function validateProposalRow(row, projectId, proposalId) {
  if (!row || row.project_id !== projectId || row.proposal_id !== proposalId ||
      typeof row.proposal_digest !== 'string' || !/^[a-f0-9]{64}$/.test(row.proposal_digest) ||
      typeof row.evidence_digest !== 'string' || !/^[a-f0-9]{64}$/.test(row.evidence_digest) ||
      !row.payload || typeof row.payload !== 'object' || Array.isArray(row.payload) ||
      row.payload.projectId !== projectId || row.payload.proposalId !== proposalId ||
      row.payload.proposalDigest !== row.proposal_digest || row.payload.evidenceDigest !== row.evidence_digest) {
    fail('HFM_LEARNING_SUPABASE_IDENTITY_MISMATCH', 'Supabase proposal row failed project, ID or digest identity checks.');
  }
  const withoutDigest = Object.fromEntries(Object.entries(row.payload).filter(([k]) => k !== 'proposalDigest'));
  if (digest(withoutDigest) !== row.proposal_digest || digest(row.payload.evidence) !== row.evidence_digest)
    fail('HFM_LEARNING_SUPABASE_INTEGRITY_FAILED', 'Supabase proposal payload digest verification failed.');
  if (row.payload.trustState !== 'UNTRUSTED' || row.payload.status !== 'PENDING_HUMAN_REVIEW' ||
      row.payload.automaticPromotion !== false || row.payload.automaticExecution !== false ||
      row.payload.canonicalMemoryWrites !== 0 || row.payload.selfModificationAllowed !== false)
    fail('HFM_LEARNING_SUPABASE_POLICY_FAILED', 'Stored proposal no longer satisfies the HFM human-review-only trust policy.');
  return row.payload;
}
function createSupabaseLearningProposalStore({ env = process.env, request = secureProviderRequest } = {}) {
  if (typeof request !== 'function') throw new TypeError('request must be a function');
  const config = validateConfig(env);
  async function callTable(table, query, method, data, headers = {}) {
    let response;
    try {
      response = await request(config.baseUrl + '/rest/v1/' + table + query, {
        method, headers: { apikey: config.key, Authorization: 'Bearer ' + config.key,
          'Content-Type': 'application/json', ...headers },
        ...(data === undefined ? {} : { data })
      });
    } catch (_error) {
      fail('HFM_LEARNING_SUPABASE_REQUEST_FAILED', 'Supabase learning proposal request failed.');
    }
    if (!response || !Number.isInteger(response.status) || response.status < 200 || response.status >= 300)
      fail('HFM_LEARNING_SUPABASE_HTTP_ERROR', 'Supabase learning proposal request returned a non-success status.');
    return response;
  }
  async function get(projectId, proposalId) {
    const query = '?select=project_id,proposal_id,proposal_digest,evidence_digest,payload' +
      '&project_id=eq.' + encodeURIComponent(projectId) +
      '&proposal_id=eq.' + encodeURIComponent(proposalId) + '&limit=2';
    const found = responseRows(await callTable(TABLE, query, 'GET'));
    if (!found.length) return null;
    if (found.length !== 1) fail('HFM_LEARNING_SUPABASE_IDENTITY_CONFLICT', 'Multiple rows matched one project-scoped proposal ID.');
    return validateProposalRow(found[0], projectId, proposalId);
  }
  async function putIfAbsent(projectId, proposalId, proposal) {
    if (!proposal || proposal.projectId !== projectId || proposal.proposalId !== proposalId)
      fail('HFM_LEARNING_PROJECT_MISMATCH', 'Proposal identity does not match Supabase key.');
    const row = { project_id: projectId, proposal_id: proposalId,
      proposal_digest: proposal.proposalDigest, evidence_digest: proposal.evidenceDigest, payload: proposal };
    const inserted = responseRows(await callTable(TABLE, '?on_conflict=project_id,proposal_id', 'POST', [row],
      { Prefer: 'resolution=ignore-duplicates,return=representation' }));
    if (inserted.length > 1) fail('HFM_LEARNING_SUPABASE_STAGE_AMBIGUOUS', 'Supabase returned multiple rows for one proposal insert.');
    const readback = await get(projectId, proposalId);
    if (!readback) fail('HFM_LEARNING_READBACK_FAILED', 'Supabase proposal readback returned no row.');
    if (readback.proposalDigest !== proposal.proposalDigest || readback.evidenceDigest !== proposal.evidenceDigest)
      fail('HFM_LEARNING_PROPOSAL_CONFLICT', 'Project/proposal ID already exists with different immutable content.');
    return { created: inserted.length === 1 };
  }
  async function writeAuditEvent(event) {
    if (!event || event.event !== 'HFM_LEARNING_PROPOSAL_STAGED' ||
        typeof event.projectId !== 'string' || typeof event.proposalId !== 'string' ||
        typeof event.proposalDigest !== 'string' || typeof event.actorRole !== 'string') {
      fail('HFM_LEARNING_SUPABASE_AUDIT_INVALID', 'Learning proposal audit event is incomplete.');
    }
    const payload = { schemaVersion:'1.0.0', eventType:event.event, projectId:event.projectId,
      proposalId:event.proposalId, proposalDigest:event.proposalDigest, status:event.status,
      actorRole:event.actorRole, actorId:event.actorId || 'unknown',
      canonicalMemoryWrites:0, recordedAt:new Date().toISOString() };
    const eventDigest = digest(payload);
    const eventId = crypto.randomUUID();
    const row = { event_id:eventId, project_id:event.projectId, proposal_id:event.proposalId,
      event_digest:eventDigest, payload };
    const inserted = responseRows(await callTable(AUDIT_TABLE, '', 'POST', [row], { Prefer:'return=representation' }));
    if (inserted.length !== 1 || inserted[0].event_id !== eventId || inserted[0].event_digest !== eventDigest)
      fail('HFM_LEARNING_SUPABASE_AUDIT_WRITE_FAILED', 'Supabase did not confirm the proposal audit insert.');
    const verified = responseRows(await callTable(AUDIT_TABLE,
      '?select=event_id,project_id,proposal_id,event_digest,payload&event_id=eq.' + encodeURIComponent(eventId) + '&limit=2','GET'));
    if (verified.length !== 1 || verified[0].project_id !== event.projectId ||
        verified[0].proposal_id !== event.proposalId || verified[0].event_digest !== eventDigest ||
        digest(verified[0].payload) !== eventDigest) {
      fail('HFM_LEARNING_SUPABASE_AUDIT_READBACK_FAILED', 'Supabase proposal audit readback failed.');
    }
    return { status:'AUDIT_WRITE_READBACK_VERIFIED', eventId, eventDigest };
  }
  return Object.freeze({
    projectIsolated:true, createOnly:true, immutableVersions:true, readAfterWrite:true,
    durable:true, crossInstanceAtomicCreate:true, storageMode:'SUPABASE_POSTGREST_IMMUTABLE',
    putIfAbsent, get, writeAuditEvent
  });
}
module.exports = { TABLE, AUDIT_TABLE, createSupabaseLearningProposalStore, validateConfig, canonicalJson };
