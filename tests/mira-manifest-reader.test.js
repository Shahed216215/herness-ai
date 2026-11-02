'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { readManifest } = require('../services/mira-manifest-reader');

function hash(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(value));
}

function run() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mira-manifest-reader-'));
  try {
    const source = 'source content';
    const backup = 'backup content';
    fs.mkdirSync(path.join(root, 'src'), { recursive: true });
    fs.mkdirSync(path.join(root, 'backups'), { recursive: true });
    fs.writeFileSync(path.join(root, 'src', 'app.js'), source);
    fs.writeFileSync(path.join(root, 'backups', 'app.js'), backup);

    const manifest = {
      manifest_type: 'MIRA_SEO_ENGINE_COMPLETION_EVIDENCE',
      manifest_version: '1.0.0',
      project: 'Reader test',
      overall_status: 'COMPLETED_WITH_LIMITATIONS',
      production_ready: false,
      verified_source_files: [{
        path: 'src/app.js', sha256: hash(source), status: 'PASS'
      }],
      verified_backups: [{
        path: 'backups/app.js', sha256: hash(backup), status: 'PASS'
      }],
      final_shell_audit: { status: 'PASS' },
      targeted_regression: { status: 'PASS' },
      local_runtime_evidence: { status: 'PASS' }
    };

    writeJson(path.join(root, 'manifest.json'), manifest);
    fs.writeFileSync(path.join(root, '.env'), 'PRIVATE_TEST_SENTINEL');

    let result = readManifest({
      root, manifestPath: 'manifest.json'
    });
    assert.equal(result.manifest_status, 'PASS');
    assert.equal(result.source_results[0].status, 'PASS');
    assert.equal(result.backup_results[0].status, 'PASS');
    assert.equal(result.integrity_status, 'INCONCLUSIVE');
    assert.ok(!result.unverified_files.includes('manifest.json'));
    assert.equal(result.unverified_file_count, 1);
    assert.equal(result.sensitive_unverified_count, 1);
    assert.ok(!result.unverified_files.includes('.env'));

    fs.writeFileSync(path.join(root, 'src', 'app.js'), 'tampered');
    result = readManifest({ root, manifestPath: 'manifest.json' });
    assert.equal(result.source_results[0].status, 'FAIL');
    assert.equal(result.integrity_status, 'FAIL');

    fs.writeFileSync(path.join(root, 'src', 'app.js'), source);
    fs.unlinkSync(path.join(root, 'backups', 'app.js'));
    result = readManifest({ root, manifestPath: 'manifest.json' });
    assert.equal(result.backup_results[0].status, 'INCONCLUSIVE');

    const invalidRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'mira-manifest-invalid-'));
    try {
      writeJson(path.join(invalidRoot, 'bad.json'), { manifest_type: 'WRONG' });
      result = readManifest({ root: invalidRoot, manifestPath: 'bad.json' });
      assert.equal(result.manifest_status, 'FAIL');
    } finally {
      fs.rmSync(invalidRoot, { recursive: true, force: true });
    }

    console.log('MIRA_MANIFEST_READER_TEST_CASES=4');
    console.log('MIRA_MANIFEST_READER_TEST=PASS');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

run();
