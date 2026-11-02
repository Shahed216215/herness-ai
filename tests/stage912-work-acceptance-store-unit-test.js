"use strict";

const assert = require("assert");
const fs = require("fs");

const store =
  require("../work-acceptance-store");

console.log(
  "\n=== STAGE 9.1.2 WORK ACCEPTANCE STORE UNIT TEST ===\n"
);

// Clean test store
store.saveStore({
  workAcceptances: []
});

// 1. Create
{
  const record =
    store.createStoredWorkAcceptance({
      acceptanceId: "store-accept-001",
      opportunityId: "store-opp-001",
      proposalId: "store-proposal-001",

      status: "pending",

      acceptanceDecision: {
        decision: "pending",
        reason: "Waiting for client confirmation"
      }
    });

  assert.strictEqual(
    record.acceptanceId,
    "store-accept-001"
  );

  assert.strictEqual(
    store.countWorkAcceptances(),
    1
  );

  console.log("PASS: create + persistence");
}

// 2. Read
{
  const record =
    store.getWorkAcceptance(
      "store-accept-001"
    );

  assert(record);
  assert.strictEqual(
    record.opportunityId,
    "store-opp-001"
  );

  console.log("PASS: get by acceptanceId");
}

// 3. Find by opportunity
{
  const records =
    store.findByOpportunity(
      "store-opp-001"
    );

  assert.strictEqual(
    records.length,
    1
  );

  console.log("PASS: find by opportunity");
}

// 4. Find by proposal
{
  const records =
    store.findByProposal(
      "store-proposal-001"
    );

  assert.strictEqual(
    records.length,
    1
  );

  console.log("PASS: find by proposal");
}

// 5. Update
{
  const updated =
    store.updateWorkAcceptance(
      "store-accept-001",
      {
        status: "accepted",

        acceptanceDecision: {
          decision: "accept",
          reason: "Client confirmed requirements",
          decidedBy: "human-review"
        },

        workScope: {
          scopeId: "store-scope-001",
          summary: "Complete agreed work",
          deliverables: [
            "Final deliverable"
          ],
          exclusions: [
            "Out-of-scope work"
          ]
        }
      }
    );

  assert.strictEqual(
    updated.status,
    "accepted"
  );

  assert.strictEqual(
    updated.acceptanceDecision.decision,
    "accept"
  );

  assert.strictEqual(
    updated.workScope.scopeId,
    "store-scope-001"
  );

  console.log("PASS: update + validation");
}

// 6. Status filter
{
  const records =
    store.listWorkAcceptances({
      status: "accepted"
    });

  assert.strictEqual(
    records.length,
    1
  );

  console.log("PASS: status filtering");
}

// 7. Duplicate protection
{
  assert.throws(
    () =>
      store.createStoredWorkAcceptance({
        acceptanceId:
          "store-accept-001",
        opportunityId:
          "store-opp-duplicate",
        status: "pending",
        acceptanceDecision: {
          decision: "pending",
          reason: "Duplicate test"
        }
      }),
    /already exists/
  );

  console.log("PASS: duplicate protection");
}

// 8. Invalid update rejected
{
  assert.throws(
    () =>
      store.updateWorkAcceptance(
        "store-accept-001",
        {
          status: "accepted",
          acceptanceDecision: {
            decision: "reject",
            reason: "Invalid update"
          }
        }
      ),
    /Invalid work acceptance update/
  );

  console.log("PASS: invalid update rejected");
}

// 9. Delete
{
  const removed =
    store.deleteWorkAcceptance(
      "store-accept-001"
    );

  assert.strictEqual(
    removed.acceptanceId,
    "store-accept-001"
  );

  assert.strictEqual(
    store.countWorkAcceptances(),
    0
  );

  console.log("PASS: delete");
}

// 10. Store remains valid after delete
{
  const current =
    store.loadStore();

  assert.deepStrictEqual(
    current,
    {
      workAcceptances: []
    }
  );

  assert(
    fs.existsSync(
      store.getStorePath()
    )
  );

  console.log(
    "PASS: store integrity after delete"
  );
}

console.log(
  "\nSTAGE9_1_2_WORK_ACCEPTANCE_STORE_UNIT_TEST: PASS\n"
);
