'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const {
  validateClientVaultPayload,
  validateFinancialVaultPayload,
  canonicalVaultPayload,
  isVaultPayloadPresentInUserIntent
} = require('../services/mira-hfm-vault-record-schema');

const clientPayload = Object.freeze({
  clientId: 'C-1042',
  clientName: 'Example Client',
  organization: 'Example Studio',
  email: 'contact@example.com',
  phone: '+8801712345678',
  status: 'active'
});

const financialPayload = Object.freeze({
  transactionReference: 'TXN-1042',
  invoiceReference: 'INV-1042',
  counterparty: 'Example Client',
  amount: 1200,
  currency: 'BDT',
  transactionDate: '2026-11-07',
  paymentMethod: 'mobile_money',
  accountLast4: '1234',
  status: 'paid'
});

test('client vault schema accepts bounded client identity/contact data and rejects unknown fields', () => {
  assert.equal(validateClientVaultPayload(clientPayload).valid, true);
  assert.equal(validateClientVaultPayload({ clientName: 'Example Client', adminPassword: 'not-allowed' }).valid, false);
  assert.equal(validateClientVaultPayload({ clientName: 'Example Client', unknownField: 'not-allowed' }).valid, false);
  assert.equal(validateClientVaultPayload({ clientName: 'Example Client', phone: '1234567890123456' }).valid, false);
  assert.equal(validateClientVaultPayload({ clientName: 'Example Client', website: 'https://example.com/?access_token=secret' }).valid, false);
  assert.equal(validateClientVaultPayload({ clientName: 'Example Client', notes: '4111111111111111' }).valid, false);
});

test('financial vault schema accepts transaction metadata and rejects full account/card credentials', () => {
  assert.equal(validateFinancialVaultPayload(financialPayload).valid, true);
  assert.equal(validateFinancialVaultPayload({
    ...financialPayload,
    cardNumber: '4111111111111111'
  }).valid, false);
  assert.equal(validateFinancialVaultPayload({
    ...financialPayload,
    accountNumber: '123456789012'
  }).valid, false);
  assert.equal(validateFinancialVaultPayload({
    ...financialPayload,
    cvv: '123'
  }).valid, false);
  assert.equal(validateFinancialVaultPayload({
    ...financialPayload,
    notes: 'Bearer abcdefghijklmnopqrstuvwxyz'
  }).valid, false);
  assert.equal(validateFinancialVaultPayload({
    ...financialPayload,
    notes: 'Bank account number: 123456789012'
  }).valid, false);
  assert.equal(validateFinancialVaultPayload({
    ...financialPayload,
    transactionDate: '2026-02-30'
  }).valid, false);
});

test('financial amount and currency must be supplied together and accountLast4 is bounded', () => {
  assert.equal(validateFinancialVaultPayload({
    transactionReference: 'TXN-1',
    amount: 500
  }).valid, false);
  assert.equal(validateFinancialVaultPayload({
    transactionReference: 'TXN-1',
    amount: 500,
    currency: 'BDT',
    accountLast4: '12345'
  }).valid, false);
});

test('vault payload canonicalization is deterministic and every leaf value must be user-authored', () => {
  const unordered = {
    email: 'contact@example.com',
    clientName: 'Example Client',
    clientId: 'C-1042'
  };
  const canonical = canonicalVaultPayload('client_vault_save', unordered);
  assert.deepEqual(Object.keys(canonical), ['clientId', 'clientName', 'email']);
  const intent = 'Save this client record to the client vault: client ID C-1042, client name Example Client, email contact@example.com.';
  assert.equal(isVaultPayloadPresentInUserIntent(intent, canonical), true);
  assert.equal(isVaultPayloadPresentInUserIntent(intent, { ...canonical, email: 'other@example.com' }), false);
});

test('financial vault payload values must be present in the current user message', () => {
  const canonical = canonicalVaultPayload('financial_vault_save', financialPayload);
  const intent = 'Save this financial transaction to the vault: TXN-1042, invoice INV-1042, Example Client, 1200 BDT, 2026-11-07, mobile_money, account ending 1234, paid.';
  assert.equal(isVaultPayloadPresentInUserIntent(intent, canonical), true);
  assert.equal(isVaultPayloadPresentInUserIntent(intent, { ...canonical, amount: 1400 }), false);
});

test('migration 018 requires separate one-time memory.vault.write authority for RESTRICTED vault rows', () => {
  const migration = fs.readFileSync(
    path.join(__dirname, '..', 'migrations/hfm/018_restricted_vault_write_authority.sql'),
    'utf8'
  );
  assert.match(migration, /memory\.vault\.write/);
  assert.match(migration, /classification = 'RESTRICTED'/);
  assert.match(migration, /record_type IN \('client_vault_record', 'financial_vault_record'\)/);
  assert.match(migration, /lifecycle = 'PENDING_REVIEW'/);
  assert.match(migration, /trust_status = 'SOURCE_RECORDED'/);
  assert.match(migration, /integrity_status = 'VERIFIED'/);
  assert.match(migration, /authority_row\.status = 'CONSUMED'/);
  assert.match(migration, /authority_row\.purpose LIKE 'hfm-vault:%'/);
  assert.match(migration, /memory_record_versions/);
  assert.match(migration, /SOURCE-ONLY DRAFT/);
});
