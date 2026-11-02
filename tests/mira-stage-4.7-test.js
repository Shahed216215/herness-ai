"use strict";

const fs = require("fs");
const path = require("path");

const {
  createProposal,
  moveToPendingApproval,
  approveProposal,
  completeProposal,
  getProposal
} = require("../change-management");

const {
  stageApprovedProposal
} = require("../services/mira-evolution-staging");

const {
  verifyArtifact,
  getArtifact,
  updateArtifactStatus
} = require("../staging-manager");

const {
  prepareApply,
  applyPreparedChange,
  getArtifactApplyStatus
} = require("../artifact-apply-engine");

const ACTOR = "stage-4.7-test";

function recordPassingStage49Evidence(changeId) {
  const manifestPath = path.join(
    process.cwd(), "staging", "changes", changeId, "manifest.json"
  );
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  const relative = manifest.artifacts[0].path;
  const stagedPath = `staging/changes/${changeId}/proposed/${relative}`;
  manifest.validation = {
    tests: [
      { type: "unit", command: `node --check "${stagedPath}"` },
      { type: "integration", command: `test -s "${stagedPath}"` }
    ]
  };
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + "\n");
}

function pass(message) {
  console.log(`PASS  ${message}`);
}

function fail(message) {
  console.error(`FAIL  ${message}`);
  process.exitCode = 1;
}

async function main() {
  console.log("");
  console.log("======================================");
  console.log("MIRA STAGE 4.7 E2E LIFECYCLE TEST");
  console.log("======================================");
  console.log("");

  const fixtureRelative =
    "tests/mira-stage-4.7-fixture.txt";

  const fixturePath =
    path.join(process.cwd(), fixtureRelative);

  const fixtureContent =
    "MIRA_STAGE_4_7_TEST_FIXTURE\n";

  try {
    fs.writeFileSync(
      fixturePath,
      fixtureContent,
      "utf8"
    );

    pass("Test fixture created");

    const proposal = createProposal({
      category: "testing",
      title: "Mira Stage 4.7 E2E Lifecycle Test",
      reason:
        "Verify complete Evolution lifecycle without modifying production logic.",
      expectedBenefit:
        "Confirm proposal, staging, artifact approval, transaction apply and final lifecycle behavior.",
      risk: "low",
      affectedResources: [fixtureRelative],
      estimatedComplexity: "low",
      backupRequired: true,
      testRequired: true,
      createdBy: ACTOR
    });

    pass(`Proposal created: ${proposal.changeId}`);

    moveToPendingApproval(
      proposal.changeId,
      ACTOR
    );

    pass("Proposal -> pending_approval");

    approveProposal(
      proposal.changeId,
      ACTOR
    );

    pass("Proposal -> approved");
    const approvedProposal = getProposal(proposal.changeId);
    if (!approvedProposal || approvedProposal.status !== "approved") {
      throw new Error(`Proposal approval state invalid: ${approvedProposal ? approvedProposal.status : "missing"}`);
    }
    pass("Fresh proposal state -> approved");

    const stageResult =
      await stageApprovedProposal(
        approvedProposal,
        ACTOR
      );

    console.log(
      "[STAGE_RESULT]",
      JSON.stringify(stageResult, null, 2)
    );

    if (
      !stageResult ||
      !stageResult.ok
    ) {
      throw new Error(
        "Staging did not succeed."
      );
    }

    pass("Staging artifact created");

    const artifact =
      getArtifact(proposal.changeId);

    if (!artifact) {
      throw new Error(
        "Staged artifact not found."
      );
    }

    const artifactVerification =
      await verifyArtifact(
        proposal.changeId
      );

    console.log(
      "[ARTIFACT_VERIFICATION]",
      JSON.stringify(
        artifactVerification,
        null,
        2
      )
    );

    if (
      !artifactVerification ||
      !artifactVerification.ok
    ) {
      throw new Error(
        "Artifact verification failed."
      );
    }

    pass("Artifact verification");
    recordPassingStage49Evidence(proposal.changeId);

    if (
      artifact.manifest.status !==
      "ready_for_review"
    ) {
      throw new Error(
        `Expected artifact status ready_for_review, got ${artifact.manifest.status}`
      );
    }

    pass(
      "Artifact -> ready_for_review"
    );

    const approvalResult =
      updateArtifactStatus(
        proposal.changeId,
        "approved_for_apply"
      );

    console.log(
      "[APPLY_APPROVAL]",
      JSON.stringify(
        approvalResult,
        null,
        2
      )
    );

    if (
      !approvalResult ||
      !approvalResult.ok ||
      approvalResult.artifactStatus !==
        "approved_for_apply"
    ) {
      throw new Error(
        "Explicit apply approval failed."
      );
    }

    pass(
      "Explicit apply approval -> approved_for_apply"
    );

    const prepared =
      await prepareApply(
        proposal.changeId,
        ACTOR
      );

    console.log(
      "[PREPARE]",
      JSON.stringify(
        prepared,
        null,
        2
      )
    );

    if (
      !prepared ||
      !prepared.ok
    ) {
      throw new Error(
        "Transaction preparation failed."
      );
    }

    pass("Transaction prepared");

    const applied =
      await applyPreparedChange(
        proposal.changeId,
        ACTOR
      );

    console.log(
      "[APPLY]",
      JSON.stringify(
        applied,
        null,
        2
      )
    );

    if (
      !applied ||
      !applied.ok ||
      applied.status !== "applied"
    ) {
      throw new Error(
        "Transaction apply failed."
      );
    }

    pass("Transaction apply");

    const transaction =
      getArtifactApplyStatus(
        proposal.changeId
      );

    console.log(
      "[TRANSACTION_STATUS]",
      JSON.stringify(
        transaction,
        null,
        2
      )
    );

    if (
      !transaction ||
      !transaction.exists ||
      transaction.transaction.status !==
        "applied"
    ) {
      throw new Error(
        "Transaction post-apply integrity state is not applied."
      );
    }

    pass(
      "Transaction post-apply integrity state"
    );

    /*
     * Stage 4.7 lifecycle completion.
     *
     * The low-level transaction engine only changes
     * the transaction state to "applied".
     *
     * Proposal completion is a separate governance
     * lifecycle transition and must be recorded explicitly.
     */
    const completed =
      completeProposal(
        proposal.changeId,
        ACTOR
      );

    console.log(
      "[FINAL_PROPOSAL]",
      JSON.stringify(
        completed,
        null,
        2
      )
    );

    if (
      completed.status !== "complete"
    ) {
      throw new Error(
        `Final proposal state is "${completed.status}", expected "complete".`
      );
    }

    if (
      !Array.isArray(
        completed.lifecycle
      ) ||
      !completed.lifecycle.some(
        entry =>
          entry.status ===
          "complete"
      )
    ) {
      throw new Error(
        "Proposal lifecycle does not contain complete state."
      );
    }

    pass(
      "Proposal -> complete"
    );

    console.log("");
    console.log("======================================");
    console.log("STAGE 4.7 E2E TEST SUMMARY");
    console.log("======================================");
    console.log("");
    console.log("Proposal: complete");
    console.log("Artifact: applied");
    console.log("Transaction: applied");
    console.log("");
    console.log(
      "RESULT: Stage 4.7 SUCCESS PATH COMPLETE"
    );
    console.log("");

  } catch (error) {
    fail(error.message);

    console.log("");
    console.log("======================================");
    console.log("STAGE 4.7 TEST FAILED");
    console.log("======================================");
    console.log("");
  } finally {
    try {
      if (fs.existsSync(fixturePath)) {
        fs.unlinkSync(fixturePath);
      }
    } catch (cleanupError) {
      console.error(
        "Fixture cleanup failed:",
        cleanupError.message
      );
    }
  }
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
