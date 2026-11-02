'use strict';
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const root = process.cwd();
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const outDir = path.join(root, 'backups', `stage19-security-evidence-${stamp}`);
const report = [];
const results = [];
function check(name, ok, detail) {
  results.push({name, ok: !!ok, detail: String(detail || '')});
  console.log(`${ok ? 'PASS' : 'BLOCKED'}=${name};${detail || ''}`);
}
function read(rel) {
  try { return fs.readFileSync(path.join(root, rel), 'utf8'); }
  catch { return ''; }
}
const SKIP_DIRS = ['node_modules', '.git', 'backups', 'tmp', '.runtime'];
function walk(dir, acc = []) {
  if (!fs.existsSync(dir)) return acc;
  for (const ent of fs.readdirSync(dir, {withFileTypes: true})) {
    if (SKIP_DIRS.includes(ent.name)) continue;
    const p = path.join(dir, ent.name);
    if (ent.isDirectory()) walk(p, acc);
    else if (ent.isFile() && p.endsWith('.js')) acc.push(p);
  }
  return acc;
}
function allOk(names) {
  return names.every(n => (results.find(r => r.name === n) || {}).ok === true);
}
const os = require('os');
let _tlsFx = null;
function tlsFixture() {
  if (_tlsFx) return _tlsFx;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mira-tls-'));
  const hosts = new Set(['pinned.example', 'other.pinned.example']);
  const td = path.join(root, 'tests');
  for (const n of fs.existsSync(td) ? fs.readdirSync(td) : []) {
    if (!n.endsWith('.js')) continue;
    const src = read(path.join('tests', n));
    for (const h of src.match(/\b[a-z0-9-]+(?:\.[a-z0-9-]+)*\.example\b/gi) || []) hosts.add(h.toLowerCase());
  }
  const key = path.join(dir, 'key.pem');
  const cert = path.join(dir, 'cert.pem');
  const san = [...hosts].map(h => 'DNS:' + h).join(',');
  const r = spawnSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes',
    '-keyout', key, '-out', cert, '-days', '1', '-subj', '/CN=pinned.example',
    '-addext', 'subjectAltName=' + san,
    '-addext', 'basicConstraints=critical,CA:TRUE'], {encoding: 'utf8'});
  _tlsFx = {dir, key, cert, ok: r.status === 0};
  return _tlsFx;
}
function tlsCleanup() {
  if (_tlsFx) { try { fs.rmSync(_tlsFx.dir, {recursive: true, force: true}); } catch {} }
}
function testEnv() {
  const fx = tlsFixture();
  return {...process.env, MIRA_TEST_TLS_KEY: fx.key, MIRA_TEST_TLS_CERT: fx.cert, NODE_EXTRA_CA_CERTS: fx.cert};
}
function runTests(list) {
  const failed = [];
  for (const name of list) {
    const r = spawnSync(process.execPath, [path.join('tests', name)], {
      cwd: root, env: testEnv(), encoding: 'utf8', timeout: 120000
    });
    if (r.status !== 0) failed.push(name);
  }
  return {total: list.length, failed};
}

// ---- file scope ----
const DIAGNOSTIC_ROOT = /^(?:mira-|learning-|real-learning-)[\w.-]*\.js$/;
const ARCHIVED_ROOT = /-before-|-backup-/;
const rootJs = fs.readdirSync(root, {withFileTypes: true})
  .filter(e => e.isFile() && e.name.endsWith('.js')).map(e => e.name);
const rootDiagnostics = rootJs.filter(n => DIAGNOSTIC_ROOT.test(n));
const rootArchived = rootJs.filter(n => !DIAGNOSTIC_ROOT.test(n) && ARCHIVED_ROOT.test(n));
const rootProduction = rootJs.filter(n => !DIAGNOSTIC_ROOT.test(n) && !ARCHIVED_ROOT.test(n));
const files = [
  ...rootProduction,
  ...['routes', 'services', 'scripts', 'tools', 'providers'].flatMap(d =>
    walk(path.join(root, d)).map(p => path.relative(root, p)))
].filter((v, i, a) => a.indexOf(v) === i);

// ---- attachment ----
const server = read('server.js');
const guard = read('services/security/reject-unsupported-uploads.js');
const guardPos = server.indexOf('rejectUnsupportedUploads');
const jsonPos = server.indexOf('express.json');
check('ATTACHMENT_GUARD_PRESENT',
  !!guard && /multipart\/form-data/i.test(guard) &&
  /415/.test(guard) && guardPos >= 0 && jsonPos >= 0 && guardPos < jsonPos,
  'multipart guard must be installed before JSON body parsing and return 415');

const uploadPatterns = [
  /\b(?:multer|busboy|formidable|express-fileupload)\b/i,
  /\breq\.files\b/,
  /\bupload\.(?:single|array|fields|any)\s*\(/i,
  /\bBuffer\.from\s*\(\s*req\.body(?:\?|\.)[^,\n]+,\s*['"]base64['"]\s*\)/i,
  /\breq\.body(?:\?|\.)[A-Za-z_$][\w$]*(?:attachment|base64|filecontent|file_content)/i
];
const ingressHits = [];
for (const rel of files) {
  const src = read(rel);
  for (const pattern of uploadPatterns) {
    if (pattern.test(src)) ingressHits.push(`${rel}:${pattern}`);
  }
}
check('NO_UNREVIEWED_ATTACHMENT_INGRESS',
  ingressHits.length === 0,
  ingressHits.length ? ingressHits.slice(0, 12).join(' | ') :
    `no common upload parser, req.files, or request-body base64 ingestion found; scanned_files=${files.length}`);

const testsDir = path.join(root, 'tests');
const testFiles = fs.existsSync(testsDir) ? fs.readdirSync(testsDir).filter(n => n.endsWith('.js')) : [];
const attachmentTests = testFiles.filter(n => /(attachment|upload)/i.test(n));
const attRun = runTests(attachmentTests);
check('ATTACHMENT_RUNTIME_TESTS',
  attRun.total >= 1 && attRun.failed.length === 0,
  `tests=${attRun.total}; failed=${attRun.failed.length}` +
  (attRun.failed.length ? '; ' + attRun.failed.join('|') : ''));

// ---- outbound ----
const networkPatterns = [
  /\bhttps\.request\s*\(/g,
  /\bhttp\.request\s*\(/g,
  /\bhttps\.get\s*\(/g,
  /\bhttp\.get\s*\(/g,
  /\bfetch\s*\(/g,
  /\baxios\.(?:request|get|post|put|delete)\s*\(/g,
  /\bgot\s*\(/g,
  /\bundici\b/g,
  /require\(\s*["'](?:axios|node-fetch|got|superagent|request)["']\s*\)/g
];
const sinks = [];
for (const rel of files) {
  const src = read(rel);
  if (/services\/security\/secure-provider-request\.js$/.test(rel) ||
      /services\/security\/secure-sdk-fetch\.js$/.test(rel)) continue;
  for (const pattern of networkPatterns) {
    pattern.lastIndex = 0;
    let m;
    while ((m = pattern.exec(src))) {
      const line = src.slice(0, m.index).split('\n').length;
      sinks.push({rel, line, token: m[0]});
    }
  }
}
const doctor = read('scripts/mira-doctor.js');
const webSearch = read('tools/web-search.js');
const doctorSafe = sinks.filter(s => s.rel === 'scripts/mira-doctor.js')
  .every(s => /createPinnedLookup\s*\(\s*["']api\.groq\.com["']/.test(doctor) &&
              /servername\s*:\s*["']api\.groq\.com["']/.test(doctor) &&
              /lookup\s*:\s*createPinnedLookup/.test(doctor));
const webSearchSafe = sinks.filter(s => s.rel === 'tools/web-search.js')
  .every(s => /secureProviderRequest/.test(webSearch));
const unexpected = sinks.filter(s =>
  !['scripts/mira-doctor.js', 'tools/web-search.js'].includes(s.rel));
check('OUTBOUND_CALLSITES_REVIEWED',
  doctorSafe && webSearchSafe && unexpected.length === 0,
  `direct_sinks=${sinks.length}; unexpected=${unexpected.length}; doctor_pinned=${doctorSafe}; web_search_wrapper=${webSearchSafe}` +
  (unexpected.length ? '; ' + unexpected.slice(0, 10).map(s => `${s.rel}:${s.line}:${s.token}`).join('|') : ''));

const sdkFiles = files.filter(rel => /\bnew\s+(?:Groq|OpenAI|GoogleGenAI)\s*\(/.test(read(rel)));
const sdkBad = sdkFiles.filter(rel => !/fetch\s*:\s*secureSdkFetch/.test(read(rel)));
check('SDK_CONSTRUCTORS_USE_SECURE_FETCH',
  sdkFiles.length > 0 && sdkBad.length === 0,
  `sdk_files=${sdkFiles.length}; without_secure_fetch=${sdkBad.length}` +
  (sdkBad.length ? '; ' + sdkBad.join('|') : ''));

const diagSet = new Set([...rootDiagnostics, ...rootArchived].map(n => path.join(root, n)));
const reqRe = /require\(\s*["'](\.{1,2}\/[^"']+)["']\s*\)/g;
const importers = [];
for (const rel of files) {
  const src = read(rel);
  const dir = path.dirname(path.join(root, rel));
  reqRe.lastIndex = 0;
  let m;
  while ((m = reqRe.exec(src))) {
    const base = path.resolve(dir, m[1]);
    const cands = [base, base + '.js', path.join(base, 'index.js')];
    if (cands.some(c => diagSet.has(c))) importers.push(rel + '->' + m[1]);
  }
}
check('ROOT_DIAGNOSTICS_NOT_IMPORTED',
  importers.length === 0,
  `diagnostic_root_files=${rootDiagnostics.length}; archived_root_files=${rootArchived.length}; imported_by_production=${importers.length}` +
  (importers.length ? '; ' + importers.slice(0, 10).join('|') : ''));

const GOOGLE_ALLOWED = new Set([
  'google-drive.js', 'tools/knowledge-backup.js',
  'tools/knowledge-restore.js', 'authorize-drive.js'
]);
const googleHits = files.filter(rel =>
  /require\(\s*["']googleapis["']\s*\)|\bgoogle\.(?:drive|auth)\b/.test(read(rel)));
const googleUnexpected = googleHits.filter(rel => !GOOGLE_ALLOWED.has(rel));
check('GOOGLEAPIS_REVIEWED_EXCEPTION',
  googleUnexpected.length === 0,
  `google_files=${googleHits.length}; unexpected=${googleUnexpected.length}; exception=fixed Google endpoints via googleapis, not DNS-pinned, no user-supplied URL` +
  (googleUnexpected.length ? '; ' + googleUnexpected.join('|') : ''));

const outboundTests = testFiles.filter(n =>
  /^stage19.*(pinning|ssrf|sdk-fetch|secure-fetch|callsite|transport|dns)/i.test(n));
const outRun = runTests(outboundTests);
check('OUTBOUND_RUNTIME_TESTS',
  outRun.total >= 3 && outRun.failed.length === 0,
  `tests=${outRun.total}; failed=${outRun.failed.length}` +
  (outRun.failed.length ? '; ' + outRun.failed.join('|') : ''));

tlsCleanup();
const auditRun = runTests(['stage19-audit-tamper-test.js']);
check('AUDIT_TAMPER_RUNTIME', auditRun.total === 1 && auditRun.failed.length === 0,
  'tamper scenarios incl. truncation, sha256 forgery, downgrade, anchor removal; failed=' + auditRun.failed.length);
const routeRun = runTests(['stage19-route-auth-runtime.js']);
check('ROUTE_AUTH_RUNTIME', routeRun.total === 1 && routeRun.failed.length === 0,
  'unauthenticated requests against a temp copy of the server; failed=' + routeRun.failed.length);

// ---- markers derived from results ----
const attachmentPass = allOk(['ATTACHMENT_GUARD_PRESENT', 'NO_UNREVIEWED_ATTACHMENT_INGRESS', 'ATTACHMENT_RUNTIME_TESTS']);
const outboundPass = allOk(['OUTBOUND_CALLSITES_REVIEWED', 'SDK_CONSTRUCTORS_USE_SECURE_FETCH',
  'ROOT_DIAGNOSTICS_NOT_IMPORTED', 'GOOGLEAPIS_REVIEWED_EXCEPTION', 'OUTBOUND_RUNTIME_TESTS']);
const allPass = results.every(r => r.ok);

report.push('MIRA_STAGE19_STAGE20_SECURITY_EVIDENCE');
report.push(`GENERATED_AT=${new Date().toISOString()}`);
report.push(`ATTACHMENT_SECURITY=${attachmentPass ? 'PASS' : 'BLOCKED'}`);
report.push(`OUTBOUND_NETWORK_COVERAGE=${outboundPass ? 'PASS' : 'BLOCKED'}`);
report.push(`AUDIT_TAMPER_RESISTANCE=${allOk(['AUDIT_TAMPER_RUNTIME']) ? 'PASS' : 'BLOCKED'}`);
report.push(`ROUTE_AUTH_COVERAGE=${allOk(['ROUTE_AUTH_RUNTIME']) ? 'PASS' : 'BLOCKED'}`);
report.push('AUDIT_LIMIT=HMAC key and anchor live on the same host. An attacker who can read .env can still forge. Not a defence against full host compromise.');
report.push('ROUTE_LIMIT=Only routes registered with literal paths were probed (unauthenticated, empty body). Role escalation tested with one user-role session against all non-allowlisted routes; admin-vs-admin permission boundaries are not tested.');
report.push('EVIDENCE_SCOPE=Static JavaScript source review plus local test execution; no live network request performed.');
report.push('ATTACHMENT_LIMIT=PASS means no unreviewed ingress in scanned production source, guard order verified, local attachment tests passed. Not a guarantee for unscanned code or future ingress paths.');
report.push('OUTBOUND_LIMIT=PASS means scanned direct sinks are wrapped/pinned, SDKs use secureSdkFetch, local pinning/SSRF tests passed. googleapis (Google Drive) is a reviewed exception: fixed Google hosts, not DNS-pinned. Not a runtime guarantee.');
for (const r of results) report.push(`${r.ok ? 'PASS' : 'BLOCKED'}_${r.name}=${r.detail}`);
report.push(`EVIDENCE_TEST_RESULT=${allPass ? 'PASS' : 'BLOCKED'}`);

fs.mkdirSync(outDir, {recursive: true});
fs.writeFileSync(path.join(outDir, 'SECURITY_EVIDENCE.txt'), report.join('\n') + '\n', {flag: 'wx'});
console.log(`ATTACHMENT_SECURITY=${attachmentPass ? 'PASS' : 'BLOCKED'}`);
console.log(`OUTBOUND_NETWORK_COVERAGE=${outboundPass ? 'PASS' : 'BLOCKED'}`);
console.log(`AUDIT_TAMPER_RESISTANCE=${allOk(['AUDIT_TAMPER_RUNTIME']) ? 'PASS' : 'BLOCKED'}`);
console.log(`ROUTE_AUTH_COVERAGE=${allOk(['ROUTE_AUTH_RUNTIME']) ? 'PASS' : 'BLOCKED'}`);
console.log(`EVIDENCE_REPORT=${path.relative(root, path.join(outDir, 'SECURITY_EVIDENCE.txt'))}`);
console.log(`EVIDENCE_TEST_RESULT=${allPass ? 'PASS' : 'BLOCKED'}`);
process.exitCode = allPass ? 0 : 1;
