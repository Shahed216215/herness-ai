'use strict';
const crypto = require('node:crypto');
const ID_RE = /^[A-Za-z0-9][A-Za-z0-9._:-]{2,127}$/;
function fail(code, message) { const e = new Error(message); e.code = code; throw e; }
function bounded(value, label, max) {
  if (typeof value !== 'string' || !value.trim() || value.length > max) fail('HFM_LEARNING_RETRIEVAL_INVALID', label + ' is invalid.');
  return value.trim();
}
function fromPublicRetrieval(input = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) fail('HFM_LEARNING_RETRIEVAL_INVALID', 'Input must be an object.');
  const report = input.retrievalResult;
  if (!report || report.providerId !== 'mira-hfm-public-web-retrieval' ||
      report.retrievalMode !== 'PUBLIC_FACEBOOK_SEARCH_INDEX_ONLY' ||
      !['PUBLIC_WEB_EVIDENCE_COLLECTED_UNTRUSTED','DEGRADED_WITH_UNTRUSTED_EVIDENCE'].includes(report.status) ||
      !report.limits || report.limits.canonicalMemoryWrite !== false || report.limits.trustPromotion !== false ||
      report.limits.directFacebookFetches !== 0 || report.limits.metaGraphApiCalls !== 0 ||
      report.limits.loginOrCookieUse !== 0 || report.limits.privateOrGroupContentAccess !== 0 || !report.page ||
      typeof report.page.pageId !== 'string' || !/^[0-9]{1,32}$/.test(report.page.pageId) ||
      !Array.isArray(report.evidence) || report.evidence.length < 1 || report.evidence.length > 10) {
    fail('HFM_LEARNING_RETRIEVAL_INVALID', 'A bounded HFM public Facebook retrieval result is required.');
  }
  const projectId = bounded(input.projectId, 'projectId', 128);
  const proposalId = bounded(input.proposalId, 'proposalId', 128);
  if (!ID_RE.test(projectId) || !ID_RE.test(proposalId)) fail('HFM_LEARNING_RETRIEVAL_INVALID', 'Project or proposal ID format is invalid.');
  const evidence = report.evidence.map((item, index) => {
    if (!item || typeof item !== 'object' || item.pageId !== report.page.pageId) fail('HFM_LEARNING_RETRIEVAL_INVALID', 'Evidence page binding mismatch at index ' + index + '.');
    const sourceRef = bounded(item.sourceUrl, 'evidence.sourceUrl', 2048);
    let url;
    try { url = new URL(sourceRef); } catch { fail('HFM_LEARNING_RETRIEVAL_INVALID', 'Evidence source URL is invalid.'); }
    if (url.protocol !== 'https:' || !['facebook.com','www.facebook.com','m.facebook.com'].includes(url.hostname.toLowerCase()) ||
        url.username || url.password || url.hash || (url.port && url.port !== '443') ||
        (!url.pathname.split('/').includes(report.page.pageId) && url.searchParams.get('id') !== report.page.pageId)) {
      fail('HFM_LEARNING_RETRIEVAL_INVALID', 'Evidence source must be a standard HTTPS Facebook URL.');
    }
    const evidenceId = bounded(item.evidenceId, 'evidence.evidenceId', 128);
    if (!ID_RE.test(evidenceId)) fail('HFM_LEARNING_RETRIEVAL_INVALID', 'Evidence ID format is invalid.');
    const title = typeof item.title === 'string' ? item.title.slice(0, 500).trim() : '';
    const snippet = typeof item.snippet === 'string' ? item.snippet.slice(0, 3000).trim() : '';
    const content = [title, snippet].filter(Boolean).join('\n');
    if (!content) fail('HFM_LEARNING_RETRIEVAL_INVALID', 'Evidence title or snippet is required.');
    return { evidenceId, projectId, sourceType: 'PUBLIC_FACEBOOK_WEB_SEARCH',
      trustState: 'UNVERIFIED', sourceRef: url.toString(), content };
  });
  if (new Set(evidence.map(item => item.evidenceId)).size !== evidence.length) fail('HFM_LEARNING_RETRIEVAL_INVALID', 'Duplicate retrieval evidence IDs are forbidden.');
  return {
    projectId, proposalId,
    title: bounded(input.title, 'title', 240),
    rationale: bounded(input.rationale, 'rationale', 4000),
    proposedChange: bounded(input.proposedChange, 'proposedChange', 8000),
    evidence,
    evidenceOrigin: 'HFM_PUBLIC_FACEBOOK_SEARCH_RESULT_UNVERIFIED'
  };
}
module.exports = { fromPublicRetrieval };
