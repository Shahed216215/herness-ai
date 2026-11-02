'use strict';

const assert = require('assert');
const fs = require('fs');

const earnings = require('../earnings-ledger');
const costs = require('../cost-profitability');
const service = require('../services/earnings-accounting-service');

const eFile = earnings.DATA_FILE;
const cFile = costs.DATA_FILE;

const eBackup = fs.existsSync(eFile)
  ? fs.readFileSync(eFile, 'utf8')
  : null;

const cBackup = fs.existsSync(cFile)
  ? fs.readFileSync(cFile, 'utf8')
  : null;

function restore() {
  if (eBackup === null) {
    if (fs.existsSync(eFile)) fs.unlinkSync(eFile);
  } else {
    fs.writeFileSync(eFile, eBackup);
  }

  if (cBackup === null) {
    if (fs.existsSync(cFile)) fs.unlinkSync(cFile);
  } else {
    fs.writeFileSync(cFile, cBackup);
  }
}

try {
  fs.writeFileSync(eFile, '[]\n');
  fs.writeFileSync(cFile, '[]\n');

  earnings.createEarning({
    id: 'hardening_quoted',
    currency: 'USD',
    quotedAmount: 100,
    agreedAmount: 0,
    platformFee: 0,
    status: 'quoted'
  });

  const active = earnings.createEarning({
    id: 'hardening_active',
    currency: 'USD',
    quotedAmount: 500,
    agreedAmount: 450,
    platformFee: 45,
    status: 'active',
    paymentStatus: 'pending'
  });

  earnings.createEarning({
    id: 'hardening_cancelled',
    currency: 'USD',
    quotedAmount: 300,
    agreedAmount: 300,
    platformFee: 30,
    status: 'cancelled'
  });

  costs.createCost({
    id: 'hardening_tool',
    earningId: active.id,
    currency: 'USD',
    type: 'tool_api',
    amount: 20,
    projectId: 'hardening_project'
  });

  costs.createCost({
    id: 'hardening_other',
    currency: 'USD',
    type: 'other',
    amount: 5,
    projectId: 'hardening_project'
  });

  const result = costs.profitability({
    currency: 'USD'
  });

  /*
   * Only agreed/active/completed earnings count as revenue.
   * Quoted/cancelled earnings do not count.
   */
  assert.strictEqual(result.revenue, 450);
  assert.strictEqual(result.platformFees, 45);
  assert.strictEqual(result.toolApiCosts, 20);
  assert.strictEqual(result.otherCosts, 5);
  assert.strictEqual(result.totalCosts, 70);
  assert.strictEqual(result.netResult, 380);

  /*
   * Mixed currency accounting must be explicitly filtered.
   */
  earnings.createEarning({
    id: 'eur_test',
    currency: 'EUR',
    quotedAmount: 100,
    agreedAmount: 100,
    platformFee: 10,
    status: 'completed'
  });

  assert.throws(
    () => costs.profitability(),
    /Mixed currencies require an explicit currency filter/
  );

  const usd = costs.profitability({ currency: 'USD' });
  assert.strictEqual(usd.revenue, 450);
  assert.strictEqual(usd.netResult, 380);

  const dashboard = service.dashboard({
    currency: 'USD'
  });

  assert.ok(dashboard.earnings);
  assert.ok(dashboard.profitability);
  assert.ok(Array.isArray(dashboard.profitability.costs));
  assert.ok(Array.isArray(dashboard.profitability.earnings));

  assert.strictEqual(dashboard.accountingOnly, true);
  assert.strictEqual(dashboard.moneyTransferEnabled, false);

  const html = fs.readFileSync(
    'earnings.html',
    'utf8'
  );

  for (const term of [
    '📊 Earnings',
    'Overview',
    'Active Earnings',
    'Completed',
    'Pending Payments',
    'Costs',
    'Net Result',
    'History'
  ]) {
    assert.ok(
      html.includes(term),
      `missing UI contract: ${term}`
    );
  }

  assert.ok(
    html.includes('/api/earnings/overview')
  );

  const source1 = fs.readFileSync(
    'earnings-ledger.js',
    'utf8'
  );

  const source2 = fs.readFileSync(
    'cost-profitability.js',
    'utf8'
  );

  const source3 = fs.readFileSync(
    'services/earnings-accounting-service.js',
    'utf8'
  );

  for (const source of [source1, source2, source3]) {
    assert.ok(
      source.includes('moneyTransferEnabled: false')
    );

    assert.ok(
      !/transferMoney|sendMoney|withdraw|bankTransfer|executeTransfer|paymentTransfer/i
        .test(source)
    );
  }

  console.log('REVENUE_STATUS_FILTER: PASS');
  console.log('CURRENCY_SAFETY: PASS');
  console.log('ACCOUNTING_SERVICE: PASS');
  console.log('FUNCTIONAL_UI_CONTRACT: PASS');
  console.log('ACCOUNTING_ONLY: PASS');
  console.log('NO_MONEY_TRANSFER: PASS');
  console.log('STAGE12_1_12_2_FINAL_HARDENING_E2E: PASS');
} finally {
  restore();
}
