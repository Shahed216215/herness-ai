const assert = require('assert');
const express = require('express');
const http = require('http');

const {
  registerOpportunityRoutes
} = require('../routes/opportunities');

const {
  listOpportunities,
  getOpportunity
} = require('../opportunity-store');

function requestJson(port, path) {
  return new Promise((resolve, reject) => {
    const req = http.request({
      hostname: '127.0.0.1',
      port,
      path,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      }
    }, (res) => {
      let body = '';

      res.on('data', chunk => {
        body += chunk;
      });

      res.on('end', () => {
        let parsed;

        try {
          parsed = JSON.parse(body);
        } catch (error) {
          return reject(error);
        }

        resolve({
          status: res.statusCode,
          body: parsed
        });
      });
    });

    req.on('error', reject);
    req.end();
  });
}

async function main() {
  console.log(
    '\n=== STAGE 7.4 OPPORTUNITY RISK POLICY API E2E TEST ==='
  );

  const opportunities = listOpportunities();

  assert(
    opportunities.length > 0,
    'Expected at least one opportunity'
  );

  const opportunity = opportunities[0];

  const app = express();
  app.use(express.json());

  const requireAdminPermission =
    () => (req, res, next) => next();

  const PERMISSIONS = {
    SYSTEM_ADMIN: 'SYSTEM_ADMIN'
  };

  registerOpportunityRoutes(
    app,
    requireAdminPermission,
    PERMISSIONS
  );

  const server =
    await new Promise((resolve) => {
      const instance =
        app.listen(
          0,
          '127.0.0.1',
          () => resolve(instance)
        );
    });

  try {
    const port = server.address().port;

    const policy = await requestJson(
      port,
      `/api/admin/opportunities/${encodeURIComponent(
        opportunity.opportunityId
      )}/policy-check`
    );

    assert.strictEqual(
      policy.status,
      200,
      'Valid policy check must return HTTP 200'
    );

    assert.strictEqual(
      policy.body.success,
      true,
      'Valid policy response must succeed'
    );

    assert.strictEqual(
      policy.body.opportunityId,
      opportunity.opportunityId,
      'Opportunity ID must be preserved'
    );

    assert(
      policy.body.policy,
      'Policy result must be present'
    );

    assert(
      [
        'allowed',
        'restricted',
        'approval_required',
        'blocked',
        'unknown'
      ].includes(policy.body.policy.decision),
      'Policy decision must use an allowed Stage 7.4 decision'
    );

    assert.strictEqual(
      policy.body.policy.policyChecked,
      true,
      'Policy must be marked as checked'
    );

    assert(
      Array.isArray(policy.body.policy.findings),
      'Policy findings must be an array'
    );

    assert(
      Array.isArray(policy.body.policy.reasons),
      'Policy reasons must be an array'
    );

    assert(
      policy.body.policy.evaluatedAt,
      'Policy evaluatedAt must be present'
    );

    assert(
      policy.body.governance,
      'Governance result must be present'
    );

    assert.strictEqual(
      policy.body.governance.externalActionAllowed,
      false,
      'External action must remain disabled'
    );

    assert.strictEqual(
      policy.body.governance.executionAllowed,
      false,
      'Execution must remain disabled'
    );

    assert.strictEqual(
      policy.body.governance.acceptanceAllowed,
      false,
      'Acceptance must remain disabled'
    );

    assert.strictEqual(
      policy.body.governance.paymentAllowed,
      false,
      'Payment must remain disabled'
    );

    assert.strictEqual(
      policy.body.governance.contractAllowed,
      false,
      'Contract must remain disabled'
    );

    const persisted =
      getOpportunity(opportunity.opportunityId);

    assert(
      persisted,
      'Opportunity must still exist after policy check'
    );

    assert.strictEqual(
      persisted.policy.policyChecked,
      true,
      'Policy result must persist'
    );

    assert.strictEqual(
      persisted.policy.decision,
      policy.body.policy.decision,
      'Persisted decision must match API response'
    );

    assert(
      persisted.provenance.policyCheckedAt,
      'Policy check timestamp must persist'
    );

    console.log(
      'PASS: valid opportunity policy-check API'
    );

    const unknown =
      await requestJson(
        port,
        '/api/admin/opportunities/stage74-unknown-opportunity/policy-check'
      );

    assert.strictEqual(
      unknown.status,
      404,
      'Unknown opportunity must return HTTP 404'
    );

    assert.strictEqual(
      unknown.body.success,
      false,
      'Unknown opportunity must not succeed'
    );

    console.log(
      'PASS: unknown opportunity returns 404'
    );

    console.log(
      '\nSTAGE 7.4 API E2E TEST: PASS'
    );
  } finally {
    await new Promise((resolve) =>
      server.close(resolve)
    );
  }
}

main().catch((error) => {
  console.error(
    '\nSTAGE 7.4 API E2E TEST: FAIL'
  );
  console.error(
    error.stack || error.message
  );
  process.exitCode = 1;
});
