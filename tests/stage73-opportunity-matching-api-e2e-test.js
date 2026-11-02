const assert = require('assert');
const express = require('express');
const http = require('http');

const {
  registerOpportunityRoutes
} = require('../routes/opportunities');

const {
  listOpportunities
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
  console.log('\n=== STAGE 7.3 OPPORTUNITY MATCHING API E2E TEST ===');

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

    const match = await requestJson(
      port,
      `/api/admin/opportunities/${encodeURIComponent(
        opportunity.opportunityId
      )}/match`
    );

    assert.strictEqual(
      match.status,
      200,
      'Valid opportunity match must return HTTP 200'
    );

    assert.strictEqual(
      match.body.success,
      true,
      'Valid match response must succeed'
    );

    assert.strictEqual(
      match.body.opportunityId,
      opportunity.opportunityId,
      'Opportunity ID must be preserved'
    );

    assert.strictEqual(
      match.body.evidenceOnly,
      true,
      'Match API must remain evidence-only'
    );

    assert(
      [
        'candidate',
        'not_candidate',
        'insufficient_evidence'
      ].includes(match.body.decision),
      'Decision must use an allowed 7.3 decision'
    );

    assert(
      match.body.capability,
      'Capability evidence must be present'
    );

    assert(
      match.body.requirements,
      'Requirement evidence must be present'
    );

    assert(
      match.body.skills,
      'Skill evidence must be present'
    );

    assert(
      match.body.experience,
      'Experience evidence must be present'
    );

    assert(
      match.body.workload,
      'Workload evidence must be present'
    );

    assert(
      Array.isArray(match.body.reasons),
      'Reasons must be an array'
    );

    console.log('PASS: valid opportunity match API');

    const unknown =
      await requestJson(
        port,
        '/api/admin/opportunities/stage73-unknown-opportunity/match'
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

    console.log('PASS: unknown opportunity returns 404');

    console.log('\nSTAGE 7.3 API E2E TEST: PASS');
  } finally {
    await new Promise((resolve) =>
      server.close(resolve)
    );
  }
}

main().catch((error) => {
  console.error('\nSTAGE 7.3 API E2E TEST: FAIL');
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
