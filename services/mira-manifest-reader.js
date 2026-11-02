'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const MAX_FILES = 20000;

function sha256(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

function safeRelativePath(root, input) {
  if (typeof input !== 'string' || !input.trim() ||
      path.isAbsolute(input) || input.includes('\0')) {
    throw new Error('UNSAFE_OR_INVALID_PATH');
  }

  const parts = input.split(/[\\/]+/);
  if (parts.some(p => !p || p === '.' || p === '..')) {
    throw new Error('PATH_TRAVERSAL_BLOCKED');
  }

  const candidate = path.resolve(root, ...parts);
  const relative = path.relative(root, candidate);
  if (!relative || relative.startsWith('..' + path.sep) ||
      relative === '..' || path.isAbsolute(relative)) {
    throw new Error('PATH_OUTSIDE_ROOT');
  }

  let current = root;
  for (const part of parts) {
    current = path.join(current, part);
    let st;
    try {
      st = fs.lstatSync(current);
    } catch (err) {
      if (err.code === 'ENOENT') return { candidate, missing: true };
      throw err;
    }
    if (st.isSymbolicLink()) throw new Error('SYMLINK_BLOCKED');
  }

  return { candidate, missing: false };
}

function readAllFromFd(fd) {
  const chunks = [];
  const chunkSize = 64 * 1024;

  while (true) {
    const buffer = Buffer.allocUnsafe(chunkSize);
    const bytesRead = fs.readSync(
      fd, buffer, 0, buffer.length, null
    );
    if (bytesRead === 0) break;
    chunks.push(buffer.subarray(0, bytesRead));
  }

  return Buffer.concat(chunks);
}

function statOpenedFile(fd) {
  const procFdPath = "/proc/self/fd/" + fd;
  let st;

  try {
    st = fs.statSync(procFdPath);
  } catch (err) {
    const failure = new Error("FD_METADATA_UNAVAILABLE");
    failure.cause = err;
    throw failure;
  }

  if (!st.isFile()) throw new Error("NOT_REGULAR_FILE");
  return st;
}

function hashSafeFile(root, input) {
  const checked = safeRelativePath(root, input);
  if (checked.missing) return { status: 'INCONCLUSIVE', reason: 'MISSING' };

  const flags = fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0);
  const fd = fs.openSync(checked.candidate, flags);
  try {
    const st = statOpenedFile(fd);
    if (!st.isFile()) throw new Error('NOT_REGULAR_FILE');
    const data = readAllFromFd(fd);
    return { status: 'PASS', sha256: sha256(data), size: data.length };
  } finally {
    fs.closeSync(fd);
  }
}

function validateManifest(m, options = {}) {
  if (!m || typeof m !== 'object' || Array.isArray(m)) {
    throw new Error('MANIFEST_NOT_OBJECT');
  }
  if (typeof m.manifest_type !== 'string' || !m.manifest_type.trim()) {
    throw new Error('MANIFEST_TYPE_INVALID');
  }
  if (typeof m.manifest_version !== 'string' || !m.manifest_version.trim()) {
    throw new Error('MANIFEST_VERSION_INVALID');
  }
  if (options.expectedManifestType &&
      m.manifest_type !== options.expectedManifestType) {
    throw new Error('MANIFEST_TYPE_MISMATCH');
  }
  if (options.expectedManifestVersion &&
      m.manifest_version !== options.expectedManifestVersion) {
    throw new Error('MANIFEST_VERSION_UNSUPPORTED');
  }
  if (!Array.isArray(m.verified_source_files) ||
      !Array.isArray(m.verified_backups)) {
    throw new Error('MANIFEST_FILE_LISTS_INVALID');
  }

  for (const entry of [
    ...m.verified_source_files,
    ...m.verified_backups
  ]) {
    if (!entry || typeof entry.path !== 'string' ||
        !/^[a-f0-9]{64}$/i.test(entry.sha256 || '')) {
      throw new Error('MANIFEST_ENTRY_INVALID');
    }
  }
}

function inventory(root) {
  const files = [];
  const errors = [];
  function walk(dir, rel) {
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch (err) {
      errors.push({ path: rel || '.', reason: err.code || 'READ_ERROR' });
      return;
    }

    for (const entry of entries) {
      if (entry.name === '.git' || entry.name === 'node_modules') continue;
      const abs = path.join(dir, entry.name);
      const childRel = rel ? `${rel}/${entry.name}` : entry.name;

      let st;
      try {
        st = fs.lstatSync(abs);
      } catch (err) {
        errors.push({ path: childRel, reason: err.code || 'STAT_ERROR' });
        continue;
      }

      if (st.isSymbolicLink()) {
        errors.push({ path: childRel, reason: 'SYMLINK_NOT_FOLLOWED' });
      } else if (st.isDirectory()) {
        walk(abs, childRel);
      } else if (st.isFile()) {
        files.push(childRel);
        if (files.length > MAX_FILES) {
          throw new Error('INVENTORY_FILE_LIMIT_EXCEEDED');
        }
      }
    }
  }
  walk(root, '');
  return { files, errors };
}

function isSensitivePath(value) {
  const parts = String(value).replace(/\\/g, '/').split('/');
  return parts.some(part =>
    /^\.env(?:\.|$)/i.test(part) ||
    /(^|[._-])(secret|secrets|credential|credentials|token|tokens|private[-_.]?key|api[-_.]?key)([._-]|$)/i.test(part)
  );
}

function readManifest(options = {}) {
  const root = fs.realpathSync(options.root || process.cwd());
  const manifestPath = options.manifestPath ||
    'reports/seo-v1-completion/MANIFEST-20261031.json';

  let manifest;
  try {
    const checked = safeRelativePath(root, manifestPath);
    if (checked.missing) throw new Error('MANIFEST_MISSING');
    const fd = fs.openSync(
      checked.candidate,
      fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0)
    );
    try {
      const st = statOpenedFile(fd);
      if (!st.isFile()) throw new Error('MANIFEST_NOT_REGULAR_FILE');
      manifest = JSON.parse(readAllFromFd(fd).toString('utf8'));
    } finally {
      fs.closeSync(fd);
    }
    validateManifest(manifest, options);
    if (options.expectedProject &&
        manifest.project !== options.expectedProject) {
      throw new Error('PROJECT_MISMATCH');
    }
  } catch (err) {
    return {
      integrity_status: 'FAIL',
      manifest_status: 'FAIL',
      project_status: err.message === 'PROJECT_MISMATCH'
        ? 'PROJECT_MISMATCH' : 'NOT_VERIFIED',
      error: err.message,
      source_results: [],
      backup_results: [],
      unverified_files: [],
      inventory_errors: []
    };
  }

  function verifyEntries(entries, kind) {
    return entries.map(entry => {
      try {
        const actual = hashSafeFile(root, entry.path);
        if (actual.status !== 'PASS') {
          return { kind, path: entry.path, status: 'INCONCLUSIVE',
            reason: actual.reason };
        }
        const match = actual.sha256.toLowerCase() === entry.sha256.toLowerCase();
        return {
          kind,
          path: entry.path,
          status: match ? 'PASS' : 'FAIL',
          expected_sha256: entry.sha256,
          actual_sha256: actual.sha256,
          size: actual.size
        };
      } catch (err) {
        return { kind, path: entry.path, status: 'INCONCLUSIVE',
          reason: err.message };
      }
    });
  }

  const sourceResults = verifyEntries(manifest.verified_source_files, 'SOURCE');
  const backupResults = verifyEntries(manifest.verified_backups, 'BACKUP');

  const normalizeManifestPath = value =>
    String(value).replace(/\\/g, '/');

  const represented = new Set([
    ...manifest.verified_source_files.map(x => normalizeManifestPath(x.path)),
    ...manifest.verified_backups.map(x => normalizeManifestPath(x.path)),
    normalizeManifestPath(manifestPath)
  ]);

  const inv = inventory(root);
  const unverified = inv.files.filter(
    file => !represented.has(normalizeManifestPath(file))
  );
  const sensitiveUnverified = unverified.filter(isSensitivePath);
  const visibleUnverified = unverified.filter(file => !isSensitivePath(file));
  const safeInventoryErrors = inv.errors.map(item => ({
    path: isSensitivePath(item.path) ? '[REDACTED]' : item.path,
    reason: item.reason
  }));

  const allResults = [...sourceResults, ...backupResults];
  const hasFail = allResults.some(x => x.status === 'FAIL');
  const hasUncertain = allResults.some(x => x.status !== 'PASS') ||
    inv.errors.length > 0 || unverified.length > 0;

  return {
    integrity_status: hasFail ? 'FAIL' :
      hasUncertain ? 'INCONCLUSIVE' : 'PASS',
    manifest_status: 'PASS',
    project_status: options.expectedProject
      ? 'PASS' : 'NOT_CHECKED',
    manifest: {
      type: manifest.manifest_type,
      version: manifest.manifest_version,
      project: manifest.project,
      overall_status: manifest.overall_status,
      production_ready: manifest.production_ready
    },
    source_results: sourceResults,
    backup_results: backupResults,
    unverified_files: visibleUnverified,
    unverified_file_count: unverified.length,
    sensitive_unverified_count: sensitiveUnverified.length,
    redacted_unverified_count: sensitiveUnverified.length,
    inventory_errors: safeInventoryErrors,
    inventory_error_count: inv.errors.length,
    historical_evidence: {
      shell_audit: manifest.final_shell_audit?.status || 'NOT_RUN',
      targeted_regression: manifest.targeted_regression?.status || 'NOT_RUN',
      local_runtime: manifest.local_runtime_evidence?.status || 'NOT_RUN',
      production_ready: manifest.production_ready === true
    },
    execution: {
      files_written: false,
      files_deleted: false,
      files_restored: false,
      tests_executed: false,
      network_access: false
    }
  };
}

module.exports = { readManifest };
