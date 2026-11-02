'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const net = require('net');
const crypto = require('crypto');
const { spawn, spawnSync } = require('child_process');
const root = process.cwd();
const rnd = n => crypto.randomBytes(n).toString('hex');
const read = rel => { try { return fs.readFileSync(path.join(root, rel), 'utf8'); } catch { return ''; } };
let allow = [];
try { allow = JSON.parse(read('tests/stage19-route-public-allowlist.json')); } catch {}
const allowSet = new Set(allow);
const routeFiles = fs.readdirSync(path.join(root, 'routes')).filter(n => n.endsWith('.js')).map(n => 'routes/' + n);
const prod = ['server.js', ...routeFiles];
const esc = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
function isMounted(rel) {
  const base = path.basename(rel, '.js');
  const re = new RegExp('require\\(\\s*[\'"]\\.{1,2}/(?:routes/)?' + esc(base) + '(?:\\.js)?[\'"]\\s*\\)');
  return prod.some(f => f !== rel && re.test(read(f)));
}
const PREFIX = {
  'mira-evolution': '/api/admin/mira-evolution',
  'mira-provider-evolution': '/api/admin/mira-provider-evolution',
  'autonomous-learning': '/api/admin/autonomous-learning',
  'capability-profile': '/api/admin/capability-profile',
  'capacity-changes': '/api/admin/capacity-changes',
  'learning-history': '/api/admin/learning-history',
  'opportunities': '/api/admin/opportunities',
  'task-execution': '/api/admin/task-execution',
  'task-planning': '/api/admin/task-planning',
  'task-understanding': '/api/admin/task-understanding',
  'specialists': '/api/admin/specialists',
  'client-profiles': '/api/client-profiles'
};
const routes = new Map();
const unmounted = [], unknownPrefix = [];
for (const rel of prod) {
  if (rel !== 'server.js' && !isMounted(rel)) { unmounted.push(rel); continue; }
  const base = path.basename(rel, '.js');
  const re = /\b(?:app|router)\.(get|post|put|patch|delete)\s*\(\s*(['"`])([^'"`]*)\2/g;
  const src = read(rel);
  let m;
  while ((m = re.exec(src))) {
    const p = m[3];
    if (p.includes('${') || !p.startsWith('/')) continue;
    let full = null;
    if (rel === 'server.js' || p.startsWith('/api/') || p.startsWith('/deliverables')) full = p;
    else if (PREFIX[base]) full = PREFIX[base] + (p === '/' ? '' : p);
    if (!full) { unknownPrefix.push(`${rel} ${m[1].toUpperCase()} ${p}`); continue; }
    full = full.replace(/:[A-Za-z0-9_]+\??/g, 'x');
    routes.set(m[1].toUpperCase() + ' ' + full, true);
  }
}
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mira-rt-'));
let child = null;
const tail = [];
const results = [];
async function main() {
  const excl = ['node_modules','backups','tmp','.git','.runtime','.env','env','client_secret*','google-token.json','*.tar.gz','*.bak','*.backup*','*.before-*','backup-*','server-before-*','*.old.json','*-before-restore.json'];
  const cmd = `tar -C "${root}" ${excl.map(e => `--exclude='${e}'`).join(' ')} -cf - . | tar -C "${tmp}" -xf -`;
  const cp = spawnSync('sh', ['-c', cmd], {encoding: 'utf8'});
  if (cp.status !== 0) throw new Error('COPY_FAILED ' + (cp.stderr || '').slice(0, 200));
  fs.symlinkSync(path.join(root, 'node_modules'), path.join(tmp, 'node_modules'));
  const svPath = path.join(tmp, 'server.js');
  let sv = fs.readFileSync(svPath, 'utf8');
  const hostOld = 'const HOST = "0.0.0.0";';
  if (!sv.includes(hostOld)) throw new Error('HOST_LINE_NOT_FOUND');
  fs.writeFileSync(svPath, sv.replace(hostOld, () => 'const HOST = "127.0.0.1";'));
  const port = 38000 + Math.floor(Math.random() * 1500);
  const base = 'http://127.0.0.1:' + port;
  const env = {
    PATH: process.env.PATH, HOME: process.env.HOME, TMPDIR: process.env.TMPDIR || os.tmpdir(),
    PORT: String(port), MIRA_SESSION_SECRET: rnd(24), MIRA_ACCESS_TOKEN: rnd(16),
    MIRA_ADMIN_TOKEN: rnd(16), MIRA_ADMIN_PASSWORD: rnd(12),
    MIRA_AUDIT_FILE: path.join(tmp, 'audit-rt.json'), MIRA_AUDIT_HMAC_KEY: rnd(24)
  };
  child = spawn(process.execPath, ['server.js'], {cwd: tmp, env, stdio: ['ignore', 'pipe', 'pipe']});
  const keep = d => { tail.push(String(d)); if (tail.length > 20) tail.shift(); };
  child.stdout.on('data', keep); child.stderr.on('data', keep);
  let exited = false;
  child.on('exit', () => { exited = true; });
  const probe = () => new Promise(res => {
    const s = net.connect(port, '127.0.0.1');
    s.once('connect', () => { s.destroy(); res(true); });
    s.once('error', () => res(false));
  });
  let up = false;
  for (let i = 0; i < 60 && !up && !exited; i++) {
    up = await probe();
    if (!up) await new Promise(r => setTimeout(r, 500));
  }
  if (!up) throw new Error('SERVER_NOT_STARTED ' + tail.join('').slice(-700));
  async function hit(key) {
    const [method, p] = key.split(' ');
    const init = {method, redirect: 'manual', signal: AbortSignal.timeout(4000)};
    if (method !== 'GET') { init.headers = {'content-type': 'application/json'}; init.body = '{}'; }
    const r = {key, status: 0, kind: '', leak: false};
    try {
      const res = await fetch(base + p, init);
      r.status = res.status;
      let body = '';
      try { body = await res.text(); } catch {}
      r.leak = /\n\s+at\s.+\(.+:\d+:\d+\)/.test(body);
      if (res.status === 401 || res.status === 403) r.kind = 'PROTECTED';
      else if (res.status === 404 && /Cannot (GET|POST|PUT|PATCH|DELETE) \//.test(body)) r.kind = 'NO_ROUTE';
      else if (res.status >= 300 && res.status < 400) r.kind = 'REDIRECT';
      else r.kind = allowSet.has(key) ? 'ALLOWED' : 'OPEN';
    } catch (e) {
      r.kind = e && e.name === 'TimeoutError' ? 'HANG' : 'ERROR';
    }
    results.push(r);
  }
  const keys = [...routes.keys()];
  for (let i = 0; i < keys.length; i += 8) await Promise.all(keys.slice(i, i + 8).map(hit));
  const by = k => results.filter(r => r.kind === k);
  console.log(`ROUTES_TESTED=${results.length}`);
  for (const k of ['PROTECTED', 'NO_ROUTE', 'REDIRECT', 'ALLOWED', 'OPEN', 'HANG', 'ERROR']) console.log(`${k}=${by(k).length}`);
  for (const k of ['OPEN', 'HANG', 'ERROR', 'REDIRECT', 'NO_ROUTE']) by(k).sort((a, b) => a.key.localeCompare(b.key)).forEach(r => console.log(`${k} ${r.key} ${r.status}`));
  const leaks = results.filter(r => r.leak);
  console.log(`STACK_LEAK=${leaks.length}`);
  leaks.forEach(r => console.log(`LEAK ${r.key} ${r.status}`));
  console.log(`UNMOUNTED_ROUTE_FILES=${unmounted.join(',') || 'none'}`);
  console.log(`PREFIX_UNKNOWN_SKIPPED=${unknownPrefix.length}`);
  unknownPrefix.forEach(x => console.log('SKIPPED ' + x));

  const uname = 'rt_' + rnd(4), upass = rnd(10);
  const jh = {'content-type': 'application/json'};
  let cookie = '', abort2 = '';
  try {
    const rr = await fetch(base + '/api/register', {method: 'POST', headers: jh, signal: AbortSignal.timeout(4000),
      body: JSON.stringify({email: uname + '@example.test', username: uname, password: upass, confirmPassword: upass})});
    const lr = await fetch(base + '/api/login', {method: 'POST', headers: jh, signal: AbortSignal.timeout(4000),
      body: JSON.stringify({username: uname, password: upass})});
    const sc = typeof lr.headers.getSetCookie === 'function' ? lr.headers.getSetCookie() : [lr.headers.get('set-cookie')].filter(Boolean);
    cookie = sc.map(c => c.split(';')[0]).join('; ');
    console.log('USER_REGISTER_STATUS=' + rr.status + ' USER_LOGIN_STATUS=' + lr.status + ' COOKIE_SET=' + !!cookie);
    if (!cookie || lr.status !== 200) abort2 = 'user_login_failed';
  } catch (e) { abort2 = 'user_login_error'; }
  const esc2 = [];
  let u401 = 0, u403 = 0, tested2 = 0;
  if (!abort2) {
    const hit2 = async key => {
        const [method, p] = key.split(' ');
        const init = {method, redirect: 'manual', headers: {cookie}, signal: AbortSignal.timeout(4000)};
        if (method !== 'GET') {
          init.headers = {cookie, 'content-type': 'application/json'};
          init.body = '{}';
        }
        tested2++;
        try {
          const res = await fetch(base + p, init);
          let body = '';
          try { body = await res.text(); } catch {}
          if (res.status === 401) {
            u401++;
          } else if (res.status === 403) {
            u403++;
          } else if (
            key === 'GET /api/me' &&
            res.status === 200 &&
            (() => {
              try {
                const data = JSON.parse(body);
                return data.success === true &&
                  data.authentication === 'session' &&
                  typeof data.role === 'string';
              } catch { return false; }
            })()
          ) {
            // Authenticated users may inspect their own session identity.
          } else if (
            key === 'POST /api/agent' &&
            res.status === 400 &&
            (() => {
              try {
                const data = JSON.parse(body);
                return data.success === false &&
                  (data.error === 'Command must be a string.' ||
                   data.error === 'Command cannot be empty.');
              } catch { return false; }
            })()
          ) {
            // CHAT permission passed; the empty test payload was rejected by validation.
          } else {
            esc2.push(key + ' ' + res.status);
          }
        } catch (e) {
          esc2.push(key + ' ' + (e && e.name));
        }
      };
      const k2 = keys.filter(k => !allowSet.has(k));
    for (let i = 0; i < k2.length; i += 8) await Promise.all(k2.slice(i, i + 8).map(hit2));
    if (u403 === 0) abort2 = 'session_not_recognized_all_401';
  }
  console.log('ESCALATION_ROUTES_TESTED=' + tested2 + ' USER_403=' + u403 + ' USER_401=' + u401);
  esc2.sort().forEach(x => console.log('ESCALATION_OPEN ' + x));
  if (abort2) console.log('ESCALATION_ABORT=' + abort2);
  const escBad = esc2.length + (abort2 ? 1 : 0);
  console.log('ESCALATION_TEST=' + (escBad ? 'FAIL' : 'PASS'));
  const bad = by('OPEN').length + by('HANG').length + by('ERROR').length + leaks.length + escBad;
  console.log(`ROUTE_AUTH_RUNTIME_TEST=${bad ? 'FAIL' : 'PASS'}`);
  process.exitCode = bad ? 1 : 0;
}
main().catch(e => { console.error('RUNTIME_TEST_ABORT=' + (e && e.message || e)); process.exitCode = 2; })
  .finally(() => {
    try { if (child) child.kill('SIGKILL'); } catch {}
    try { fs.rmSync(tmp, {recursive: true, force: true}); } catch {}
  });
