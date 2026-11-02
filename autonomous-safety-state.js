"use strict";

const SAFETY_STATES = {
  RUNNING: "running",
  EMERGENCY_STOP: "emergency_stop",
  RECOVERY_REQUIRED: "recovery_required"
};

let currentState = SAFETY_STATES.RUNNING;

let stateChangedAt = Date.now();

function normalizeState(state) {
  return String(state || "")
    .trim()
    .toLowerCase();
}

function getSafetyState() {
  return {
    ok: true,
    state: currentState,
    changedAt: stateChangedAt
  };
}

function isKnownState(state) {
  const normalized =
    normalizeState(state);

  return Object.values(
    SAFETY_STATES
  ).includes(normalized);
}

function isExecutionAllowed() {
  if (
    currentState !==
    SAFETY_STATES.RUNNING
  ) {
    return false;
  }

  return true;
}

function requestEmergencyStop(reason = "manual") {
  currentState =
    SAFETY_STATES.EMERGENCY_STOP;

  stateChangedAt = Date.now();

  return {
    ok: true,
    state: currentState,
    executionAllowed: false,
    reason: String(reason || "manual"),
    changedAt: stateChangedAt
  };
}

function markRecoveryRequired(reason = "safety_stop") {
  if (
    currentState !==
      SAFETY_STATES.EMERGENCY_STOP
  ) {
    return {
      ok: false,
      status: "invalid_state_transition",
      state: currentState,
      executionAllowed:
        isExecutionAllowed()
    };
  }

  currentState =
    SAFETY_STATES.RECOVERY_REQUIRED;

  stateChangedAt = Date.now();

  return {
    ok: true,
    state: currentState,
    executionAllowed: false,
    reason: String(reason || "safety_stop"),
    changedAt: stateChangedAt
  };
}

function completeRecovery() {
  if (
    currentState !==
      SAFETY_STATES.RECOVERY_REQUIRED
  ) {
    return {
      ok: false,
      status: "recovery_not_required",
      state: currentState,
      executionAllowed:
        isExecutionAllowed()
    };
  }

  currentState =
    SAFETY_STATES.RUNNING;

  stateChangedAt = Date.now();

  return {
    ok: true,
    status: "recovery_completed",
    state: currentState,
    executionAllowed: true,
    changedAt: stateChangedAt
  };
}

function checkSafetyState() {
  if (!isKnownState(currentState)) {
    return {
      ok: false,
      safe: false,
      status: "unknown_safety_state",
      state: currentState,
      executionAllowed: false
    };
  }

  if (
    currentState !==
    SAFETY_STATES.RUNNING
  ) {
    return {
      ok: true,
      safe: false,
      status: "execution_blocked",
      state: currentState,
      executionAllowed: false
    };
  }

  return {
    ok: true,
    safe: true,
    status: "execution_allowed",
    state: currentState,
    executionAllowed: true
  };
}

function resetSafetyStateForTest() {
  currentState =
    SAFETY_STATES.RUNNING;

  stateChangedAt = Date.now();

  return getSafetyState();
}

module.exports = {
  SAFETY_STATES,
  getSafetyState,
  isKnownState,
  isExecutionAllowed,
  requestEmergencyStop,
  markRecoveryRequired,
  completeRecovery,
  checkSafetyState,
  resetSafetyStateForTest
};
