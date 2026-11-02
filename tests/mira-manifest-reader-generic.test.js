'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');

const { parseArgs } = require('../tools/mira-manifest-reader-cli');
const { readManifest } = require('../services/mira-manifest-reader');

function hash(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function run() {
  const baseArgs = [
    '--manifest-read-only',
    '--root', './fixture',
    '--manifest', 'MANIFEST.json',
    '--project', 'Generic Fixture',
    '--type', 'MIRA_GENERIC_EVIDENCE',
    '--version', '1.0.0'
  ];

  const parsed = parseArgs(baseArgs);
  assert.equal(parsed.readOnly, true);
  assert.equal(parsed['--project'], 'Generic Fixture');

  assert.throws(
    () => parseArgs(baseArgs.filter(x => x !== '--type' && x !== 'MIRA_GENERIC_EVIDENCE')),
    /EXPECTED_MANIFEST_TYPE_REQUIRED/
  );

  assert.throws(
    () => parseArgs(baseArgs.filter(x => x !== '--version' && x !== '1.0.0')),
    /EXPECTED_MANIFEST_VERSION_REQUIRED/
  );

  assert.throws(
    () => parseArgs([...baseArgs, '--unknown']),
    /UNKNOWN_ARGUMENT/
  );

  assert.throws(
    () => parseArgs(baseArgs.map((x, i) =>
      x === 'MANIFEST.json' ? '/tmp/MANIFEST.json' : x
    )),
    /MANIFEST_PATH_MUST_BE_RELATIVE/
  );

  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mira-generic-reader-'));
  try {
    fs.mkdirSync(path.join(root, 'src'), { recursive: true });
    fs.mkdirSync(path.join(root, 'backups'), { recursive: true });

    const source = 'generic source fixture';
    const backup = 'generic backup fixture';
    fs.writeFileSync(path.join(root, 'src', 'app.js'), source);
    fs.writeFileSync(path.join(root, 'backups', 'app.js'), backup);

    const manifest = {
      manifest_type: 'MIRA_GENERIC_EVIDENCE',
      manifest_version: '1.0.0',
      project: 'Generic Fixture',
      verified_source_files: [
        { path: 'src/app.js', sha256: hash(source) }
      ],
      verified_backups: [
        { path: 'backups/app.js', sha256: hash(backup) }
      ]
    };

    fs.writeFileSync(
      path.join(root, 'MANIFEST.json'),
      JSON.stringify(manifest)
    );

    const good = readManifest({
      root,
      manifestPath: 'MANIFEST.json',
      expectedProject: 'Generic Fixture',
      expectedManifestType: 'MIRA_GENERIC_EVIDENCE',
      expectedManifestVersion: '1.0.0'
    });

    assert.equal(good.manifest_status, 'PASS');
    assert.equal(good.project_status, 'PASS');
    assert.equal(good.integrity_status, 'PASS');
    assert.equal(good.source_results[0].status, 'PASS');
    assert.equal(good.backup_results[0].status, 'PASS');
    assert.equal(good.execution.tests_executed, false);
    assert.equal(good.execution.files_written, false);

    const wrongProject = readManifest({
      root,
      manifestPath: 'MANIFEST.json',
      expectedProject: 'Different Project',
      expectedManifestType: 'MIRA_GENERIC_EVIDENCE',
      expectedManifestVersion: '1.0.0'
    });

    assert.equal(wrongProject.project_status, 'PROJECT_MISMATCH');
    assert.equal(wrongProject.integrity_status, 'FAIL');

    const wrongType = readManifest({
      root,
      manifestPath: 'MANIFEST.json',
      expectedProject: 'Generic Fixture',
      expectedManifestType: 'WRONG_TYPE',
      expectedManifestVersion: '1.0.0'
    });
    assert.equal(wrongType.manifest_status, 'FAIL');

    const wrongVersion = readManifest({
      root,
      manifestPath: 'MANIFEST.json',
      expectedProject: 'Generic Fixture',
      expectedManifestType: 'MIRA_GENERIC_EVIDENCE',
      expectedManifestVersion: '9.9.9'
    });
    assert.equal(wrongVersion.manifest_status, 'FAIL');

    console.log('MIRA_GENERIC_MANIFEST_TEST_CASES=9');
    console.log('MIRA_GENERIC_MANIFEST_TEST=READY_NOT_EXECUTED');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

run();
