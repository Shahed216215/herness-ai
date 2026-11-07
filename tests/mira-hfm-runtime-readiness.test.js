'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { inspectHfmRuntimeConfiguration } = require('../services/mira-hfm-runtime-readiness');

const url = 'postgresql://hfm_runtime:placeholder-password@ep-test.neon.tech/neondb?sslmode=require';
const key = Buffer.alloc(32, 7).toString('base64');

test('configuration diagnostic reports missing services without connecting or exposing secrets', () => {
  const report = inspectHfmRuntimeConfiguration({});
  assert.equal(report.status, 'NOT_CONFIGURED');
  assert.equal(report.databaseConnectivity, 'NOT_TESTED');
  assert.equal(report.poolInitialization, 'LAZY_ON_DEMAND');
  assert.equal(report.authorityIssuer.status, 'NOT_CONFIGURED');
  assert.equal(report.memoryWriter.status, 'NOT_CONFIGURED');
  assert.equal(report.vault.status, 'NOT_CONFIGURED');
  assert.equal(report.legacyMemoryKnowledge, 'NOT_INTEGRATED');
  assert.equal(report.productionReadiness, 'NOT_CERTIFIED');
  assert.equal(JSON.stringify(report).includes('placeholder-password'), false);
});

test('configuration diagnostic validates config shape but never claims database connectivity', () => {
  const env = {
    MIRA_HFM_AUTHORITY_ISSUER_ENABLED: 'true',
    MIRA_HFM_AUTHORITY_ISSUER_DATABASE_URL: url,
    MIRA_HFM_AUTHORITY_ISSUER_ROLE: 'mira_hfm_authority_issuer_login',
    MIRA_HFM_MEMORY_WRITE_ENABLED: 'false',
    MIRA_HFM_MEMORY_DATABASE_URL: url,
    MIRA_HFM_MEMORY_WRITER_ROLE: 'mira_hfm_memory_writer_login',
    MIRA_VAULT_ACTIVE_KEK_VERSION: 'v1',
    MIRA_VAULT_KEK_V1: key
  };
  const report = inspectHfmRuntimeConfiguration(env);
  assert.equal(report.status, 'NOT_CONFIGURED');
  assert.equal(report.authorityIssuer.status, 'CONFIGURED');
  assert.equal(report.memoryWriter.status, 'NOT_CONFIGURED');
  assert.equal(report.memoryWriter.writesEnabled, false);
  assert.equal(report.vault.status, 'CONFIGURED');
  assert.equal(report.databaseConnectivity, 'NOT_TESTED');
  assert.equal(JSON.stringify(report).includes(url), false);
  assert.equal(JSON.stringify(report).includes(key), false);
});

test('invalid vault key and malformed role fail closed without returning values', () => {
  const report = inspectHfmRuntimeConfiguration({
    MIRA_HFM_AUTHORITY_ISSUER_ENABLED: 'true',
    MIRA_HFM_AUTHORITY_ISSUER_DATABASE_URL: url,
    MIRA_HFM_AUTHORITY_ISSUER_ROLE: 'INVALID ROLE',
    MIRA_HFM_MEMORY_WRITE_ENABLED: 'false',
    MIRA_VAULT_ACTIVE_KEK_VERSION: 'v1',
    MIRA_VAULT_KEK_V1: 'not-a-key'
  });
  assert.equal(report.authorityIssuer.status, 'INVALID');
  assert.equal(report.vault.status, 'INVALID');
  assert.equal(report.status, 'NOT_CONFIGURED');
});
