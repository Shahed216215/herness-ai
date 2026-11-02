'use strict';

const {
  buildQueueHealthPlanningAudit
} = require('./mira-queue-health-planning-audit-engine');

function getQueueHealthPlanningAudit({
  now = new Date()
} = {}) {
  return buildQueueHealthPlanningAudit({ now });
}

module.exports = {
  getQueueHealthPlanningAudit
};
