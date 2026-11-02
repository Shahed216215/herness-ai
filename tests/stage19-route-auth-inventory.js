'use strict';
const fs = require('fs');
const files = ['server.js', ...fs.readdirSync('routes').filter(n => n.endsWith('.js')).map(n => 'routes/' + n)];
const AUTH = /\b(require[A-Z]\w*|authenticate\w*|ensureAuth\w*|isAuthenticated|adminOnly)\b/;
function closeIdx(src, open) {
  let d = 0, q = null;
  for (let i = open; i < src.length; i++) {
    const c = src[i], n = src[i + 1];
    if (q) { if (c === '\\') i++; else if (c === q) q = null; continue; }
    if (c === '/' && n === '/') { while (i < src.length && src[i] !== '\n') i++; continue; }
    if (c === '/' && n === '*') { i = src.indexOf('*/', i + 2); if (i < 0) return -1; i++; continue; }
    if (c === '"' || c === "'" || c === '`') { q = c; continue; }
    if (c === '(') d++;
    else if (c === ')') { d--; if (!d) return i; }
  }
  return -1;
}
let total = 0, inline = 0, routerLvl = 0;
const open = [];
for (const f of files) {
  const src = fs.readFileSync(f, 'utf8');
  const lineOf = i => src.slice(0, i).split('\n').length;
  const useRe = /\b(app|router)\.use\s*\(/g;
  const useAuth = [];
  let m;
  while ((m = useRe.exec(src))) {
    const o = m.index + m[0].length - 1, c = closeIdx(src, o);
    if (c > 0 && AUTH.test(src.slice(o, c))) useAuth.push(m.index);
  }
  const re = /\b(app|router)\.(get|post|put|patch|delete)\s*\(/g;
  while ((m = re.exec(src))) {
    const o = m.index + m[0].length - 1, c = closeIdx(src, o);
    if (c < 0) continue;
    const args = src.slice(o + 1, c);
    const p = (args.match(/^\s*(['"`])(.*?)\1/) || [])[2] || '?';
    total++;
    if (AUTH.test(args)) inline++;
    else if (useAuth.some(i => i < m.index)) routerLvl++;
    else open.push(`${f}:${lineOf(m.index)} ${m[2].toUpperCase()} ${p}`);
  }
}
const mounts = [];
const sv = fs.readFileSync('server.js', 'utf8');
const mre = /\bapp\.use\s*\(/g;
let mm;
while ((mm = mre.exec(sv))) {
  const o = mm.index + mm[0].length - 1, c = closeIdx(sv, o);
  if (c < 0) continue;
  const a = sv.slice(o + 1, c);
  if (/routes|Router|router/.test(a)) {
    const p = (a.match(/^\s*(['"`])(.*?)\1/) || [])[2] || '(no path)';
    mounts.push(`${sv.slice(0, mm.index).split('\n').length}: ${p} auth=${AUTH.test(a)}`);
  }
}
console.log(`ROUTES_TOTAL=${total}`);
console.log(`ROUTES_AUTH_INLINE=${inline}`);
console.log(`ROUTES_AUTH_ROUTER_LEVEL=${routerLvl}`);
console.log(`ROUTES_NO_AUTH_MARKER=${open.length}`);
open.forEach(r => console.log('NO_AUTH ' + r));
console.log('MOUNTS:');
mounts.forEach(r => console.log('  ' + r));
