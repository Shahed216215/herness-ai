"use strict";

const fs = require("fs");
const path = require("path");
const storagePath = require('./mira-storage');
const crypto = require("crypto");
const jsonStateStore = require("./services/mira-json-state-store");
const localMemoryStore = require("./services/mira-local-memory-store");

const {
  saveKnowledgeToDrive,
  loadKnowledgeFromDrive,
  saveMemoryToDrive,
  loadMemoryFromDrive
} = require("./google-drive");

const {
  createSnapshot,
  verifySnapshot,
  restoreSnapshot
} = require("./snapshot-manager");

const {
  recordAudit
} = require("./audit-log");

const MEMORY_FILE = storagePath("memory.json");

if (path.resolve(localMemoryStore.MEMORY_FILE) !== path.resolve(MEMORY_FILE)) {
  throw new Error(
    "Memory Evolution and Local Memory Store paths differ; refusing split-brain persistence."
  );
}
const KNOWLEDGE_FILE = storagePath("knowledge.json");

const STAGE_NAME =
  "stage-4.12-knowledge-memory-evolution";

function now() {
  return new Date().toISOString();
}

function createId(prefix = "stage412") {
  return `${prefix}-${Date.now()}-${crypto.randomUUID()}`;
}

function sha256(value) {
  return crypto
    .createHash("sha256")
    .update(
      typeof value === "string"
        ? value
        : JSON.stringify(value)
    )
    .digest("hex");
}

function deepClone(value) {
  return JSON.parse(JSON.stringify(value));
}

function readJsonFile(filePath) {
  if (!fs.existsSync(filePath)) {
    throw new Error(
      `File not found: ${path.basename(filePath)}`
    );
  }

  const raw = fs.readFileSync(filePath, "utf8");

  if (!raw.trim()) {
    throw new Error(
      `${path.basename(filePath)} is empty.`
    );
  }

  return JSON.parse(raw);
}

function atomicWriteJson(filePath, value) {
  if (Array.isArray(value)) {
    if (path.resolve(filePath) === path.resolve(MEMORY_FILE)) {
      return localMemoryStore.writeMemory(value);
    }
    return jsonStateStore.writeArrayState(
      filePath,
      value,
      path.basename(filePath)
    );
  }

  return jsonStateStore.atomicWriteJson(
    filePath,
    value,
    path.basename(filePath)
  );
}


function getPersistedDriveSnapshotPath(
  changeId,
  snapshotId,
  target
) {
  const safeChangeId =
    String(changeId || "");

  const safeSnapshotId =
    String(snapshotId || "");

  const safeTarget =
    normalizeTarget(target);

  if (
    !/^[a-zA-Z0-9_-]+$/.test(safeChangeId)
  ) {
    throw new Error("Invalid changeId for Drive snapshot.");
  }

  if (
    !/^snapshot-[0-9]+-[a-f0-9]+$/.test(
      safeSnapshotId
    )
  ) {
    throw new Error("Invalid snapshotId for Drive snapshot.");
  }

  return path.join(
    __dirname,
    "backups",
    "changes",
    safeChangeId,
    safeSnapshotId,
    `drive-${safeTarget}-state.json`
  );
}

function persistDriveSnapshot(
  changeId,
  snapshotId,
  target,
  state
) {
  const filePath =
    getPersistedDriveSnapshotPath(
      changeId,
      snapshotId,
      target
    );

  atomicWriteJson(
    filePath,
    {
      snapshotVersion: 1,
      changeId,
      snapshotId,
      target: normalizeTarget(target),
      createdAt: now(),
      sha256: sha256(state),
      state: deepClone(state)
    }
  );

  return {
    ok: true,
    path: filePath,
    sha256: sha256(state)
  };
}

function loadPersistedDriveSnapshot(
  changeId,
  snapshotId,
  target
) {
  const filePath =
    getPersistedDriveSnapshotPath(
      changeId,
      snapshotId,
      target
    );

  if (!fs.existsSync(filePath)) {
    throw new Error(
      "Persisted Drive snapshot not found."
    );
  }

  const snapshot =
    readJsonFile(filePath);

  const normalizedTarget =
    normalizeTarget(target);

  if (
    snapshot.changeId !== changeId ||
    snapshot.snapshotId !== snapshotId ||
    snapshot.target !== normalizedTarget ||
    !Array.isArray(snapshot.state)
  ) {
    throw new Error(
      "Persisted Drive snapshot metadata is invalid."
    );
  }

  const actualHash =
    sha256(snapshot.state);

  if (
    actualHash !== snapshot.sha256
  ) {
    throw new Error(
      "Persisted Drive snapshot integrity verification failed."
    );
  }

  const stateValidation =
    validateState(
      normalizedTarget,
      snapshot.state
    );

  if (!stateValidation.valid) {
    throw new Error(
      "Persisted Drive snapshot state validation failed."
    );
  }

  return deepClone(snapshot.state);
}

function normalizeTarget(target) {
  const value =
    String(target || "")
      .trim()
      .toLowerCase();

  if (
    value === "memory" ||
    value === "knowledge"
  ) {
    return value;
  }

  throw new Error(
    "Stage 4.12 target must be 'memory' or 'knowledge'."
  );
}

function getTargetFile(target) {
  return target === "memory"
    ? MEMORY_FILE
    : KNOWLEDGE_FILE;
}

function loadLocalState(target) {
  const filePath = getTargetFile(target);
  if (target === "memory") {
    return localMemoryStore.readMemory();
  }
  return jsonStateStore.readJsonArray(
    filePath,
    path.basename(filePath),
    { missing: "empty" }
  );
}

function validateMemoryState(data) {
  const errors = [];

  if (!Array.isArray(data)) {
    return {
      valid: false,
      errors: [
        "Memory state must be an array."
      ]
    };
  }

  data.forEach((entry, index) => {
    if (
      !entry ||
      typeof entry !== "object"
    ) {
      errors.push(
        `Memory entry ${index} must be an object.`
      );
      return;
    }

    if (
      typeof entry.role !== "string" ||
      !entry.role.trim()
    ) {
      errors.push(
        `Memory entry ${index} has an invalid role.`
      );
    }

    if (
      typeof entry.content !== "string" ||
      !entry.content.trim()
    ) {
      errors.push(
        `Memory entry ${index} has invalid content.`
      );
    }

    if (
      entry.time !== undefined &&
      typeof entry.time !== "string"
    ) {
      errors.push(
        `Memory entry ${index} has an invalid time.`
      );
    }
  });

  return {
    valid: errors.length === 0,
    errors
  };
}

function validateKnowledgeState(data) {
  const errors = [];

  if (!Array.isArray(data)) {
    return {
      valid: false,
      errors: [
        "Knowledge state must be an array."
      ]
    };
  }

  data.forEach((entry, index) => {
    if (
      !entry ||
      typeof entry !== "object"
    ) {
      errors.push(
        `Knowledge entry ${index} must be an object.`
      );
      return;
    }

    if (
      typeof entry.title !== "string" ||
      !entry.title.trim()
    ) {
      errors.push(
        `Knowledge entry ${index} has an invalid title.`
      );
    }

    if (
      typeof entry.content !== "string" ||
      !entry.content.trim()
    ) {
      errors.push(
        `Knowledge entry ${index} has invalid content.`
      );
    }
  });

  return {
    valid: errors.length === 0,
    errors
  };
}

function validateState(target, data) {
  if (target === "memory") {
    return validateMemoryState(data);
  }

  return validateKnowledgeState(data);
}

function canonicalEntry(entry) {
  return JSON.stringify(entry);
}

function countPreservedEntries(
  current,
  proposed
) {
  const proposedCounts = new Map();

  for (const entry of proposed) {
    const key = canonicalEntry(entry);

    proposedCounts.set(
      key,
      (proposedCounts.get(key) || 0) + 1
    );
  }

  let preserved = 0;

  for (const entry of current) {
    const key = canonicalEntry(entry);
    const count =
      proposedCounts.get(key) || 0;

    if (count > 0) {
      preserved++;

      proposedCounts.set(
        key,
        count - 1
      );
    }
  }

  return preserved;
}

function validatePreservation(
  current,
  proposed,
  options = {}
) {
  const {
    preserveExisting = true
  } = options;

  if (!preserveExisting) {
    return {
      valid: true,
      preserved: current.length,
      required: 0
    };
  }

  const preserved =
    countPreservedEntries(
      current,
      proposed
    );

  return {
    valid:
      preserved === current.length,
    preserved,
    required: current.length,
    error:
      preserved === current.length
        ? null
        : "Proposed state would remove or alter existing entries."
  };
}

function compareDrivePrefix(
  local,
  drive
) {
  if (!Array.isArray(local)) {
    return {
      valid: false,
      reason: "Local state is not an array."
    };
  }

  if (!Array.isArray(drive)) {
    return {
      valid: false,
      reason: "Drive state is not an array."
    };
  }

  if (drive.length > local.length) {
    return {
      valid: false,
      reason:
        "Drive contains more entries than Local."
    };
  }

  for (let i = 0; i < drive.length; i++) {
    if (
      JSON.stringify(local[i]) !==
      JSON.stringify(drive[i])
    ) {
      return {
        valid: false,
        reason:
          `Drive differs from Local at index ${i}.`,
        firstDifferenceIndex: i
      };
    }
  }

  return {
    valid: true,
    prefixLength: drive.length,
    additionalLocalEntries:
      local.length - drive.length
  };
}

async function loadDriveState(target) {
  if (target === "memory") {
    const data =
      await loadMemoryFromDrive();

    if (!Array.isArray(data)) {
      throw new Error(
        "Drive memory state must be an array."
      );
    }

    return data;
  }

  const data =
    await loadKnowledgeFromDrive();

  if (!Array.isArray(data)) {
    throw new Error(
      "Drive knowledge state must be an array."
    );
  }

  return data;
}

async function saveDriveState(
  target,
  data
) {
  if (target === "memory") {
    return saveMemoryToDrive(data);
  }

  return saveKnowledgeToDrive(data);
}

function audit(
  action,
  status,
  resourceId,
  details = {}
) {
  try {
    return recordAudit({
      actorRole: "admin",
      action,
      resource: STAGE_NAME,
      resourceId,
      status,
      details
    });
  } catch (error) {
    console.error(
      "STAGE412_AUDIT_ERROR:",
      error.message
    );

    return {
      logged: false,
      error: error.message
    };
  }
}

function requireAudit(
  action,
  status,
  resourceId,
  details = {}
) {
  const result = audit(action, status, resourceId, details);
  if (result && result.logged === false) {
    const error = new Error(
      "Required Evolution audit event was not recorded: " + result.error
    );
    error.code = "STAGE412_REQUIRED_AUDIT_FAILED";
    throw error;
  }
  return result;
}

function validateProposal(proposal) {
  const errors = [];
  let target;

  if (
    !proposal ||
    typeof proposal !== "object"
  ) {
    return {
      valid: false,
      errors: [
        "Proposal is required."
      ]
    };
  }

  try {
    target =
      normalizeTarget(proposal.target);
  } catch (error) {
    errors.push(error.message);
  }

  if (
    proposal.status !== "approved"
  ) {
    errors.push(
      "Proposal must be approved before Stage 4.12 apply."
    );
  }

  if (
    !Array.isArray(
      proposal.proposedState
    )
  ) {
    errors.push(
      "Proposal proposedState must be an array."
    );
  }

  if (
    !proposal.id &&
    !proposal.proposalId
  ) {
    errors.push(
      "Proposal id is required."
    );
  }

  return {
    valid: errors.length === 0,
    errors,
    target
  };
}

function extractProposalId(proposal) {
  return String(
    proposal.id ||
    proposal.proposalId
  );
}

function validateExpectedPreState(
  proposal,
  current
) {
  const expectedHash =
    proposal.expectedPreStateHash ||
    proposal.preStateHash ||
    "";

  if (!expectedHash) {
    return {
      valid: true,
      checked: false
    };
  }

  const actualHash =
    sha256(current);

  return {
    valid:
      actualHash === expectedHash,
    checked: true,
    expectedHash,
    actualHash
  };
}

async function prepareEvolution(
  proposal,
  options = {}
) {
  const proposalCheck =
    validateProposal(proposal);

  if (!proposalCheck.valid) {
    return {
      ok: false,
      status:
        "proposal_validation_failed",
      errors: proposalCheck.errors
    };
  }

  const target =
    proposalCheck.target;

  const proposalId =
    extractProposalId(proposal);

  try {
    const current =
      loadLocalState(target);

    const proposed =
      deepClone(
        proposal.proposedState
      );

    const stateValidation =
      validateState(
        target,
        proposed
      );

    if (!stateValidation.valid) {
      return {
        ok: false,
        status:
          "state_validation_failed",
        errors:
          stateValidation.errors
      };
    }

    const preservation =
      validatePreservation(
        current,
        proposed,
        {
          preserveExisting:
            options.preserveExisting !== false
        }
      );

    if (!preservation.valid) {
      return {
        ok: false,
        status:
          "preservation_validation_failed",
        error:
          preservation.error,
        preserved:
          preservation.preserved,
        required:
          preservation.required
      };
    }

    const preState =
      validateExpectedPreState(
        proposal,
        current
      );

    if (!preState.valid) {
      return {
        ok: false,
        status: "stale_pre_state",
        expectedHash:
          preState.expectedHash,
        actualHash:
          preState.actualHash
      };
    }

    const driveState =
      await loadDriveState(target);

    const localHash =
      sha256(current);

    const driveHash =
      sha256(driveState);

    const exactMatch =
      localHash === driveHash;

    let reconciliation = null;

    if (!exactMatch) {
      reconciliation =
        compareDrivePrefix(
          current,
          driveState
        );

      if (!reconciliation.valid) {
        let quarantine;
        try {
          quarantine = jsonStateStore.quarantineConflict(
            path.dirname(getTargetFile(target)),
            `evolution-${target}`,
            { local: current, drive: driveState },
            {
              target,
              proposalId,
              localHash,
              driveHash,
              reason: reconciliation.reason,
              firstDifferenceIndex: reconciliation.firstDifferenceIndex
            }
          );
        } catch (quarantineError) {
          return {
            ok: false,
            status: "conflict_quarantine_failed",
            localHash,
            driveHash,
            error: quarantineError.message
          };
        }

        return {
          ok: false,
          status: "local_drive_mismatch",
          localHash,
          driveHash,
          reason: reconciliation.reason,
          firstDifferenceIndex: reconciliation.firstDifferenceIndex,
          quarantine
        };
      }

      const proposedHash =
        sha256(proposed);

      if (
        proposedHash !== localHash
      ) {
        let quarantine;
        try {
          quarantine = jsonStateStore.quarantineConflict(
            path.dirname(getTargetFile(target)),
            `evolution-${target}-proposal`,
            { local: current, drive: driveState, proposed },
            {
              target,
              proposalId,
              localHash,
              driveHash,
              proposedHash,
              reason: "RECONCILIATION_PROPOSAL_DIFFERS_FROM_LOCAL"
            }
          );
        } catch (quarantineError) {
          return {
            ok: false,
            status: "conflict_quarantine_failed",
            localHash,
            driveHash,
            proposedHash,
            error: quarantineError.message
          };
        }

        return {
          ok: false,
          status: "reconciliation_proposal_mismatch",
          error: "For reconciliation, proposed state must exactly equal the verified Local state.",
          localHash,
          proposedHash,
          quarantine
        };
      }
    }

    const proposedHash =
      sha256(proposed);

    const prepared = {
      ok: true,
      status: "prepared",
      stage: STAGE_NAME,
      proposalId,
      target,
      file:
        path.basename(
          getTargetFile(target)
        ),
      currentCount:
        current.length,
      proposedCount:
        proposed.length,
      driveCount:
        driveState.length,
      preserved:
        preservation.preserved,
      currentHash: localHash,
      driveHash,
      proposedHash,
      exactPreStateMatch:
        exactMatch,
      reconciliation:
        reconciliation
          ? {
              required: true,
              prefixLength:
                reconciliation.prefixLength,
              additionalLocalEntries:
                reconciliation.additionalLocalEntries
            }
          : {
              required: false
            },
      preparedAt: now()
    };

    requireAudit(
      "stage412_prepare",
      "success",
      proposalId,
      {
        target,
        currentCount:
          current.length,
        proposedCount:
          proposed.length,
        driveCount:
          driveState.length,
        preserved:
          preservation.preserved,
        currentHash: localHash,
        proposedHash,
        reconciliation:
          Boolean(reconciliation)
      }
    );

    return prepared;
  } catch (error) {
    audit(
      "stage412_prepare",
      "failed",
      proposalId,
      {
        target,
        error: error.message
      }
    );

    return {
      ok: false,
      status: "prepare_failed",
      error: error.message
    };
  }
}

async function applyEvolution(
  proposal,
  options = {}
) {
  const proposalCheck =
    validateProposal(proposal);

  if (!proposalCheck.valid) {
    return {
      ok: false,
      status:
        "proposal_validation_failed",
      errors:
        proposalCheck.errors
    };
  }

  const target =
    proposalCheck.target;

  const proposalId =
    extractProposalId(proposal);

  const changeId =
    options.changeId ||
    createId("stage412-change");

  let snapshotId = null;
  let driveBefore = null;
  let localBefore = null;

  try {
    const prepared =
      await prepareEvolution(
        proposal,
        options
      );

    if (!prepared.ok) {
      return prepared;
    }

    localBefore =
      loadLocalState(target);

    driveBefore =
      await loadDriveState(target);

    const snapshotSource = path.resolve(
      __dirname,
      path.basename(getTargetFile(target))
    );
    if (snapshotSource !== path.resolve(getTargetFile(target))) {
      throw new Error(
        "Snapshot Manager cannot safely snapshot an external storage path."
      );
    }

    const snapshot =
      createSnapshot({
        changeId,
        files: [
          path.basename(
            getTargetFile(target)
          )
        ],
        createdBy:
          options.appliedBy ||
          "admin",
        reason:
          `Stage 4.12 approved evolution for ${target}`
      });

    if (!snapshot.ok) {
      throw new Error(
        `Snapshot creation failed: ${
          snapshot.error ||
          snapshot.status
        }`
      );
    }

    snapshotId =
      snapshot.snapshotId;

    const snapshotVerification =
      verifySnapshot(
        changeId,
        snapshotId
      );

    if (!snapshotVerification.ok) {
      throw new Error(
        "Snapshot verification failed before apply."
      );
    }

    const driveSnapshot =
      persistDriveSnapshot(
        changeId,
        snapshotId,
        target,
        driveBefore
      );

    if (!driveSnapshot.ok) {
      throw new Error(
        "Persisted Drive snapshot creation failed."
      );
    }

    requireAudit(
      "stage412_snapshot_created",
      "success",
      proposalId,
      {
        target,
        changeId,
        snapshotId,
        driveSnapshotHash:
          driveSnapshot.sha256
      }
    );

    const proposed =
      deepClone(
        proposal.proposedState
      );

    atomicWriteJson(
      getTargetFile(target),
      proposed
    );

    const localAfter =
      loadLocalState(target);

    const localAfterHash =
      sha256(localAfter);

    const proposedHash =
      sha256(proposed);

    if (
      localAfterHash !==
      proposedHash
    ) {
      throw new Error(
        "Local post-apply hash verification failed."
      );
    }

    await saveDriveState(
      target,
      proposed
    );

    const driveAfter =
      await loadDriveState(target);

    const driveAfterHash =
      sha256(driveAfter);

    if (
      driveAfterHash !==
      proposedHash
    ) {
      throw new Error(
        "Drive post-apply hash verification failed."
      );
    }

    if (
      JSON.stringify(localAfter) !==
      JSON.stringify(driveAfter)
    ) {
      throw new Error(
        "Local and Drive post-apply states do not match."
      );
    }

    const preservation =
      validatePreservation(
        localBefore,
        localAfter,
        {
          preserveExisting:
            options.preserveExisting !== false
        }
      );

    if (!preservation.valid) {
      throw new Error(
        "Post-apply preservation verification failed."
      );
    }

    requireAudit(
      "stage412_apply",
      "success",
      proposalId,
      {
        target,
        changeId,
        snapshotId,
        localHash:
          localAfterHash,
        driveHash:
          driveAfterHash,
        count:
          localAfter.length,
        preserved:
          preservation.preserved
      }
    );

    return {
      ok: true,
      status:
        "applied_verified",
      stage: STAGE_NAME,
      proposalId,
      target,
      changeId,
      snapshotId,
      count:
        localAfter.length,
      preserved:
        preservation.preserved,
      hash:
        localAfterHash,
      driveHash:
        driveAfterHash,
      verified: true
    };
  } catch (error) {
    audit(
      "stage412_apply",
      "failed",
      proposalId,
      {
        target,
        changeId,
        snapshotId,
        error: error.message
      }
    );

    let rollbackResult = null;

    try {
      if (snapshotId) {
        rollbackResult =
          await rollbackEvolution({
            target,
            changeId,
            snapshotId,
            driveBefore,
            proposalId,
            restoredBy:
              options.appliedBy ||
              "admin"
          });
      }
    } catch (rollbackError) {
      rollbackResult = {
        ok: false,
        status:
          "rollback_exception",
        error:
          rollbackError.message
      };
    }

    return {
      ok: false,
      status:
        rollbackResult?.ok
          ? "apply_failed_rolled_back"
          : "recovery_required",
      stage: STAGE_NAME,
      proposalId,
      target,
      changeId,
      snapshotId,
      error:
        error.message,
      rollback:
        rollbackResult
    };
  }
}

async function rollbackEvolution(
  options = {}
) {
  const {
    target,
    changeId,
    snapshotId,
    driveBefore,
    proposalId = "unknown",
    restoredBy = "admin"
  } = options;

  let normalizedTarget;

  try {
    normalizedTarget =
      normalizeTarget(target);
  } catch (error) {
    return {
      ok: false,
      status:
        "rollback_validation_failed",
      error: error.message
    };
  }

  if (
    !changeId ||
    !snapshotId
  ) {
    return {
      ok: false,
      status:
        "rollback_validation_failed",
      error:
        "changeId and snapshotId are required."
    };
  }

  try {
    const snapshotVerification =
      verifySnapshot(
        changeId,
        snapshotId
      );

    if (!snapshotVerification.ok) {
      return {
        ok: false,
        status:
          "rollback_blocked",
        error:
          "Snapshot integrity verification failed."
      };
    }

    const restored =
      restoreSnapshot(
        changeId,
        snapshotId,
        {
          confirm: true,
          restoredBy
        }
      );

    if (!restored.ok) {
      return {
        ok: false,
        status:
          "local_rollback_failed",
        error:
          restored.error ||
          restored.status
      };
    }

    let persistedDriveBefore;

    try {
      persistedDriveBefore =
        loadPersistedDriveSnapshot(
          changeId,
          snapshotId,
          normalizedTarget
        );
    } catch (snapshotError) {
      return {
        ok: false,
        status:
          "drive_rollback_failed",
        error:
          snapshotError.message
      };
    }

    await saveDriveState(
      normalizedTarget,
      deepClone(persistedDriveBefore)
    );

    const localAfter =
      loadLocalState(
        normalizedTarget
      );

    const driveAfter =
      await loadDriveState(
        normalizedTarget
      );

    const localHash =
      sha256(localAfter);

    const driveHash =
      sha256(driveAfter);

    const expectedHash =
      sha256(persistedDriveBefore);

    const verified =
      localHash === expectedHash &&
      driveHash === expectedHash &&
      JSON.stringify(localAfter) ===
        JSON.stringify(driveAfter);

    if (!verified) {
      audit(
        "stage412_rollback",
        "failed",
        proposalId,
        {
          target:
            normalizedTarget,
          changeId,
          snapshotId,
          localHash,
          driveHash,
          expectedHash
        }
      );

      return {
        ok: false,
        status:
          "recovery_required",
        error:
          "Rollback completed partially but integrity verification failed."
      };
    }

    requireAudit(
      "stage412_rollback",
      "success",
      proposalId,
      {
        target:
          normalizedTarget,
        changeId,
        snapshotId,
        restoredCount:
          localAfter.length,
        hash:
          expectedHash
      }
    );

    return {
      ok: true,
      status:
        "rollback_verified",
      target:
        normalizedTarget,
      changeId,
      snapshotId,
      restoredCount:
        localAfter.length,
      hash:
        expectedHash,
      verified: true
    };
  } catch (error) {
    audit(
      "stage412_rollback",
      "failed",
      proposalId,
      {
        target:
          normalizedTarget,
        changeId,
        snapshotId,
        error:
          error.message
      }
    );

    return {
      ok: false,
      status:
        "rollback_failed",
      error:
        error.message
    };
  }
}

async function verifyEvolutionState(
  target
) {
  const normalizedTarget =
    normalizeTarget(target);

  try {
    const local =
      loadLocalState(
        normalizedTarget
      );

    const drive =
      await loadDriveState(
        normalizedTarget
      );

    const validation =
      validateState(
        normalizedTarget,
        local
      );

    if (!validation.valid) {
      return {
        ok: false,
        status:
          "local_validation_failed",
        errors:
          validation.errors
      };
    }

    const driveValidation =
      validateState(
        normalizedTarget,
        drive
      );

    if (!driveValidation.valid) {
      return {
        ok: false,
        status:
          "drive_validation_failed",
        errors:
          driveValidation.errors
      };
    }

    const localHash =
      sha256(local);

    const driveHash =
      sha256(drive);

    const match =
      localHash === driveHash &&
      JSON.stringify(local) ===
        JSON.stringify(drive);

    return {
      ok: match,
      status:
        match
          ? "integrity_verified"
          : "integrity_mismatch",
      target:
        normalizedTarget,
      localCount:
        local.length,
      driveCount:
        drive.length,
      localHash,
      driveHash,
      match
    };
  } catch (error) {
    return {
      ok: false,
      status:
        "integrity_check_failed",
      error:
        error.message
    };
  }
}

module.exports = {
  prepareEvolution,
  applyEvolution,
  rollbackEvolution,
  verifyEvolutionState,
  validateProposal,
  validateState,
  validateMemoryState,
  validateKnowledgeState
};
