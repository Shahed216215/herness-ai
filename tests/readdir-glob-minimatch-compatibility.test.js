'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const readdirGlob = require('readdir-glob');

(async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mira-readdir-glob-'));
  const source = path.join(root, 'source');

  try {
    fs.mkdirSync(path.join(source, 'nested'), { recursive: true });
    fs.mkdirSync(path.join(source, 'ignored'), { recursive: true });
    fs.writeFileSync(path.join(source, 'root.txt'), 'root-file');
    fs.writeFileSync(path.join(source, 'nested', 'child.txt'), 'nested-file');
    fs.writeFileSync(path.join(source, 'ignored', 'skip.txt'), 'ignored-file');
    fs.writeFileSync(path.join(source, 'notes.log'), 'non-matching-file');

    const matches = await new Promise((resolve, reject) => {
      const found = [];
      const globber = readdirGlob(source, {
        pattern: '**/*.txt',
        ignore: ['ignored/**'],
        nodir: true
      });

      globber.on('match', match => found.push(match.relative));
      globber.once('error', reject);
      globber.once('end', () => resolve(found.sort()));
    });

    assert.deepEqual(matches, ['nested/child.txt', 'root.txt'],
      'minimatch override must preserve globstar, extension and ignore behavior');

    console.log('PASS: readdir-glob finds root and nested matching files');
    console.log('PASS: readdir-glob ignore and extension filters are honored');
    console.log('READDIR_GLOB_MINIMATCH_COMPATIBILITY=PASS');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
})().catch(error => {
  console.error('READDIR_GLOB_MINIMATCH_COMPATIBILITY=FAIL');
  console.error(error && error.stack ? error.stack : error);
  process.exitCode = 1;
});
