# Mira Pre-Deployment Security Remediation Plan

**Repository:** `Shahed216215/herness-ai`  
**PR:** #71 — `work/tool-health-approval-diagnostics`  
**Evidence commit:** `899cea7093303e61bbbc3d9773790af32df1c5c9`  
**Prepared:** 2026-11-06  
**Status:** Planning only — no production dependency, parser, session, or infrastructure changes authorized or made.

## 1. Executive decision

The report-only CI audit completed successfully and identified **9 npm findings: 3 high, 6 moderate, 0 critical**. This is a successful audit/reporting job, not a clean security result.

Do not merge/deploy the current PR as a security-cleared release. Keep PR #71 Draft until the remediation items below have evidence and a separately approved release decision.

## 2. Verified package findings

The audit was run against the lockfile at the evidence commit above. Lockfile paths and versions were independently inspected.

| Package | Locked version | Severity | Location / dependency | npm fix status |
|---|---:|---|---|---|
| `xlsx` | 0.18.5 | High | Direct dependency | No automatic fix |
| `body-parser` | 2.3.0 | High | Express request parser | Compatible-range fix reported |
| `follow-redirects` | 1.16.0 | High | Transitive | Compatible-range fix reported |
| `archiver` | 8.0.0 | Moderate | Direct dependency | Major change reported |
| `gaxios` | 6.7.1 (2 nested paths) | Moderate | Google auth dependencies | Compatible-range fix reported |
| `minimatch` | 10.2.6 | Moderate | Transitive via readdir-glob | Major change reported |
| `qs` | 6.16.0 | Moderate | Transitive via body-parser | Compatible-range fix reported |
| `readdir-glob` | 3.0.0 | Moderate | Transitive via archiver | Major change reported |
| `uuid` | 9.0.1 | Moderate | Transitive via gaxios | Compatible-range fix reported |

### 2.1 High: body-parser

- Advisory: GHSA-27r3-jxmh-p828 / CVE-2026-111181.
- Affected range includes `>=2.0.0 <2.4.0`; upstream patched release is 2.4.0.
- Repository source inspection found a global `express.json({ limit: MAX_BODY_SIZE, type: ... })` middleware in `server.js`; `inflate: false` is not set. The middleware runs before routing, except for two explicitly excluded SEO POST paths.
- The advisory describes a process-crash condition involving compressed request bodies with trailing bytes. This makes the parser finding directly relevant to the current server configuration.
- Preferred remediation: test an Express/body-parser dependency resolution that includes the patched parser, inspect the resulting lockfile diff, and run all HTTP, upload, auth, and request-size regressions.
- Alternative mitigation: `inflate: false` rejects compressed request bodies. Do not apply without explicit compatibility review and tests for every endpoint/client that may send compressed JSON.
- Release gate: confirm the installed parser version in CI and demonstrate that the crafted regression request cannot terminate the server.

### 2.2 High: xlsx / SheetJS

- Advisories: GHSA-4r6h-8v6p-xvw6 (Prototype Pollution) and GHSA-5pgg-2g8v-p4x9 (ReDoS).
- Lockfile version: `xlsx@0.18.5`.
- npm's audit response reports no automatic fix because the npm-distributed SheetJS package is not maintained at a patched version. Upstream advisories describe fixed releases distributed outside npm.
- The repository's direct dependency is confirmed in `package.json`, but this audit pass has not yet established every runtime call site or whether Mira parses untrusted workbooks. Do not assume the package is unused.
- Required next step: source-level inventory of every import/require, read/parse operation, write/export operation, upload route, and data trust boundary.
- Candidate remediation paths, in order:
  1. If spreadsheet parsing is not used, remove the dependency only after proving no runtime or optional feature requires it.
  2. If parsing is required, evaluate the official patched SheetJS distribution and its provenance, licensing, update channel, integrity pinning, and deployment reproducibility.
  3. Evaluate a maintained alternative library with equivalent supported formats and regression fixtures.
  4. Until replacement, isolate spreadsheet parsing, enforce strict upload size/type limits, reject untrusted workbook content where possible, and never treat parser options as a complete security fix.
- Release gate: malicious workbook regression fixtures, ordinary workbook compatibility fixtures, parser resource limits, and dependency provenance/licensing review.

### 2.3 High: follow-redirects

- Lockfile version: `follow-redirects@1.16.0`.
- Audit returned three advisories: GHSA-q3jh-wrc6-jgq8, GHSA-8r9p-f939-6h3c, GHSA-mrwp-f3q8-3g9p.
- npm reports a compatible-range fix.
- Runtime exploitability is not established: it depends on redirect behavior and the shape/source of headers passed to the library.
- Required next step: trace the parent dependency and call sites; verify whether untrusted URLs or caller-controlled headers can reach redirects. Then apply only a compatible lockfile update and test redirect, auth-header stripping, provider HTTP, and proxy behavior.

## 3. Moderate findings

- `gaxios@6.7.1`: two nested copies under Google auth dependencies. Apply compatible fix after checking Google OAuth and Drive integrations.
- `qs@6.16.0`: nested under body-parser. Prefer the parser dependency update that resolves it; add query/body parsing regression coverage.
- `uuid@9.0.1`: nested under gaxios copies. Verify the patched resolution remains compatible with the Google auth dependency tree.
- `archiver@8.0.0`, `readdir-glob@3.0.0`, and `minimatch@10.2.6`: npm reports major-change remediation. Do not bulk-upgrade. Review archive creation/extraction paths, path traversal defenses, symlink handling, glob semantics, and output integrity before a major-version change.

## 4. Express session persistence

### Verified state
- `server.js` uses `express-session`.
- Session options currently set `secret`, `resave: false`, `saveUninitialized: false`, and secure cookie controls.
- No explicit persistent `store` is configured, so the default in-memory store is used.
- Render Free sleep/restart makes in-memory session persistence unsuitable for durable sessions.

### Candidate design
Evaluate a PostgreSQL-backed Express session store against the existing Supabase Postgres project, rather than relying on Render local filesystem or process memory. Before implementation:
1. Verify the Supabase project is active, reachable from Render, and its actual free-tier limits/retention are acceptable.
2. Define a dedicated session table with expiry/indexing and least-privilege access; do not reuse HFM immutable evidence tables.
3. Keep the service-role credential server-side only; never expose it to browser/client code or logs.
4. Ensure session data is not copied into Facebook memory nodes or daily knowledge posts.
5. Set bounded cookie lifetime, secure/httpOnly/sameSite, session rotation on authentication, logout invalidation, and expired-session cleanup.
6. Test concurrent requests, restart persistence, expiry, logout, invalid/missing DB configuration, DB outage behavior, and cookie flags.
7. Decide explicitly whether DB outage should fail closed for authenticated sessions; no silent in-memory fallback.

No session store package, schema, or runtime behavior was changed in this planning commit.

## 5. Required test matrix before deployment

| Area | Required evidence |
|---|---|
| Dependency tree | Clean install from lockfile; audit summary and resolved versions recorded |
| body-parser | Patched version confirmed; compressed-body regression cannot crash process |
| Express JSON | 50 KB limit preserved; allowed SEO route behavior unchanged |
| Authentication | Existing auth/session tests; login, rotation, logout, expiry |
| follow-redirects | Cross-origin redirects do not forward sensitive credentials |
| xlsx | Import/read/write inventory; hostile workbook and normal workbook tests |
| archiver | Archive path traversal, symlink, glob, and extraction/write behavior tests |
| Google integrations | OAuth and Drive regression tests after gaxios/uuid updates |
| Full app | Existing project test suite and all PR CI workflows |
| Render staging | Health endpoint, startup bind, session restart persistence, DB outage handling |
| Security | No secrets in logs, traces, audit entries, or client responses |

## 6. Safe execution sequence

1. Finish source-level inventory of spreadsheet and redirect call sites (read-only).
2. Prepare isolated dependency update branch/patch with backup and exact lockfile diff.
3. Apply compatible-range fixes first: body-parser, follow-redirects, gaxios, qs, uuid.
4. Run the focused regression matrix and full suite; retain CI evidence.
5. Resolve xlsx distribution/replacement decision separately.
6. Evaluate major-version upgrades for archiver/readdir-glob/minimatch separately.
7. Obtain explicit approval for production session-store behavior and infrastructure changes; implement and test on a separate scoped branch.
8. Re-run full pre-deploy audit and Render staging checks.
9. Only after separate explicit approval, consider PR review readiness, merge, and Render auto-deploy.

## 7. Explicitly not performed

- No dependency upgrade or `npm audit fix`.
- No `package.json` or `package-lock.json` runtime change.
- No parser behavior change.
- No spreadsheet library replacement.
- No session store/table/secret change.
- No Render environment, disk, health-check, or service configuration change.
- No PR merge, Ready-for-review transition, or deployment.

## 8. Evidence and references

- GitHub Actions report-only audit: run 42245377453.
- Latest PR-head CI runs: 42245377453, 42245377508, 42245377452, 42245377497 (4/4 completed successfully).
- body-parser advisory: https://github.com/advisories/GHSA-27r3-jxmh-p828
- body-parser patched release: https://github.com/expressjs/body-parser/releases
- SheetJS Prototype Pollution advisory: https://github.com/advisories/GHSA-4r6h-8v6p-xvw6
- SheetJS ReDoS advisory: https://github.com/advisories/GHSA-5pgg-2g8v-p4x9

**Overall pre-deploy status: REVIEW_REQUIRED.** CI regression checks are green, but dependency vulnerabilities and session persistence are unresolved. This plan is not a deployment approval.


## 9. Additional lockfile parent-chain evidence
- `follow-redirects@1.16.0` is a dependency of the direct package `axios@1.20.0` (lockfile range `^1.16.0`). This narrows the remediation path: inspect Axios redirect/header usage and its provider/client wrappers before changing the transitive resolution.
- The application-wide parser finding is independently grounded in the global `express.json()` middleware in `server.js`, while the lockfile resolves `body-parser@2.3.0`.
- Spreadsheet runtime call-site inventory remains incomplete. The direct `xlsx` dependency is confirmed, but do not claim it is unused or safe until all source references and feature paths are traced.
