'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const DEFAULT_FILE = path.join(__dirname, '..', 'data', 'provider-credentials.enc.json');

function createStore(options = {}) {
  const filePath = options.filePath || DEFAULT_FILE;
  const getMasterKey = options.getMasterKey ||
    (() => process.env.MIRA_CREDENTIALS_ENCRYPTION_KEY || '');

  function deriveKey(salt = Buffer.from('mira-provider-credentials-v1', 'utf8')) {
    const secret = getMasterKey();
    if (typeof secret !== 'string' || Buffer.byteLength(secret, 'utf8') < 32) {
      const err = new Error('Credential encryption is not configured.');
      err.code = 'CREDENTIAL_ENCRYPTION_NOT_CONFIGURED';
      throw err;
    }
    return crypto.scryptSync(secret, salt, 32);
  }

  function readAll() {
    if (!fs.existsSync(filePath)) return {};
    const r = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    if (!r || ![1, 2].includes(r.version) || r.algorithm !== 'aes-256-gcm' ||
        typeof r.iv !== 'string' || typeof r.tag !== 'string' ||
        typeof r.data !== 'string') {
      throw new Error('Credential store format is invalid.');
    }
    const iv = Buffer.from(r.iv, 'base64');
    const tag = Buffer.from(r.tag, 'base64');
    const salt = r.version === 2 && typeof r.salt === 'string'
      ? Buffer.from(r.salt, 'base64') : null;
    if (iv.length !== 12 || tag.length !== 16 ||
        (r.version === 2 && (!salt || salt.length !== 16))) {
      throw new Error('Credential store cryptographic parameters are invalid.');
    }
    const legacySalt = Buffer.from('mira-provider-credentials-v1', 'utf8');
    const decipher = crypto.createDecipheriv(
      'aes-256-gcm',
      r.version === 2 ? deriveKey(salt) : deriveKey(legacySalt),
      iv
    );
    decipher.setAuthTag(Buffer.from(r.tag, 'base64'));
    const plain = Buffer.concat([
      decipher.update(Buffer.from(r.data, 'base64')), decipher.final()
    ]).toString('utf8');
    const entries = JSON.parse(plain);
    if (!entries || typeof entries !== 'object' || Array.isArray(entries)) {
      throw new Error('Credential store payload is invalid.');
    }
    return entries;
  }

  function writeAll(entries) {
    const salt = crypto.randomBytes(16);
    const nonce = crypto.randomBytes(12);
    const c = crypto.createCipheriv('aes-256-gcm', deriveKey(salt), nonce);
    const encrypted = Buffer.concat([c.update(JSON.stringify(entries), 'utf8'), c.final()]);
    const record = JSON.stringify({
      version: 2, algorithm: 'aes-256-gcm',
      salt: salt.toString('base64'),
      iv: nonce.toString('base64'),
      tag: c.getAuthTag().toString('base64'),
      data: encrypted.toString('base64')
    }) + '\n';

    fs.mkdirSync(path.dirname(filePath), { recursive: true, mode: 0o700 });
    const temp = filePath + '.tmp-' + process.pid + '-' + crypto.randomBytes(5).toString('hex');
    let fd;
    try {
      fd = fs.openSync(temp, 'wx', 0o600);
      fs.writeFileSync(fd, record, 'utf8');
      fs.fsyncSync(fd);
      fs.closeSync(fd);
      fd = undefined;
      fs.renameSync(temp, filePath);
      fs.chmodSync(filePath, 0o600);
    } catch (e) {
      if (fd !== undefined) { try { fs.closeSync(fd); } catch {} }
      try { fs.unlinkSync(temp); } catch {}
      throw e;
    }
  }

  function validateProvider(p) {
    if (typeof p !== 'string' ||
        !/^(openai|gemini|groq|deepseek|openrouter|huggingface|anthropic|xai|custom[1-5])$/.test(p)) {
      throw new Error('Unsupported provider identifier.');
    }
  }

  function list() {
    const result = {};
    for (const [p, item] of Object.entries(readAll())) {
      if (item && typeof item.key === 'string' && item.key) {
        result[p] = {
          configured: true,
          hint: '••••' + item.key.slice(-4),
          model: typeof item.model === 'string' ? item.model : ''
        };
      }
    }
    return result;
  }

  function set(provider, key, model = '') {
    validateProvider(provider);
    if (typeof key !== 'string' || key.length < 8 || key.length > 8192 ||
        key.trim() !== key || /[\r\n\0]/.test(key)) {
      throw new Error('API key format is invalid.');
    }
    if (typeof model !== 'string' || model.length > 256 || /[\r\n\0]/.test(model)) {
      throw new Error('Model ID format is invalid.');
    }
    const entries = readAll();
    entries[provider] = { key, model, updatedAt: new Date().toISOString() };
    writeAll(entries);
    return list()[provider];
  }

  function reveal(provider) {
    validateProvider(provider);
    const item = readAll()[provider];
    return item && typeof item.key === 'string'
      ? { key: item.key, model: item.model || '' } : null;
  }

  function remove(provider) {
    validateProvider(provider);
    const entries = readAll();
    if (!Object.prototype.hasOwnProperty.call(entries, provider)) return false;
    delete entries[provider];
    writeAll(entries);
    return true;
  }

  return Object.freeze({ list, set, reveal, remove });
}

const store = createStore();
module.exports = Object.freeze({
  createStore,
  list: store.list,
  set: store.set,
  reveal: store.reveal,
  remove: store.remove
});
