'use strict';
const GRAPH_API_VERSION = 'v26.0';
const GRAPH_HOST = 'graph.facebook.com';
const MAX_RESPONSE_BYTES = 64 * 1024;
function requiredText(value, label, maxLength) {
  if (typeof value !== 'string' || !value.trim() || value.length > maxLength) throw new Error(label + ' must be bounded non-empty text.');
  return value.trim();
}
function validatePageId(value) {
  const pageId = requiredText(value, 'pageId', 32);
  if (!/^\d{1,32}$/.test(pageId)) throw new Error('pageId must be numeric.');
  return pageId;
}
async function readFacebookPageMetadata({ pageId, accessToken, apiVersion = GRAPH_API_VERSION, fetchImpl = globalThis.fetch, timeoutMs = 10000 } = {}) {
  const safePageId = validatePageId(pageId);
  const token = requiredText(accessToken, 'accessToken', 8192);
  if (/[\r\n]/.test(token)) throw new Error('accessToken contains invalid characters.');
  if (apiVersion !== GRAPH_API_VERSION) throw new Error('Only the reviewed pinned Graph API version is allowed.');
  if (typeof fetchImpl !== 'function') throw new Error('A fetch implementation is required.');
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1000 || timeoutMs > 15000) throw new Error('timeoutMs must be between 1000 and 15000.');
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  const url = new URL('/' + GRAPH_API_VERSION + '/' + safePageId, 'https://' + GRAPH_HOST);
  url.searchParams.set('fields', 'id,name');
  try {
    const response = await fetchImpl(url.toString(), {
      method: 'GET',
      headers: { authorization: 'Bearer ' + token, accept: 'application/json' },
      redirect: 'error', cache: 'no-store', signal: controller.signal
    });
    if (!response || typeof response.status !== 'number') throw new Error('Meta returned an invalid HTTP response.');
    if (!response.ok) {
      const status = response.status;
      const error = new Error(status === 401 || status === 403 ? 'Meta rejected authentication or Page permission.' :
        status === 429 ? 'Meta rate-limited the read-only probe.' :
        status >= 500 ? 'Meta Graph API server error.' : 'Meta Graph API rejected the read-only probe.');
      error.code = status === 401 || status === 403 ? 'AUTH_OR_PERMISSION_DENIED' :
        status === 429 ? 'RATE_LIMITED' : status >= 500 ? 'PROVIDER_SERVER_ERROR' : 'PROVIDER_CLIENT_ERROR';
      error.httpStatus = status;
      throw error;
    }
    const raw = await response.text();
    if (Buffer.byteLength(raw, 'utf8') > MAX_RESPONSE_BYTES) throw new Error('Meta response exceeded the bounded response size.');
    let payload;
    try { payload = JSON.parse(raw); } catch { throw new Error('Meta returned invalid JSON.'); }
    if (!payload || typeof payload !== 'object' || Array.isArray(payload) || typeof payload.id !== 'string' || !/^\d{1,32}$/.test(payload.id)) {
      throw new Error('Meta response did not contain a valid Page identity.');
    }
    if (payload.id !== safePageId) throw new Error('Meta response Page identity did not match the requested Page.');
    if (payload.name !== undefined && (typeof payload.name !== 'string' || payload.name.length > 512)) throw new Error('Meta returned an invalid Page name.');
    return Object.freeze({
      status: 'READ_ONLY_PAGE_METADATA_VERIFIED', pageId: payload.id,
      pageName: payload.name === undefined ? null : payload.name, apiVersion: GRAPH_API_VERSION,
      method: 'GET', fields: Object.freeze(['id', 'name']), rawResponseStored: false,
      tokenExposed: false, mayPublish: false, mayWriteCanonicalMemory: false
    });
  } finally { clearTimeout(timeout); }
}
async function main(env = process.env) {
  if (env.MIRA_META_READ_ONLY_APPROVED !== 'true') throw new Error('Explicit READ-only workflow approval is required.');
  const pageId = validatePageId(env.META_PAGE_ID);
  const accessToken = requiredText(env.META_PAGE_ACCESS_TOKEN, 'META_PAGE_ACCESS_TOKEN', 8192);
  const result = await readFacebookPageMetadata({ pageId, accessToken });
  process.stdout.write(JSON.stringify(result) + '\n');
  process.stdout.write('LIVE_META_READ_ONLY_REQUESTS=1\n');
  process.stdout.write('META_WRITE_REQUESTS=0\n');
  process.stdout.write('FACEBOOK_POSTS_PUBLISHED=0\n');
  process.stdout.write('CANONICAL_MEMORY_WRITES=0\n');
}
if (require.main === module) {
  main().catch(error => {
    process.stderr.write('META_READ_ONLY_PROBE_FAILED=' + (error.code || 'SAFE_FAILURE') + '\n');
    process.stderr.write('DETAIL=' + error.message.replace(/[\r\n]/g, ' ') + '\n');
    process.exitCode = 1;
  });
}
module.exports = { readFacebookPageMetadata, validatePageId, GRAPH_API_VERSION };
