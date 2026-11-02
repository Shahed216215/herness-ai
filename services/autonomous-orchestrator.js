'use strict';

const fs = require('fs');
const path = require('path');
const storagePath = require('../mira-storage');
const crypto = require('crypto');
const safety = require('./global-safety-governance');
const scopeService = require('./mira-work-scope-record-service');
const recoveryEngine = require('./work-failure-recovery-engine');

const ROOT = path.resolve(__dirname, '..');
const STORE = process.env.MIRA_STAGE16_17_WORKFLOWS_FILE ||
  storagePath('data/stage16-17-workflows.json');

const STAGES = [
  'find_work','analyze','capability_match','proposal',
  'client_communication','acceptance','planning','execution',
  'qa','delivery','feedback','learning','improvement_proposal'
];
const jobs = new Map();

function clean(v, n=500) {
  return typeof v === 'string'
    ? v.replace(/[\u0000-\u001f\u007f]/g,' ').trim().slice(0,n)
    : '';
}
function clone(value) { return structuredClone(value); }

function validateJob(job) {
  return !!job && typeof job.id === 'string' &&
    typeof job.command === 'string' &&
    typeof job.status === 'string' &&
    Array.isArray(job.completedStages) &&
    job.completedStages.every((s,i) => STAGES[i] === s) &&
    Array.isArray(job.outputs);
}
function loadStore() {
  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(STORE, 'utf8'));
  } catch (e) {
    if (e.code === 'ENOENT') return;
    throw new Error('ORCHESTRATOR_STORE_INVALID; refusing startup');
  }
  if (!parsed || parsed.version !== 1 || !Array.isArray(parsed.jobs) ||
      !parsed.jobs.every(validateJob)) {
    throw new Error('ORCHESTRATOR_STORE_INVALID; refusing startup');
  }
  for (const job of parsed.jobs) {
    if (jobs.has(job.id)) {
      throw new Error('ORCHESTRATOR_STORE_DUPLICATE_ID; refusing startup');
    }
    jobs.set(job.id, clone(job));
  }
}
function persist() {
  fs.mkdirSync(path.dirname(STORE), {recursive:true});
  const tmp = STORE + '.tmp-' + process.pid + '-' + crypto.randomUUID();
  try {
    fs.writeFileSync(tmp, JSON.stringify({
      version:1,
      updatedAt:new Date().toISOString(),
      jobs:[...jobs.values()]
    }, null, 2), {mode:0o600, flag:'wx'});
    fs.renameSync(tmp, STORE);
  } catch (e) {
    try { fs.rmSync(tmp, {force:true}); } catch (_) {}
    throw new Error('ORCHESTRATOR_PERSIST_FAILED');
  }
}
loadStore();

function parseCommand(command) {
  const text = clean(command,1000);
  if (!text) return {intent:'unknown', query:''};
  if (/client|message|reply|উত্তর|মেসেজ/i.test(text))
    return {intent:'client_communication',query:text};
  if (/proposal|প্রস্তাব/i.test(text))
    return {intent:'proposal',query:text};
  if (/excel|work|job|কাজ|খুঁজে|find/i.test(text))
    return {intent:'find_work',query:text};
  return {intent:'analyze',query:text};
}
function create(input={}) {
  const command = clean(input.command,1000);
  if (!command) throw new Error('COMMAND_REQUIRED');
  const now = new Date().toISOString();
  const id = crypto.createHash('sha256')
    .update(command + ':' + crypto.randomUUID()).digest('hex').slice(0,24);
  const job = {
    id, command, intent:parseCommand(command).intent,
    status:'created', currentStage:null, completedStages:[],
    createdAt:now, updatedAt:now, outputs:[],
    requiresHumanApproval:true, approvedStage:null
  };
  jobs.set(id,job);
  try { persist(); }
  catch (e) { jobs.delete(id); throw e; }
  return clone(job);
}
function advance(id, input={}) {
  const job = jobs.get(id);
  if (!job) throw new Error('JOB_NOT_FOUND');
  if (job.status==='completed' || job.status==='blocked' || job.status==='recovery_required')
    throw new Error('JOB_TERMINAL');
  const index = job.completedStages.length;
  if (index >= STAGES.length) throw new Error('WORKFLOW_FINISHED');
  const stage = STAGES[index];
  const before = clone(job);
  const approved = job.approvedStage === stage;

  // A supplied acceptance record must validate before the acceptance stage
  // can complete. Legacy workflow requests without acceptance fields retain
  // their existing transition contract until the client API is migrated.
  let acceptedScope = null;
  const hasScopeInput =
    input.acceptanceStatus !== undefined ||
    input.workScope !== undefined ||
    input.expectedScope !== undefined;

  if (stage === 'acceptance' && hasScopeInput) {
    const checked = scopeService.buildAcceptedWorkScope({
      status: input.acceptanceStatus,
      workScope: input.workScope,
      expectedScope: input.expectedScope || {}
    });

    if (!checked.valid) {
      job.currentStage = stage;
      job.status = 'blocked';
      job.lastGate = {
        decision: 'BLOCK',
        reason: 'WORK_SCOPE_INVALID'
      };
      job.scopeValidation = {
        valid: false,
        errors: checked.errors
      };
      job.updatedAt = new Date().toISOString();
      try {
        safety.audit({
          action: 'workflow-scope-validation:' + id,
          decision: 'BLOCKED',
          reason: 'Acceptance scope missing or inconsistent'
        });
        persist();
      } catch (error) {
        jobs.set(id, before);
        throw error;
      }
      return {
        job: clone(job),
        gate: {
          allowed: false,
          decision: 'BLOCK',
          reason: 'WORK_SCOPE_INVALID'
        }
      };
    }
    acceptedScope = checked.workScope;
  }

  // Explicitly reported execution failure is never recorded as a completed
  // stage. Recovery is tracked for review; this service does not execute
  // arbitrary caller-provided code or fabricate a successful result.
  if (stage === 'execution' && input.executionFailure === true) {
    const recovery = recoveryEngine.createRecovery({id: job.id});
    recoveryEngine.diagnose(
      recovery,
      typeof input.failureReason === 'string'
        ? input.failureReason.slice(0, 300)
        : 'execution_failed'
    );
    job.currentStage = stage;
    job.status = 'recovery_required';
    job.recovery = recovery;
    job.lastGate = {
      decision: 'BLOCK',
      reason: 'EXECUTION_FAILED_RECOVERY_REQUIRED'
    };
    job.updatedAt = new Date().toISOString();
    try {
      safety.audit({
        action: 'workflow-recovery-required:' + id,
        decision: 'BLOCKED',
        reason: 'Execution failure recorded; verified recovery required'
      });
      persist();
    } catch (error) {
      jobs.set(id, before);
      throw error;
    }
    return {
      job: clone(job),
      gate: {
        allowed: false,
        decision: 'BLOCK',
        reason: 'EXECUTION_FAILED_RECOVERY_REQUIRED'
      }
    };
  }
  const gate = safety.check({
    action:'orchestrator:'+stage,
    permitted:input.permitted===true,
    approvalGranted:approved,
    risk:input.risk || 'medium',
    external:stage==='client_communication' || stage==='delivery',
    duplicate:false,
    secretExposure:input.secretExposure===true,
    pathEscape:input.pathEscape===true,
    networkAllowed:input.networkAllowed,
    toolAllowed:input.toolAllowed,
    rateLimited:input.rateLimited===true,
    clientData:input.clientData===true,
    clientDataAllowed:input.clientDataAllowed===true
  });
  job.currentStage=stage;
  job.lastGate={decision:gate.decision,reason:gate.reason};
  job.updatedAt=new Date().toISOString();

  if (!gate.allowed) {
    job.status=gate.decision==='APPROVAL_REQUIRED'?'awaiting_approval':'blocked';
  } else {
    if (acceptedScope) {
      job.acceptedWorkScope = acceptedScope;
      job.scopeValidation = {valid: true, errors: []};
    }
    job.completedStages.push(stage);
    job.status=job.completedStages.length===STAGES.length?'completed':'running';
    if (approved) job.approvedStage=null;
    if (input.output !== undefined) {
      job.outputs.push({stage,summary:clean(String(input.output),1000)});
    }
  }
  try { persist(); }
  catch (e) { jobs.set(id,before); throw e; }
  return {job:clone(job),gate};
}
function approve(id, input={}) {
  if (input.authorized!==true) throw new Error('APPROVAL_AUTHORIZATION_REQUIRED');
  const job=jobs.get(id);
  if (!job) throw new Error('JOB_NOT_FOUND');
  if (job.status!=='awaiting_approval') throw new Error('NO_PENDING_APPROVAL');

  const before=clone(job);
  try {
    job.status='running';
    job.approvedStage=job.currentStage;
    job.lastApprovalAt=new Date().toISOString();
    job.updatedAt=new Date().toISOString();

    // Persist approval before recording it as APPROVED in the audit.
    // If persistence fails, no successful-approval event is emitted.
    persist();
    safety.audit({
      action:'workflow-approval:'+id,
      decision:'APPROVED',
      reason:'Authorized operator approval for '+job.currentStage
    });
    return clone(job);
  } catch (error) {
    jobs.set(id,before);
    try { persist(); } catch (_) {}
    try {
      safety.audit({
        action:'workflow-approval-failed:'+id,
        decision:'BLOCKED',
        reason:'Approval audit or persistence failed; prior state restoration attempted'
      });
    } catch (_) {}
    throw error;
  }
}

function get(id) {
  const job=jobs.get(id);
  return job ? clone(job) : null;
}
function list() { return [...jobs.values()].map(clone); }
function capabilities() {
  return {
    stages:[...STAGES],
    persistence:'atomic-json',
    externalActionsRequireApproval:true,
    executionRequiresExplicitPermission:true,
    autonomousExternalExecution:false
  };
}
/* MIRA_CHAT37_LOCKED_API */
const api = {
  STAGES, parseCommand, create, advance, approve, get, list, capabilities
};

function withStoreLock(operation) {
  const lockPath = STORE + '.write-lock';
  const deadline = Date.now() + 15000;
  let acquired = false;

  while (!acquired) {
    try {
      fs.mkdirSync(lockPath);
      acquired = true;
      try {
        fs.writeFileSync(
          path.join(lockPath, 'owner.json'),
          JSON.stringify({pid: process.pid, startedAt: Date.now()}),
          {flag: 'wx', mode: 0o600}
        );
      } catch (error) {
        try { fs.rmSync(lockPath, {recursive:true, force:true}); } catch (_) {}
        throw error;
      }
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;

      let stale = false;
      try {
        stale = Date.now() - fs.statSync(lockPath).mtimeMs > 120000;
      } catch (e) {
        if (e.code === 'ENOENT') continue;
        throw e;
      }
      if (stale) {
        try { fs.rmSync(lockPath, {recursive:true, force:true}); } catch (_) {}
        continue;
      }
      if (Date.now() >= deadline) {
        throw new Error('ORCHESTRATOR_STORE_LOCK_TIMEOUT');
      }
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 10);
    }
  }

  try {
    jobs.clear();
    loadStore();
    return operation();
  } finally {
    fs.rmSync(lockPath, {recursive:true, force:true});
  }
}

for (const method of ['create', 'advance', 'approve', 'get', 'list']) {
  const original = api[method];
  api[method] = (...args) => withStoreLock(() => original(...args));
}
module.exports = api;
