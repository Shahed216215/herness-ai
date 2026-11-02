'use strict';

const fs = require('fs');
const path = require('path');
const storagePath = require('../mira-storage');
const crypto = require('crypto');

const ROOT = path.resolve(__dirname, '..');
const DATA = storagePath('data');
const AUDIT = path.join(DATA, 'stage16-17-audit.json');
const STATE = path.join(DATA, 'stage16-17-state.json');

function readJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch (e) {
    if (e.code === 'ENOENT') return fallback;
    throw new Error('GOVERNANCE_DATA_INVALID: ' + path.basename(file));
  }
}
function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), {recursive:true});
  const tmp = file + '.tmp-' + process.pid + '-' + crypto.randomUUID();
  try {
    fs.writeFileSync(tmp, JSON.stringify(value, null, 2), {
      mode:0o600, flag:'wx'
    });
    fs.renameSync(tmp, file);
  } catch (e) {
    try { fs.rmSync(tmp, {force:true}); } catch (_) {}
    throw new Error('GOVERNANCE_WRITE_FAILED: ' + path.basename(file));
  }
}
function safeString(v, max=500) {
  if (typeof v !== 'string') return '';
  return v.replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0,max);
}
function initialState() {
  return { emergencyStop:false, updatedAt:new Date().toISOString() };
}
function state() {
  const s = readJson(STATE, initialState());
  if (typeof s.emergencyStop !== 'boolean') {
    throw new Error('GOVERNANCE_STATE_INVALID');
  }
  return s;
}
function audit(event) {
  const integrity = verifyAudit();
  if (!integrity.ok) throw new Error('AUDIT_INTEGRITY_FAILURE');
  const rows = readJson(AUDIT, []);
  if (!Array.isArray(rows)) throw new Error('AUDIT_LOG_INVALID');
  const previous = rows.length ? rows[rows.length-1].hash : 'GENESIS';
  const body = {
    id: crypto.randomUUID(),
    at: new Date().toISOString(),
    action: safeString(event.action,100),
    decision: safeString(event.decision,40),
    reason: safeString(event.reason,300),
    previousHash: previous
  };
  body.hash = crypto.createHash('sha256')
    .update(JSON.stringify(body)).digest('hex');
  rows.push(body);
  writeJson(AUDIT, rows);
  return {id:body.id, decision:body.decision, hash:body.hash};
}
function verifyAudit() {
  const rows = readJson(AUDIT, []);
  if (!Array.isArray(rows)) return {ok:false, reason:'NOT_ARRAY'};
  let previous = 'GENESIS';
  for (const row of rows) {
    const {hash, ...body} = row;
    if (body.previousHash !== previous) {
      return {ok:false, reason:'CHAIN_MISMATCH', id:row.id};
    }
    const expected = crypto.createHash('sha256')
      .update(JSON.stringify(body)).digest('hex');
    if (hash !== expected) {
      return {ok:false, reason:'HASH_MISMATCH', id:row.id};
    }
    previous = hash;
  }
  return {ok:true, entries:rows.length};
}
function emergencyStop() {
  writeJson(STATE, {emergencyStop:true, updatedAt:new Date().toISOString()});
  audit({action:'emergency-stop',decision:'BLOCK',reason:'Emergency stop enabled'});
  return {emergencyStop:true};
}
function resume() {
  state();
  audit({
    action:'emergency-resume',
    decision:'APPROVAL_REQUIRED',
    reason:'Explicit operator resume'
  });
  writeJson(STATE, {
    emergencyStop:false,
    updatedAt:new Date().toISOString()
  });
  return {emergencyStop:false, approvalRequired:true};
}
function check(input={}) {
  const action = safeString(input.action,100);
  const risk = input.risk || 'medium';
  const approvalGranted = input.approvalGranted === true;
  const permitted = input.permitted === true;
  const duplicate = input.duplicate === true;
  const external = input.external === true;
  const clientData = input.clientData === true;

  // Fail closed without appending to an already damaged audit chain.
  let integrity;
  try { integrity = verifyAudit(); }
  catch (_) {
    return {allowed:false,decision:'BLOCK',reason:'Audit unavailable; fail closed'};
  }
  if (!integrity || integrity.ok !== true) {
    return {allowed:false,decision:'BLOCK',reason:'Audit integrity failure; fail closed'};
  }

  let decision = 'BLOCK';
  let reason = 'Permission not explicitly granted';

  try {
    if (state().emergencyStop) reason = 'Emergency stop enabled';
    else if (!action) reason = 'Missing action';
    else if (duplicate) reason = 'Duplicate action prevented';
    else if (input.pathEscape === true) reason = 'File boundary violation';
    else if (input.secretExposure === true) reason = 'Secret exposure prevented';
    else if (input.networkAllowed === false) reason = 'Network boundary denied';
    else if (input.toolAllowed === false) reason = 'Tool permission denied';
    else if (input.rateLimited === true) reason = 'Rate limit exceeded';
    else if (external && !approvalGranted) {
      decision='APPROVAL_REQUIRED'; reason='External communication requires approval';
    } else if (clientData && !input.clientDataAllowed) {
      reason='Client data access not authorized';
    } else if (risk === 'critical' && !approvalGranted) {
      decision='APPROVAL_REQUIRED'; reason='Critical risk requires explicit approval';
    } else if (risk === 'high' && !approvalGranted) {
      decision='APPROVAL_REQUIRED'; reason='High risk requires explicit approval';
    } else if (!['low','medium','high','critical'].includes(risk)) {
      reason='Unknown risk level';
    } else if (permitted) {
      decision='ALLOW'; reason='Policy checks passed';
    } else {
      reason='Permission not explicitly granted';
    }
  } catch (_) {
    reason='Governance state unavailable; fail closed';
    decision='BLOCK';
  }

  let auditResult;
  try { auditResult = audit({action,decision,reason}); }
  catch (_) {
    return {allowed:false,decision:'BLOCK',reason:'Audit unavailable; fail closed'};
  }
  return {allowed:decision==='ALLOW',decision,reason,audit:auditResult};
}

module.exports = {
  check, audit, verifyAudit, emergencyStop, resume,
  getState:state
};
