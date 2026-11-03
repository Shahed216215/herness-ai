'use strict';

const core = require('./core');
const memory = require('./memory-service');
const provider = require('./provider-contract');
const providerCatalog = require('./provider-catalog');
const writer = require('./write-coordinator');
const audit = require('./audit-contract');
const registry = require('./operation-registry');
const capabilities = require('./capability-observations');
const encryption = require('./encryption-contract');
const backup = require('./backup-manifest');
const backupPackage = require('./backup-package');
const conflict = require('./conflict');
const legacy = require('./legacy-adapter');
const migration = require('./migration-preview');
const retrieval = require('./retrieval-evidence');
const evolutionMemoryBridge = require('./evolution-memory-bridge');

module.exports = Object.freeze({
  core,
  memory,
  provider,
  providerCatalog,
  writer,
  audit,
  registry,
  capabilities,
  encryption,
  backup,
  backupPackage,
  conflict,
  legacy,
  migration,
  retrieval,
  evolutionMemoryBridge
});
