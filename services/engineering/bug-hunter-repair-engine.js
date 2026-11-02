'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { aggregate } = require('./gate-status-policy');

const BLOCKED = new Set([
  '.git', 'node_modules', 'backups', 'reports', 'tmp',
  'secrets', 'credentials'
]);

function sha256(value) {
  return crypto.createHash('sha256').update(value, 'utf8').digest('hex');
}

function safeRelativePath(value) {
  if (typeof value !== 'string' || !value.trim()) return false;
  if (value.includes('\0') || value.includes('\\')) return false;
  if (value.startsWith('/') || /^[A-Za-z]:/.test(value)) return false;

  const parts = value.split('/');
  if (parts.some(p => !p || p === '.' || p === '..')) return false;
  if (parts.some(p => BLOCKED.has(p.toLowerCase()))) return false;
  if (parts.some(p => /^\.env/i.test(p))) return false;
  if (parts.some(p => /secret|credential|private.key/i.test(p))) return false;
  if (/\.(pem|key|p12|pfx)$/i.test(value)) return false;

  return true;
}

function inside(root, candidate) {
  const rel = path.relative(root, candidate);
  return rel !== '' && rel !== '..' &&
    !rel.startsWith('..' + path.sep) && !path.isAbsolute(rel);
}

function planIdFor(fields) {
  return sha256(JSON.stringify({
    version: 1,
    findingId: fields.findingId,
    file: fields.file,
    sourceHash: fields.sourceHash,
    proposedHash: fields.proposedHash,
    testPaths: fields.testPaths
  }));
}

function createPlan(input) {
  if (!input || typeof input !== 'object') {
    throw new TypeError('repair input required');
  }
  if (!safeRelativePath(input.file)) {
    throw new Error('unsafe target path');
  }
  if (typeof input.currentContent !== 'string' ||
      typeof input.proposedContent !== 'string') {
    throw new TypeError('currentContent and proposedContent must be strings');
  }

  const testPaths = input.testPaths === undefined ? [] : input.testPaths;
  if (!Array.isArray(testPaths) || !testPaths.every(safeRelativePath)) {
    throw new Error('unsafe test path');
  }
  if (testPaths.length > 20) throw new Error('too many test paths');

  const fields = {
    findingId: String(input.findingId || 'unassigned'),
    file: input.file,
    sourceHash: sha256(input.currentContent),
    proposedHash: sha256(input.proposedContent),
    testPaths: [...new Set(testPaths)].sort()
  };

  return Object.freeze({
    version: 1,
    planId: planIdFor(fields),
    ...fields,
    mode: 'ISOLATED_STAGING_ONLY',
    status: 'PROPOSAL_ONLY',
    approvalRequired: true,
    productionApplyAllowed: false
  });
}

function verifyPlan(plan) {
  if (!plan || plan.version !== 1 ||
      !safeRelativePath(plan.file) ||
      !Array.isArray(plan.testPaths) ||
      !plan.testPaths.every(safeRelativePath)) {
    return false;
  }

  const fields = {
    findingId: plan.findingId,
    file: plan.file,
    sourceHash: plan.sourceHash,
    proposedHash: plan.proposedHash,
    testPaths: [...plan.testPaths].sort()
  };

  return /^[a-f0-9]{64}$/.test(plan.sourceHash || '') &&
    /^[a-f0-9]{64}$/.test(plan.proposedHash || '') &&
    plan.planId === planIdFor(fields);
}

function stageRepair(options) {
  // REPAIR_STAGING_DISABLED_TRUST_AUTHORITY_UNAVAILABLE
  // No authenticated, project-owned approval authority is wired yet.
  // Caller-supplied approval fields are not trusted evidence.
  throw new Error('repair staging disabled: trusted approval authority is not configured');
  const o = options || {};
  const root = path.resolve(o.root || process.cwd());
  const plan = o.plan;

  if (!verifyPlan(plan)) throw new Error('invalid or modified repair plan');
  if (typeof o.currentContent !== 'string' ||
      sha256(o.currentContent) !== plan.sourceHash) {
    throw new Error('source hash mismatch; refresh the repair plan');
  }
  if (typeof o.proposedContent !== 'string' ||
      sha256(o.proposedContent) !== plan.proposedHash) {
    throw new Error('proposed content hash mismatch');
  }

  const approval = o.approval;
  if (!approval || approval.planId !== plan.planId ||
      approval.approved !== true ||
      approval.policySource !== 'system_policy' ||
      typeof approval.approvalId !== 'string' ||
      !approval.approvalId.trim()) {
    throw new Error('system policy approval rejected');
  }

  const gateResult = aggregate(o.gates || []);
  if (gateResult.status !== 'APPROVED') {
    throw new Error('mandatory verification gates not passed');
  }

  const source = path.resolve(root, plan.file);
  if (!inside(root, source)) throw new Error('target escapes project root');

  // Require an existing regular source file and bind the plan to disk content.
  let sourceStat;
  try {
    sourceStat = fs.lstatSync(source);
  } catch {
    throw new Error('source file missing; cannot verify on-disk content');
  }
  if (sourceStat.isSymbolicLink() || !sourceStat.isFile()) {
    throw new Error('source must be a regular non-symlink file');
  }
  const diskContent = fs.readFileSync(source, 'utf8');
  if (sha256(diskContent) !== plan.sourceHash ||
      diskContent !== o.currentContent) {
    throw new Error('on-disk source mismatch; refresh the repair plan');
  }

  const stageBase = path.join(root, 'backups', 'bug-hunter-repair-staging');
  const stageRoot = path.resolve(stageBase, plan.planId);
  if (!inside(root, stageRoot) || !inside(stageBase, stageRoot)) {
    throw new Error('invalid staging directory');
  }
  if (fs.existsSync(stageRoot)) {
    throw new Error('staging directory already exists; refusing overwrite');
  }

  // Reject symlinks in existing target path components.
  let cursor = root;
  for (const part of plan.file.split('/')) {
    cursor = path.join(cursor, part);
    if (!fs.existsSync(cursor)) continue;
    const stat = fs.lstatSync(cursor);
    if (stat.isSymbolicLink()) {
      throw new Error('symlink target blocked');
    }
  }

  // Build the complete candidate and manifest in a private temporary
  // directory, then publish the directory with one same-filesystem rename.
  fs.mkdirSync(stageBase, { recursive: true });

  // Reject symlinks along the staging base path.
  let stageCursor = root;
  const stageParts = path.relative(root, stageBase).split(path.sep);
  for (const part of stageParts) {
    if (!part || part === '.') continue;
    stageCursor = path.join(stageCursor, part);
    if (!fs.existsSync(stageCursor)) continue;
    const st = fs.lstatSync(stageCursor);
    if (st.isSymbolicLink()) {
      throw new Error('symlink staging path blocked');
    }
    if (!st.isDirectory()) {
      throw new Error('staging path component is not a directory');
    }
  }

  if (fs.existsSync(stageRoot)) {
    throw new Error('staging directory already exists; refusing overwrite');
  }

  const tempRoot = path.join(
    stageBase,
    '.tmp-' + plan.planId + '-' + crypto.randomBytes(8).toString('hex')
  );
  const finalCandidate = path.join(stageRoot, 'candidate', plan.file);
  const tempCandidate = path.join(tempRoot, 'candidate', plan.file);

  const manifest = {
    version: 1,
    planId: plan.planId,
    findingId: plan.findingId,
    target: plan.file,
    candidate: path.relative(root, finalCandidate),
    sourceHash: plan.sourceHash,
    proposedHash: plan.proposedHash,
    approvalId: approval.approvalId,
    policySource: 'system_policy',
    gateResult,
    status: 'STAGED_REVIEW_REQUIRED',
    productionSourceModified: false,
    testsExecuted: false,
    productionApplyAllowed: false,
    rollbackVerified: false,
    limitations: [
      'Candidate is staged only; production source is never modified.',
      'Gate statuses must be backed by trusted test evidence supplied by the caller.',
      'Test paths are metadata only and are not executed by this engine.',
      'Approval object validation is not a substitute for authenticated policy storage.',
      'Staging is not proof that the proposed fix is correct.'
    ]
  };

  try {
    fs.mkdirSync(path.dirname(tempCandidate), { recursive: true });
    fs.writeFileSync(tempCandidate, o.proposedContent, {
      encoding: 'utf8',
      flag: 'wx',
      mode: 0o600
    });
    fs.writeFileSync(
      path.join(tempRoot, 'manifest.json'),
      JSON.stringify(manifest, null, 2) + '\n',
      { encoding: 'utf8', flag: 'wx', mode: 0o600 }
    );

    // Rename only after both files have been written successfully.
    if (fs.existsSync(stageRoot)) {
      throw new Error('staging directory already exists; refusing overwrite');
    }
    fs.renameSync(tempRoot, stageRoot);
  } catch (error) {
    try {
      if (fs.existsSync(tempRoot)) {
        fs.rmSync(tempRoot, { recursive: true, force: true });
      }
    } catch (cleanupError) {
      error.message += '; TEMP_CLEANUP_FAILED: ' + cleanupError.message;
    }
    throw error;
  }

  return manifest;
}


function verifyStagedArtifact(options) {
  const o = options || {};
  if (typeof o.stagingRoot !== 'string' || !o.stagingRoot ||
      typeof o.planId !== 'string' || !o.planId ||
      !/^[a-f0-9]{64}$/.test(o.expectedProposedHash || '')) {
    throw new Error('staged artifact verification arguments rejected');
  }

  const root = path.resolve(o.stagingRoot);
  const stage = path.resolve(root, o.planId);
  if (!stage.startsWith(root + path.sep)) {
    throw new Error('staging path escaped root');
  }

  const rootStat = fs.lstatSync(root);
  const stageStat = fs.lstatSync(stage);
  if (rootStat.isSymbolicLink() || !rootStat.isDirectory() ||
      stageStat.isSymbolicLink() || !stageStat.isDirectory()) {
    throw new Error('staging root or plan directory is not a safe directory');
  }

  const manifestPath = path.join(stage, 'manifest.json');
  const manifestStat = fs.lstatSync(manifestPath);
  if (manifestStat.isSymbolicLink() || !manifestStat.isFile()) {
    throw new Error('manifest is not a regular file');
  }

  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  if (!manifest || manifest.planId !== o.planId ||
      manifest.status !== 'STAGED_REVIEW_REQUIRED' ||
      manifest.productionApplyAllowed !== false ||
      manifest.productionSourceModified !== false ||
      manifest.proposedHash !== o.expectedProposedHash ||
      typeof manifest.candidate !== 'string' ||
      !safeRelativePath(manifest.candidate)) {
    throw new Error('staged manifest contract rejected');
  }

  const candidatePath = path.resolve(root, manifest.candidate);
  if (!candidatePath.startsWith(stage + path.sep)) {
    throw new Error('candidate path escaped plan directory');
  }

  const candidateStat = fs.lstatSync(candidatePath);
  if (candidateStat.isSymbolicLink() || !candidateStat.isFile()) {
    throw new Error('candidate is not a regular file');
  }

  const actualHash = sha256(fs.readFileSync(candidatePath, 'utf8'));
  if (actualHash !== manifest.proposedHash ||
      actualHash !== o.expectedProposedHash) {
    throw new Error('staged candidate integrity mismatch');
  }

  return Object.freeze({
    verified: true,
    planId: manifest.planId,
    candidateHash: actualHash,
    productionApplyAllowed: false
  });
}

module.exports = {
  verifyStagedArtifact,
  safeRelativePath,
  createPlan,
  verifyPlan,
  stageRepair
};
