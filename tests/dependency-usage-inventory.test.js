'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const roots = ['services', 'routes', 'tools', 'providers', 'scripts'];
const files = fs.readdirSync('.')
  .filter(name => name.endsWith('.js') && fs.statSync(name).isFile());

function walk(directory) {
  if (!fs.existsSync(directory)) return;
  for (const name of fs.readdirSync(directory)) {
    const fullPath = path.join(directory, name);
    const stat = fs.lstatSync(fullPath);
    if (stat.isSymbolicLink()) continue;
    if (stat.isDirectory()) walk(fullPath);
    else if (stat.isFile() && fullPath.endsWith('.js')) files.push(fullPath);
  }
}

roots.forEach(walk);

const patterns = {
  archiver: /\brequire(?:\.resolve)?\s*\(\s*['"]archiver['"]\s*\)|\bimport\s*\(\s*['"]archiver['"]\s*\)|\bfrom\s*['"]archiver['"]/g,
  readdirGlob: /\brequire(?:\.resolve)?\s*\(\s*['"]readdir-glob['"]\s*\)|\bimport\s*\(\s*['"]readdir-glob['"]\s*\)|\bfrom\s*['"]readdir-glob['"]/g
};

const matches = { archiver: [], readdirGlob: [] };

for (const file of files) {
  const source = fs.readFileSync(file, 'utf8');
  for (const [dependency, pattern] of Object.entries(patterns)) {
    for (const match of source.matchAll(pattern)) {
      matches[dependency].push({ file, expression: match[0] });
    }
  }
}

assert.equal(matches.archiver.length, 0,
  'archiver must not be statically imported by the reviewed production source roots');
assert.equal(matches.readdirGlob.length, 0,
  'readdir-glob must not be statically imported by the reviewed production source roots');

console.log('PRODUCTION_JS_FILES_SCANNED=' + files.length);
console.log('ARCHIVER_STATIC_IMPORTS=0');
console.log('READDIR_GLOB_STATIC_IMPORTS=0');
console.log('DEPENDENCY_USAGE_INVENTORY=PASS');
console.log('NOTE=Static import scan only; dynamically constructed module paths are not proven absent.');
