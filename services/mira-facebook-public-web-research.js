'use strict';

const crypto = require('node:crypto');
const FACEBOOK_HOSTS = new Set(['facebook.com', 'www.facebook.com', 'm.facebook.com']);
const DEFAULT_MAX_RESULTS = 8;
const MAX_SNIPPET_CHARS = 3000;

function text(value, label, max = 512) {
  if (typeof value !== 'string' || !value.trim() || value.length > max) throw new Error(label + ' must be bounded non-empty text.');
  return value.trim();
}
function validatePageId(value) {
  const id = text(value, 'pageId', 32);
  if (!/^\\d{1,32}$/.test(id)) throw new Error('pageId must be numeric.');
  return id;
}
function validateFacebookUrl(value, label = 'pageUrl') {
  const raw = text(value, label, 2048);
  let url;
  try { url = new URL(raw); } catch { throw new Error(label + ' must be a valid URL.'); }
  if (url.protocol !== 'https:' || !FACEBOOK_HOSTS.has(url.hostname.toLowerCase()) ||
      url.username || url.password || url.hash || (url.port && url.port !== '443')) throw new Error(label + ' must be a standard HTTPS Facebook URL.');
  url.search = '';
  return url.toString().replace(/\\/$/, '');
}
function buildFacebookPageResearchQueries({ pageId, pageName, pageUrl } = {}) {
  const id = validatePageId(pageId);
  const name = pageName === undefined || pageName === null ? null : text(pageName, 'pageName', 128);
  const safeUrl = pageUrl === undefined || pageUrl === null ? null : validateFacebookUrl(pageUrl);
  const queries = [
    '"' + id + '" Facebook Page',
    name ? '"' + name.replace(/"/g, '') + '" Facebook "' + id + '"' : 'site:facebook.com "' + id + '"'
  ];
  if (safeUrl) queries.push('"' + safeUrl + '" Facebook Page');
  return [...new Set(queries)];
}
function parseSearchResults(value) {
  let parsed = value;
  if (typeof parsed === 'string') { try { parsed = JSON.parse(parsed); } catch { return []; } }
  if (Array.isArray(parsed)) return parsed;
  if (parsed && Array.isArray(parsed.results)) return parsed.results;
  if (parsed && Array.isArray(parsed.items)) return parsed.items;
  return [];
}
function normalizeResult(item, pageId, observedAt) {
  if (!item || typeof item !== 'object' || Array.isArray(item)) return null;
  const rawUrl = typeof item.url === 'string' ? item.url : typeof item.link === 'string' ? item.link : '';
  let url;
  try { url = new URL(rawUrl); } catch { return null; }
  if (url.protocol !== 'https:' || !FACEBOOK_HOSTS.has(url.hostname.toLowerCase()) ||
      url.username || url.password || url.hash || (url.port && url.port !== '443')) return null;
  const title = typeof item.title === 'string' ? item.title.slice(0, 500) : '';
  const snippetRaw = typeof item.snippet === 'string' ? item.snippet : typeof item.content === 'string' ? item.content : '';
  const snippet = snippetRaw.slice(0, MAX_SNIPPET_CHARS);
  if (!(url.toString() + ' ' + title + ' ' + snippet).includes(pageId)) return null;
  const parts = url.pathname.split('/').filter(Boolean);
  const isPost = (parts.length === 3 && parts[1] === 'posts') ||
    (url.pathname === '/permalink.php' && url.searchParams.get('id') === pageId && !!url.searchParams.get('story_fbid'));
  const isProfile = parts.length === 1 && parts[0] === pageId;
  if (!isPost && !isProfile) return null;
  url.searchParams.delete('ref');
  url.searchParams.delete('__tn__');
  url.searchParams.delete('mibextid');
  const canonicalUrl = url.origin + url.pathname + (url.pathname === '/permalink.php' ?
    '?id=' + encodeURIComponent(url.searchParams.get('id') || '') + '&story_fbid=' +
    encodeURIComponent(url.searchParams.get('story_fbid') || '') : '');
  const publishedAt = typeof item.publishedAt === 'string' && Number.isFinite(Date.parse(item.publishedAt))
    ? new Date(item.publishedAt).toISOString() : null;
  return Object.freeze({
    evidenceId: 'fbweb-' + crypto.createHash('sha256').update(pageId + '|' + canonicalUrl, 'utf8').digest('hex').slice(0, 24),
    pageId, title: title || 'Facebook public result', snippet, sourceUrl: canonicalUrl,
    sourceType: isPost ? 'FACEBOOK_PAGE_POST' : 'FACEBOOK_PAGE_PROFILE',
    publishedAt, observedAt, identityBinding: 'PAGE_ID_PRESENT_IN_INDEXED_RESULT',
    trustStatus: 'SOURCE_RECORDED', integrityStatus: 'UNVERIFIED', lifecycle: 'PENDING_REVIEW'
  });
}

/**
 * Search-index-only public research. The host injects its existing web-search provider.
 * This module never fetches Facebook, logs in, uses cookies, or calls Meta.
 */
async function collectPublicFacebookPageEvidence({
  pageId, pageName, pageUrl, searchWeb, observedAt = new Date().toISOString(), maxResults = DEFAULT_MAX_RESULTS
} = {}) {
  const id = validatePageId(pageId);
  if (typeof searchWeb !== 'function') throw new Error('An existing web-search provider function is required.');
  const timestamp = new Date(observedAt);
  if (!Number.isFinite(timestamp.getTime())) throw new Error('observedAt must be a valid timestamp.');
  if (timestamp.getTime() > Date.now() + 60000) throw new Error('observedAt cannot be in the future.');
  if (!Number.isInteger(maxResults) || maxResults < 1 || maxResults > 10) throw new Error('maxResults must be an integer between 1 and 10.');
  const queries = buildFacebookPageResearchQueries({ pageId: id, pageName, pageUrl });
  const evidence = [];
  const errors = [];
  const seen = new Set();
  for (const query of queries) {
    try {
      const response = await searchWeb(query);
      for (const item of parseSearchResults(response)) {
        const normalized = normalizeResult(item, id, timestamp.toISOString());
        if (!normalized || seen.has(normalized.sourceUrl)) continue;
        seen.add(normalized.sourceUrl);
        evidence.push(normalized);
        if (evidence.length >= maxResults) break;
      }
    } catch (error) {
      errors.push({ query, code: typeof error?.code === 'string' ? error.code.slice(0, 64) : 'SEARCH_PROVIDER_ERROR' });
    }
    if (evidence.length >= maxResults) break;
  }
  return Object.freeze({
    schemaVersion: '1.0.0', providerId: 'facebook-public-web-research',
    page: Object.freeze({ pageId: id, pageName: pageName ? text(pageName, 'pageName', 128) : null }),
    retrievalMode: 'PUBLIC_SEARCH_INDEX_ONLY',
    status: evidence.length ? 'PUBLIC_WEB_EVIDENCE_COLLECTED_UNTRUSTED' : 'NO_ID_BOUND_PUBLIC_FACEBOOK_RESULTS',
    queriesExecuted: queries.length - errors.length,
    evidence: Object.freeze(evidence), errors: Object.freeze(errors),
    limits: Object.freeze({
      directFacebookFetches: 0, metaGraphApiCalls: 0, loginOrCookieUse: 0,
      privateOrGroupContentAccess: 0, rawContentPersisted: false,
      canonicalMemoryWrite: false, mayEnterTrustedMemory: false,
      requiresHumanReviewAndIndependentVerification: true
    })
  });
}
function buildEvidenceContext(report) {
  if (!report || report.providerId !== 'facebook-public-web-research' || !Array.isArray(report.evidence)) throw new Error('A public Facebook web research report is required.');
  return report.evidence.map(item => ({
    title: item.title, snippet: item.snippet, sourceUrl: item.sourceUrl,
    observedAt: item.observedAt, publishedAt: item.publishedAt,
    trustStatus: item.trustStatus, integrityStatus: item.integrityStatus
  }));
}
module.exports = { validatePageId, validateFacebookUrl, buildFacebookPageResearchQueries, collectPublicFacebookPageEvidence, buildEvidenceContext };
