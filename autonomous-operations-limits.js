"use strict";

const {
  OPERATIONS,
  getOperationPolicy
} = require("./autonomous-operations-policy");

const DEFAULT_WINDOW_MS = 60 * 1000;

const operationCounters = new Map();

function getLimitForOperation(operation) {
  const policy = getOperationPolicy(operation);

  if (!policy.ok) {
    return {
      ok: false,
      allowed: false,
      status: "operation_policy_missing",
      operation: policy.operation,
      limit: null
    };
  }

  if (!policy.limit) {
    return {
      ok: false,
      allowed: false,
      status: "operation_limit_missing",
      operation: policy.operation,
      limit: null
    };
  }

  return {
    ok: true,
    allowed: true,
    status: "operation_limit_found",
    operation: policy.operation,
    limit: policy.limit
  };
}

function getCounterKey(operation) {
  return String(operation || "")
    .trim()
    .toLowerCase();
}

function getCurrentCounter(operation, now = Date.now()) {
  const key = getCounterKey(operation);

  if (!key) {
    return null;
  }

  const existing = operationCounters.get(key);

  if (!existing) {
    return {
      count: 0,
      windowStart: now
    };
  }

  const limitInfo = getLimitForOperation(key);

  if (
    !limitInfo.ok ||
    !limitInfo.limit ||
    !Number.isFinite(limitInfo.limit.windowMs)
  ) {
    return existing;
  }

  if (
    now - existing.windowStart >=
    limitInfo.limit.windowMs
  ) {
    return {
      count: 0,
      windowStart: now
    };
  }

  return existing;
}

function checkOperationLimit(
  operation,
  now = Date.now()
) {
  const limitInfo =
    getLimitForOperation(operation);

  if (!limitInfo.ok) {
    return {
      ok: false,
      allowed: false,
      status: limitInfo.status,
      operation: limitInfo.operation,
      count: 0,
      maxPerWindow: null,
      windowMs: null,
      remaining: 0
    };
  }

  const limit =
    limitInfo.limit;

  const counter =
    getCurrentCounter(
      operation,
      now
    );

  if (!counter) {
    return {
      ok: false,
      allowed: false,
      status: "invalid_operation",
      operation: null,
      count: 0,
      maxPerWindow: null,
      windowMs: null,
      remaining: 0
    };
  }

  const maxPerWindow =
    Number(limit.maxPerWindow);

  const windowMs =
    Number(limit.windowMs);

  if (
    !Number.isFinite(maxPerWindow) ||
    maxPerWindow < 0 ||
    !Number.isFinite(windowMs) ||
    windowMs <= 0
  ) {
    return {
      ok: false,
      allowed: false,
      status: "invalid_operation_limit",
      operation: limitInfo.operation,
      count: counter.count,
      maxPerWindow: null,
      windowMs: null,
      remaining: 0
    };
  }

  const remaining =
    Math.max(
      0,
      maxPerWindow - counter.count
    );

  if (counter.count >= maxPerWindow) {
    return {
      ok: true,
      allowed: false,
      status: "rate_limit_exceeded",
      operation: limitInfo.operation,
      count: counter.count,
      maxPerWindow,
      windowMs,
      remaining: 0
    };
  }

  return {
    ok: true,
    allowed: true,
    status: "rate_limit_available",
    operation: limitInfo.operation,
    count: counter.count,
    maxPerWindow,
    windowMs,
    remaining
  };
}

function recordOperation(
  operation,
  now = Date.now()
) {
  const check =
    checkOperationLimit(
      operation,
      now
    );

  if (!check.ok) {
    return check;
  }

  if (!check.allowed) {
    return {
      ...check,
      status: "rate_limit_exceeded"
    };
  }

  const key =
    getCounterKey(
      operation
    );

  const previous =
    getCurrentCounter(
      operation,
      now
    );

  const nextCount =
    previous.count + 1;

  operationCounters.set(
    key,
    {
      count: nextCount,
      windowStart:
        previous.windowStart
    }
  );

  return {
    ok: true,
    allowed: true,
    status: "operation_recorded",
    operation: check.operation,
    count: nextCount,
    maxPerWindow:
      check.maxPerWindow,
    windowMs:
      check.windowMs,
    remaining:
      Math.max(
        0,
        check.maxPerWindow -
          nextCount
      )
  };
}

function resetOperationLimit(
  operation
) {
  const key =
    getCounterKey(
      operation
    );

  if (!key) {
    return {
      ok: false,
      status: "invalid_operation"
    };
  }

  operationCounters.delete(
    key
  );

  return {
    ok: true,
    status: "operation_limit_reset",
    operation: key
  };
}

function resetAllOperationLimits() {
  operationCounters.clear();

  return {
    ok: true,
    status: "all_operation_limits_reset"
  };
}

function getOperationLimitStatus(
  operation,
  now = Date.now()
) {
  return checkOperationLimit(
    operation,
    now
  );
}

module.exports = {
  DEFAULT_WINDOW_MS,
  getLimitForOperation,
  checkOperationLimit,
  recordOperation,
  resetOperationLimit,
  resetAllOperationLimits,
  getOperationLimitStatus,
  OPERATIONS
};
