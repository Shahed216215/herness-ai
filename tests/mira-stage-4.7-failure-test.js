"use strict";

const fs = require("fs");
const path = require("path");

const {
  createProposal,
  moveToPendingApproval,
  approveProposal
} = require("../change-management");

const {
  stageApprovedProposal
} = require("../services/mira-evolution-staging");

const {
  getArtifact,
  verifyArtifact,
  updateArtifactStatus
} = require("../staging-manager");

const {
  prepareApply,
  applyPreparedChange,
  getArtifactApplyStatus
} = require("../artifact-apply-engine");

const ACTOR = "stage-4.7-failure-test";

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
  throw new Error(message);
}

async function main() {
  console.log("======================================");
  console.log("MIRA STAGE 4.7 FAILURE/ROLLBACK TEST");
  console.log("======================================");

  const proposal = createProposal({
    title: "Stage 4.7 automatic rollback test",
    reason:
      "Verify that an apply failure triggers automatic rollback.",
    expectedBenefit:
      "Confirm transaction recovery and rollback integrity.",
    category: "other",
    risk: "medium",
    actor: ACTOR,
    affectedResources: [
      "Stage 4.7 failure test artifact"
    ],
    estimatedComplexity: "low",
    backupRequired: true,
    testRequired: true
  });

  pass(`Proposal created: ${proposal.changeId}`);

  const pending = moveToPendingApproval(
    proposal.changeId,
    ACTOR
  );

  if (pending.status !== "pending_approval") {
    fail("Proposal did not move to pending_approval.");
  }

  pass("Proposal -> pending_approval");

  const approved = approveProposal(
    proposal.changeId,
    ACTOR
  );

  if (approved.status !== "approved") {
    fail("Proposal did not move to approved.");
  }

  pass("Proposal -> approved");

  const staged = await stageApprovedProposal(
    approved,
    ACTOR
  );

  if (!staged.ok) {
    fail(
      `Staging failed: ${staged.message || staged.status}`
    );
  }

  pass("Staging artifact created");

  const verification = verifyArtifact(
    proposal.changeId
  );

  if (!verification.ok) {
    fail("Artifact verification failed.");
  }

  pass("Artifact verification");
  recordPassingStage49Evidence(proposal.changeId);

  const ready = updateArtifactStatus(
    proposal.changeId,
    "ready_for_review"
  );

  if (!ready.ok) {
    fail("Artifact did not move to ready_for_review.");
  }

  pass("Artifact -> ready_for_review");

  const applyApproval = updateArtifactStatus(
    proposal.changeId,
    "approved_for_apply"
  );

  if (!applyApproval.ok) {
    fail("Explicit apply approval failed.");
  }

  pass(
    "Explicit apply approval -> approved_for_apply"
  );

  const prepared = prepareApply(
    proposal.changeId
  );

  if (!prepared.ok) {
    fail("Transaction preparation failed.");
  }

  pass("Transaction prepared");

  /*
   * Failure injection happens AFTER prepareApply().
   *
   * We temporarily replace fs.renameSync() so that
   * the actual apply loop fails after preflight.
   *
   * This specifically tests:
   *
   * Apply Failure
   *      ↓
   * Automatic Rollback
   */
  const originalRenameSync =
    fs.renameSync;

  let failureInjected = false;

  fs.renameSync = function (...args) {
    if (!failureInjected) {
      failureInjected = true;

      throw new Error(
        "TEST_INJECTED_APPLY_FAILURE"
      );
    }

    return originalRenameSync.apply(
      fs,
      args
    );
  };

  pass(
    "Failure injection armed after transaction preparation"
  );

  let applyFailed = false;
  let applyError = null;

  try {
    await applyPreparedChange(
      proposal.changeId
    );
  } catch (error) {
    applyFailed = true;
    applyError = error;
  } finally {
    /*
     * Always restore the real filesystem method.
     */
    fs.renameSync =
      originalRenameSync;
  }

  if (!applyFailed) {
    fail(
      "Apply unexpectedly succeeded after failure injection."
    );
  }

  pass("Apply failure detected");

  const errorMessage =
    applyError?.message || "";

  console.log(
    "[APPLY_ERROR]",
    errorMessage
  );

  if (
    !errorMessage.includes(
      "Automatic rollback completed"
    )
  ) {
    fail(
      "Automatic rollback was not confirmed in apply error."
    );
  }

  pass("Automatic rollback completed");

  const transactionStatus =
    getArtifactApplyStatus(
      proposal.changeId
    );

  console.log(
    "[TRANSACTION_STATUS]",
    JSON.stringify(
      transactionStatus,
      null,
      2
    )
  );

  if (
    transactionStatus?.transaction?.status !==
    "rolled_back"
  ) {
    fail(
      `Expected transaction status rolled_back, got ${
        transactionStatus?.transaction?.status
      }`
    );
  }

  pass("Transaction -> rolled_back");

  /*
   * Recovery verification:
   * the project target should not remain after
   * the failed apply was rolled back.
   */
  const targetPath =
    prepared.manifest.files[0]?.targetPath;

  if (!targetPath) {
    fail(
      "Unable to determine prepared target path."
    );
  }

  const targetExists =
    fs.existsSync(targetPath);

  if (targetExists) {
    fail(
      "Recovery verification failed: target remains after rollback."
    );
  }

  pass(
    "Recovery verification -> target restored/removed"
  );

  const artifactAfterFailure =
    getArtifact(
      proposal.changeId
    );

  if (!artifactAfterFailure?.ok) {
    fail(
      "Artifact could not be loaded after rollback."
    );
  }

  console.log(
    "[ARTIFACT_AFTER_ROLLBACK]",
    JSON.stringify(
      artifactAfterFailure,
      null,
      2
    )
  );

  const artifactStatus =
    artifactAfterFailure.artifact?.manifest?.status ||
    artifactAfterFailure.manifest?.status;

  if (artifactStatus !== "failed") {
    fail(
      `Expected artifact status failed, got ${artifactStatus}`
    );
  }

  pass("Artifact -> failed");

  console.log("======================================");
  console.log(
    "STAGE 4.7 FAILURE/ROLLBACK TEST SUMMARY"
  );
  console.log("======================================");
  console.log("Apply: FAILED AS EXPECTED");
  console.log("Automatic Rollback: CONFIRMED");
  console.log("Recovery Verification: CONFIRMED");
  console.log("Transaction: rolled_back");
  console.log("Artifact: failed");
  console.log(
    "RESULT: Stage 4.7 FAILURE/ROLLBACK COMPLETE"
  );
}

main().catch((error) => {
  console.error("======================================");
  console.error(
    "STAGE 4.7 FAILURE/ROLLBACK TEST FAILED"
  );
  console.error(error.message);
  process.exit(1);
});
