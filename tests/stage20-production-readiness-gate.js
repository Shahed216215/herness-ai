'use strict';

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const root = process.cwd();
const results = [];
function check(name, ok, detail) {
  results.push({name, ok: !!ok, detail: detail || ''});
}
function read(rel) {
  try { return fs.readFileSync(path.join(root, rel), 'utf8'); }
  catch { return ''; }
}

const contract = read('docs/architecture/ARCHITECTURE-CONTRACT.md');
check('ARCHITECTURE_CONTRACT_LOCKED',
  !!contract && /LOCKED/.test(contract),
  contract ? 'contract found' : 'contract missing');

const syntaxFiles = [
  'server.js',
  'services/ai.js',
  'providers/index.js',
  'providers/groq.js',
  'providers/openai.js',
  'services/security/secure-provider-request.js',
  'services/security/secure-sdk-fetch.js'
];
let syntaxOk = 0;
let syntaxFail = 0;
for (const f of syntaxFiles) {
  if (!fs.existsSync(path.join(root, f))) continue;
  try {
    execFileSync('node', ['--check', f], {stdio: 'ignore'});
    syntaxOk++;
  } catch { syntaxFail++; }
}
check('PRODUCTION_SYNTAX', syntaxFail === 0 && syntaxOk > 0,
  `checked=${syntaxOk}; failed=${syntaxFail}`);

let envOk = false;
try {
  const mode = fs.statSync(path.join(root, '.env')).mode & 0o777;
  envOk = mode === 0o600 || mode === 0o400;
} catch {}
check('ENV_FILE_PERMISSION', envOk,
  envOk ? 'restricted' : '.env missing or permission needs review');

const gitignore = read('.gitignore');
check('ENV_GITIGNORE_RULE',
  /(^|\n)\s*\.env(?:\*|$|\/)/m.test(gitignore) ||
  /(^|\n)\s*\.env\b/m.test(gitignore),
  'ignore rule must exclude environment secrets');

const backupRoot = path.join(root, 'backups');
let stage19Report = '';
try {
  const dirs = fs.readdirSync(backupRoot)
    .filter(n => n.startsWith('stage19-targeted-live-run-'))
    .sort().reverse();
  for (const dir of dirs) {
    const p = path.join(backupRoot, dir, 'FINAL_SUMMARY.txt');
    if (fs.existsSync(p)) { stage19Report = fs.readFileSync(p, 'utf8'); break; }
  }
} catch {}
const STAGE19_SECURITY_EVIDENCE_REPORT = (() => {
  // Honor an explicitly supplied evidence report; retain safe fallback behavior.
  const suppliedReport = process.env.STAGE19_SECURITY_EVIDENCE_REPORT;
  if (suppliedReport) {
    try {
      return fs.readFileSync(
        require('path').resolve(root, suppliedReport), 'utf8'
      );
    } catch (err) {
      console.error('SUPPLIED_SECURITY_EVIDENCE_REPORT_READ_FAILED');
      return '';
    }
  }
  try {
    const dirs = fs.readdirSync(path.join(root, 'backups'))
      .filter(n => n.startsWith('stage19-security-evidence-')).sort().reverse();
    for (const n of dirs) {
      const p = path.join(root, 'backups', n, 'SECURITY_EVIDENCE.txt');
      if (fs.existsSync(p)) return fs.readFileSync(p, 'utf8');
    }
  } catch {}
  return '';
})();
const screening = /LIVE_CASES=3/.test(stage19Report) &&
  /LIVE_PASS=3/.test(stage19Report) &&
  /SCREENING_PASS_NOT_A_SECURITY_GUARANTEE/.test(stage19Report);
check('STAGE19_LIVE_SCREENING_EVIDENCE', screening,
  screening ? '3 screening cases recorded; not a security guarantee' :
    'explicit live screening evidence not found');

check('ATTACHMENT_SECURITY_EVIDENCE',
  /ATTACHMENT_SECURITY=PASS/.test(STAGE19_SECURITY_EVIDENCE_REPORT),
  'explicit ATTACHMENT_SECURITY=PASS evidence required');
check('OUTBOUND_NETWORK_COVERAGE_EVIDENCE',
  /OUTBOUND_NETWORK_COVERAGE=PASS/.test(STAGE19_SECURITY_EVIDENCE_REPORT),
  'explicit OUTBOUND_NETWORK_COVERAGE=PASS evidence required');

check('AUDIT_TAMPER_EVIDENCE',
  /AUDIT_TAMPER_RESISTANCE=PASS/.test(STAGE19_SECURITY_EVIDENCE_REPORT),
  'explicit AUDIT_TAMPER_RESISTANCE=PASS evidence required');
check('ROUTE_AUTH_EVIDENCE',
  /ROUTE_AUTH_COVERAGE=PASS/.test(STAGE19_SECURITY_EVIDENCE_REPORT),
  'explicit ROUTE_AUTH_COVERAGE=PASS evidence required');

const blockers = results.filter(r => !r.ok);
console.log('STAGE20_GATE_CHECK=COMPLETE');
for (const r of results) {
  console.log(`${r.ok ? 'PASS' : 'BLOCKED'}=${r.name}` +
    (r.detail ? `;${r.detail.replace(/[;\r\n]/g, '_')}` : ''));
}
console.log(`GATES_TOTAL=${results.length}`);
console.log(`GATES_PASS=${results.length - blockers.length}`);
console.log(`GATES_BLOCKED=${blockers.length}`);
console.log('PRODUCTION_APPROVAL=NOT_APPROVED');
console.log('DEPLOYMENT_PERFORMED=NO');
console.log('PRODUCTION_SOURCE_MODIFIED=NO');

if (blockers.length) process.exitCode = 1;
