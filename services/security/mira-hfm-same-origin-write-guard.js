'use strict';

function parseOrigin(value) {
  if (typeof value !== 'string' || !value.trim() || value.trim() === 'null') return null;
  try {
    const parsed = new URL(value.trim());
    if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password) return null;
    return parsed.origin;
  } catch (_) {
    return null;
  }
}

function createMiraHfmSameOriginWriteGuard(options = {}) {
  const env = options.env || process.env;
  const configuredOrigins = String(env.MIRA_HFM_LEARNING_ALLOWED_ORIGINS || '')
    .split(',')
    .map(value => parseOrigin(value))
    .filter(Boolean);

  return function miraHfmSameOriginWriteGuard(req, res, next) {
    if (!req || String(req.method || '').toUpperCase() !== 'POST') return next();

    const headers = req.headers || {};
    const originHeader = typeof req.get === 'function' ? req.get('origin') : headers.origin;
    const refererHeader = typeof req.get === 'function' ? req.get('referer') : headers.referer;
    const origin = originHeader ? parseOrigin(originHeader) : parseOrigin(refererHeader);
    const refererOrigin = refererHeader ? parseOrigin(refererHeader) : null;
    const fetchSite = String(
      (typeof req.get === 'function' ? req.get('sec-fetch-site') : headers['sec-fetch-site']) || ''
    ).toLowerCase();

    const host = typeof req.get === 'function' ? req.get('host') : headers.host;
    const protocol = String(req.protocol || (req.secure ? 'https' : 'http')).toLowerCase();
    const requestOrigin = host ? parseOrigin(protocol + '://' + host) : null;
    const allowed = new Set(configuredOrigins);
    if (requestOrigin) allowed.add(requestOrigin);

    const valid = !!origin &&
      (!originHeader || !refererHeader || (!!refererOrigin && refererOrigin === origin)) &&
      fetchSite !== 'cross-site' &&
      allowed.has(origin);

    if (!valid) {
      return res.status(403).json({
        success: false,
        status: 'BLOCKED',
        code: 'HFM_LEARNING_CSRF_ORIGIN_REJECTED'
      });
    }
    return next();
  };
}

module.exports = { createMiraHfmSameOriginWriteGuard };
