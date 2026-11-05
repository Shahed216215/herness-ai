'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const route = fs.readFileSync(path.join(root, 'routes/mira-hfm-learning-evolution.js'), 'utf8');
const server = fs.readFileSync(path.join(root, 'server.js'), 'utf8');
const store = fs.readFileSync(path.join(root, 'services/mira-hfm-learning-proposal-store.js'), 'utf8');
const bridge = fs.readFileSync(path.join(root, 'services/mira-hfm-learning-evolution-bridge.js'), 'utf8');

assert.match(route, /const isProduction = process\.env\.NODE_ENV === 'production'/);
assert.match(route, /isProduction \? null : createPersistentProposalStore\(\)/,
  'production must not fall back to ephemeral local proposal files');
assert.match(route, /isProduction \? null : \(event => recordAudit/,
  'production must not fall back to a local-only audit callback');
assert.match(route, /hasProductionIntegrationCapabilities\(/);
assert.match(route, /HFM_LEARNING_PRODUCTION_ADAPTER_NOT_CONFIGURED/);
assert.match(route, /session\.authenticated !== true/);
assert.match(route, /session\.role !== 'admin'/);
assert.match(route, /typeof session\.username !== 'string'/);
assert.match(route, /actorRole: 'admin', actorId/);
assert.match(route, /requireAdminPermission\(PERMISSIONS\.SYSTEM_ADMIN\)/);
assert.match(store, /durable: false, crossInstanceAtomicCreate: false, storageMode: 'LOCAL_SINGLE_INSTANCE_ONLY'/);
assert.match(bridge, /proposalStore\.durable === true/);
assert.match(bridge, /proposalStore\.crossInstanceAtomicCreate === true/);
assert.match(bridge, /auditWriter\.durable === true/);
assert.match(server, /registerMiraHfmLearningEvolutionRoutes\(/);
assert.match(server, /requireAdminPermission,[\s\S]{0,100}?PERMISSIONS/);

console.log('HFM_PHASE8_PRODUCTION_LOCAL_STORE_FAIL_CLOSED=PASS');
console.log('HFM_PHASE8_DURABLE_AUDIT_REQUIRED_FOR_PRODUCTION=PASS');
console.log('HFM_PHASE8_NAMED_ADMIN_SESSION_REQUIRED=PASS');
console.log('HFM_PHASE8_SYSTEM_ADMIN_ROUTE_GUARD=PASS');
console.log('HFM_PHASE8_SERVER_ROUTE_REGISTRATION=PASS');
console.log('TESTS_FAILED=0');
