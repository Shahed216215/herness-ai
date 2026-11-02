'use strict';

const earnings = require('../earnings-ledger');
const costs = require('../cost-profitability');

function overview(filters = {}) {
  return {
    earnings: earnings.overview(),
    profitability: costs.profitability(filters),
    accountingOnly: true,
    moneyTransferEnabled: false
  };
}

function dashboard(filters = {}) {
  return {
    earnings: earnings.dashboard(),
    profitability: costs.dashboard(filters),
    accountingOnly: true,
    moneyTransferEnabled: false
  };
}

module.exports = {
  overview,
  dashboard
};
