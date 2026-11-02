"use strict";

const assert = require("assert");
const fs = require("fs");

const {
  detectAndPropose,
  autonomousApprovalAttempt,
  humanApprove,
  stageAfterHumanApproval
} = require("../services/mira-autonomous-governance");

const {
  getProposal,
  CHANGE_FILE
} = require("../change-management");

const {
  getArtifact
} = require("../staging-manager");

function loadChanges() {
  if (!fs.existsSync(CHANGE_FILE)) {
    return [];
  }

  return JSON.parse(
    fs.readFileSync(CHANGE_FILE, "utf8")
  );
}

function saveChanges(data) {
  fs.writeFileSync(
    CHANGE_FILE,
    JSON.stringify(data, null, 2),
    "utf8"
  );
}

function removeTestArtifacts(changeId) {
  const files = [
    `services/mira-evolution-plan-${changeId}.js`,
    `services/mira-staged-tool-${changeId}.js`
  ];

  for (const file of files) {
    if (fs.existsSync(file)) {
      fs.unlinkSync(file);
    }
  }
}

(async () => {
  console.log("=== STAGE 4.8 E2E TEST ===");

  let proposal;
  let artifact;

  try {
    console.log(
      "[1] Mira detects improvement and creates proposal"
    );

    const result = detectAndPropose({
      title: "Stage 4.8 E2E Governance Test",
      reason:
        "Verify autonomous improvement proposal governance.",
      expectedBenefit:
        "Verify human approval remains mandatory.",
      category: "self_improvement",
      risk: "low",
      affectedResources: [
        "services/mira-autonomous-governance.js"
      ],
      estimatedComplexity: "low",
      actor: "mira"
    });

    assert.strictEqual(result.ok, true);

    assert.strictEqual(
      result.status,
      "pending_approval"
    );

    proposal = result.proposal;

    assert.strictEqual(
      proposal.status,
      "pending_approval"
    );

    console.log(
      "PASS: proposal -> pending_approval"
    );


    console.log(
      "[2] Mira attempts autonomous approval"
    );

    const autonomousApproval =
      autonomousApprovalAttempt();

    assert.strictEqual(
      autonomousApproval.ok,
      false
    );

    assert.strictEqual(
      autonomousApproval.status,
      "approval_denied"
    );

    console.log(
      "PASS: autonomous approval denied"
    );


    console.log(
      "[3] Verify proposal is still pending"
    );

    const pendingProposal =
      getProposal(proposal.changeId);

    assert.strictEqual(
      pendingProposal.status,
      "pending_approval"
    );

    console.log(
      "PASS: proposal remains pending_approval"
    );


    console.log(
      "[4] Human/admin approval"
    );

    const approved =
      humanApprove(
        proposal.changeId,
        "admin:stage-4.8-test"
      );

    assert.strictEqual(
      approved.status,
      "approved"
    );

    assert.ok(
      approved.approval
    );

    console.log(
      "PASS: human approval -> approved"
    );


    console.log(
      "[5] Controlled staging"
    );

    const staging =
      await stageAfterHumanApproval(
        proposal.changeId,
        "admin:stage-4.8-test"
      );

    assert.strictEqual(
      staging.ok,
      true
    );

    assert.strictEqual(
      staging.status,
      "staged_ready_for_review"
    );

    artifact = staging.artifact;

    assert.ok(
      artifact
    );

    assert.strictEqual(
      artifact.manifest.status,
      "ready_for_review"
    );

    console.log(
      "PASS: approved proposal -> controlled staging"
    );


    console.log(
      "[6] Verify artifact exists"
    );

    const storedArtifact =
      getArtifact(proposal.changeId);

    assert.ok(
      storedArtifact
    );

    assert.strictEqual(
      storedArtifact.ok,
      true
    );

    assert.strictEqual(
      storedArtifact.manifest.status,
      "ready_for_review"
    );

    console.log(
      "PASS: staging artifact verified"
    );


    console.log("");
    console.log("=== STAGE 4.8 E2E PASS ===");
    console.log(
      "Mira detects -> proposes -> pending_approval"
    );
    console.log(
      "Mira autonomous approval -> DENIED"
    );
    console.log(
      "Human approval -> approved"
    );
    console.log(
      "Approved proposal -> controlled staging"
    );
    console.log(
      "Stage 4.7 apply boundary remains downstream"
    );
    console.log("");

    console.log(
      `CHANGE_ID=${proposal.changeId}`
    );

    console.log(
      `ARTIFACT_ID=${artifact.manifest.artifactId || artifact.manifest.id || "present"}`
    );

  } finally {
    if (proposal) {
      const current = loadChanges();

      const cleaned = current.filter(
        item =>
          item.changeId !== proposal.changeId
      );

      saveChanges(cleaned);

      removeTestArtifacts(
        proposal.changeId
      );
    }
  }
})().catch(error => {
  console.error(
    "STAGE 4.8 E2E FAIL"
  );

  console.error(
    error && error.stack
      ? error.stack
      : error
  );

  process.exitCode = 1;
});
