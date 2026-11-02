'use strict';

const path = require('node:path');
const { readManifest } = require('../services/mira-manifest-reader');

function usage() {
  console.log([
    'Mira Generic Manifest Reader (read-only)',
    '',
    'Usage:',
    '  node tools/mira-manifest-reader-cli.js --manifest-read-only',
    '    --root <project-directory>',
    '    --manifest <relative-manifest-path>',
    '    --project <expected-project-name>',
    '    --type <expected-manifest-type>',
    '    --version <expected-manifest-version>',
    '',
    'Exit codes: 0=PASS, 1=FAIL, 2=INCONCLUSIVE, 64=USAGE_ERROR'
  ].join('\n'));
}

function parseArgs(argv) {
  const values = {};
  const allowed = new Set([
    '--manifest-read-only',
    '--root',
    '--manifest',
    '--project',
    '--type',
    '--version'
  ]);

  for (let i = 0; i < argv.length; i++) {
    const key = argv[i];
    if (!allowed.has(key)) throw new Error('UNKNOWN_ARGUMENT:' + key);
    if (key === '--manifest-read-only') {
      if (values.readOnly) throw new Error('DUPLICATE_ARGUMENT:' + key);
      values.readOnly = true;
      continue;
    }
    if (values[key] !== undefined) throw new Error('DUPLICATE_ARGUMENT:' + key);
    const value = argv[++i];
    if (!value || value.startsWith('--')) {
      throw new Error('MISSING_ARGUMENT_VALUE:' + key);
    }
    values[key] = value;
  }

  if (!values.readOnly) throw new Error('READ_ONLY_FLAG_REQUIRED');
  if (!values['--root']) throw new Error('ROOT_REQUIRED');
  if (!values['--manifest']) throw new Error('MANIFEST_REQUIRED');
  if (!values['--project']) throw new Error('EXPECTED_PROJECT_REQUIRED');
  if (!values['--type']) throw new Error('EXPECTED_MANIFEST_TYPE_REQUIRED');
  if (!values['--version']) throw new Error('EXPECTED_MANIFEST_VERSION_REQUIRED');

  if (path.isAbsolute(values['--manifest'])) {
    throw new Error('MANIFEST_PATH_MUST_BE_RELATIVE');
  }

  return values;
}

function main() {
  let args;
  try {
    args = parseArgs(process.argv.slice(2));
  } catch (err) {
    console.error('CLI_STATUS=USAGE_ERROR');
    console.error('ERROR=' + err.message);
    usage();
    process.exitCode = 64;
    return;
  }

  const root = path.resolve(args['--root']);
  const result = readManifest({
    root,
    manifestPath: args['--manifest'],
    expectedProject: args['--project'],
    expectedManifestType: args['--type'],
    expectedManifestVersion: args['--version']
  });

  const output = {
    mode: 'MANIFEST_READ_ONLY',
    project_root: root,
    manifest_path: args['--manifest'],
    ...result
  };

  console.log(JSON.stringify(output, null, 2));

  if (result.integrity_status === 'FAIL') {
    process.exitCode = 1;
  } else if (result.integrity_status === 'INCONCLUSIVE') {
    process.exitCode = 2;
  } else if (result.integrity_status !== 'PASS') {
    process.exitCode = 2;
  } else {
    process.exitCode = 0;
  }
}

if (require.main === module) main();

module.exports = { parseArgs };
