'use strict';

const assert = require('assert');
const fs = require('fs');

const earnings = require('../earnings-ledger');
const costs = require('../cost-profitability');

const earningsBackup = fs.existsSync(earnings.DATA_FILE)
  ? fs.readFileSync(earnings.DATA_FILE, 'utf8')
  : null;

const costsBackup = fs.existsSync(costs.DATA_FILE)
  ? fs.readFileSync(costs.DATA_FILE, 'utf8')
  : null;

function reset() {
  fs.writeFileSync(earnings.DATA_FILE, '[]\n');
  fs.writeFileSync(costs.DATA_FILE, '[]\n');
}

function restore() {
  if (earningsBackup === null) fs.unlinkSync(earnings.DATA_FILE);
  else fs.writeFileSync(earnings.DATA_FILE, earningsBackup);

  if (costsBackup === null) fs.unlinkSync(costs.DATA_FILE);
  else fs.writeFileSync(costs.DATA_FILE, costsBackup);
}

try {
  reset();

  const e = earnings.createEarning({
    id: 'e2e_earning_001',
    clientId: 'client_001',
    projectId: 'project_001',
    currency: 'USD',
    quotedAmount: 500,
    agreedAmount: 450,
    platformFee: 45,
    status: 'active',
    paymentStatus: 'pending',
    description: 'Stage 12 accounting test'
  });

  assert.strictEqual(e.quotedAmount, 500);
  assert.strictEqual(e.agreedAmount, 450);
  assert.strictEqual(e.platformFee, 45);
  assert.strictEqual(e.netAmount, 405);
  assert.strictEqual(e.status, 'active');
  assert.strictEqual(e.paymentStatus, 'pending');
  assert.strictEqual(e.accountingOnly, true);
  assert.strictEqual(e.moneyTransferEnabled, false);

  const duplicate = earnings.createEarning({
    id: 'e2e_earning_001',
    agreedAmount: 999
  });
  assert.strictEqual(duplicate.agreedAmount, 450);

  const completed = earnings.updateEarning(e.id, {
    status: 'completed',
    paymentStatus: 'paid'
  });
  assert.strictEqual(completed.status, 'completed');
  assert.strictEqual(completed.paymentStatus, 'paid');

  assert.throws(() => earnings.createEarning({
    id: 'invalid_fee',
    agreedAmount: 10,
    platformFee: 11
  }));

  const c1 = costs.createCost({
    id: 'e2e_cost_001',
    earningId: e.id,
    projectId: 'project_001',
    currency: 'USD',
    type: 'tool_api',
    amount: 25,
    description: 'API cost'
  });

  const c2 = costs.createCost({
    id: 'e2e_cost_002',
    projectId: 'project_001',
    currency: 'USD',
    type: 'other',
    amount: 10,
    description: 'Other cost'
  });

  assert.strictEqual(c1.amount, 25);
  assert.strictEqual(c2.amount, 10);

  const result = costs.profitability({
    projectId: 'project_001'
  });

  assert.strictEqual(result.revenue, 450);
  assert.strictEqual(result.platformFees, 45);
  assert.strictEqual(result.toolApiCosts, 25);
  assert.strictEqual(result.otherCosts, 10);
  assert.strictEqual(result.totalCosts, 80);
  assert.strictEqual(result.netResult, 370);
  assert.strictEqual(result.accountingOnly, true);
  assert.strictEqual(result.moneyTransferEnabled, false);

  assert.strictEqual(
    result.revenue - result.platformFees -
      result.toolApiCosts - result.otherCosts,
    result.netResult
  );

  const earningsDashboard = earnings.dashboard();
  assert.ok(earningsDashboard.overview);
  assert.ok(Array.isArray(earningsDashboard.activeEarnings));
  assert.ok(Array.isArray(earningsDashboard.completed));
  assert.ok(Array.isArray(earningsDashboard.pendingPayments));
  assert.ok(Array.isArray(earningsDashboard.history));

  const profitabilityDashboard = costs.dashboard({
    projectId: 'project_001'
  });
  assert.strictEqual(profitabilityDashboard.netResult, 370);
  assert.ok(Array.isArray(profitabilityDashboard.costs));
  assert.ok(Array.isArray(profitabilityDashboard.earnings));

  const source1 = fs.readFileSync(
    require.resolve('../earnings-ledger'),
    'utf8'
  );
  const source2 = fs.readFileSync(
    require.resolve('../cost-profitability'),
    'utf8'
  );

  assert.ok(source1.includes('moneyTransferEnabled: false'));
  assert.ok(source2.includes('moneyTransferEnabled: false'));
  assert.ok(!/transferMoney|sendMoney|withdraw|bankTransfer/i.test(source1));
  assert.ok(!/transferMoney|sendMoney|withdraw|bankTransfer/i.test(source2));

  console.log('STAGE12.1_EARNINGS_LEDGER: PASS');
  console.log('STAGE12.2_COST_PROFITABILITY: PASS');
  console.log('ACCOUNTING_ONLY_SAFETY: PASS');
  console.log('DUPLICATE_IDEMPOTENCY: PASS');
  console.log('NET_RESULT_FORMULA: PASS');
  console.log('STAGE12_1_12_2_E2E: PASS');
} finally {
  restore();
}
