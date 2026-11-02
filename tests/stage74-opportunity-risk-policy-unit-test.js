"use strict";

const assert = require("assert");

const {
  POLICY_DECISIONS,
  POLICY_CATEGORIES,
  CATEGORY_DECISIONS,
  CATEGORY_SEVERITY,
  evaluatePolicy,
  getPolicyDecisionForCategory
} = require("../services/mira-opportunity-risk-policy-engine");

function opportunity(description) {
  return {
    title: "Test opportunity",
    description,
    type: "task",
    category: "general",
    domain: "general",
    requirements: [],
    skills: []
  };
}

function expectDecision(name, description, expected) {
  const result = evaluatePolicy(
    opportunity(description)
  );

  assert.strictEqual(
    result.decision,
    expected,
    `${name}: expected ${expected}, got ${result.decision}`
  );

  assert.strictEqual(
    result.policyChecked,
    true,
    `${name}: policyChecked must be true`
  );

  return result;
}

console.log(
  "STAGE 7.4 OPPORTUNITY RISK & POLICY UNIT TEST"
);

console.log("\n[1] POLICY CONTRACT");

assert.deepStrictEqual(
  POLICY_DECISIONS,
  [
    "allowed",
    "restricted",
    "approval_required",
    "blocked"
  ]
);

assert.deepStrictEqual(
  POLICY_CATEGORIES,
  [
    "scam",
    "credential_request",
    "suspicious_payment",
    "unauthorized_access",
    "unsafe_instruction",
    "ownership",
    "unrealistic_requirement"
  ]
);

console.log("PASS: policy decisions and categories");

console.log("\n[2] ALLOWED");

expectDecision(
  "safe opportunity",
  "Analyze public information and prepare a research summary.",
  "allowed"
);

console.log("PASS: safe opportunity allowed");

console.log("\n[3] SCAM");

const scam = expectDecision(
  "scam",
  "Pay a registration fee first to receive a guaranteed job.",
  "blocked"
);

assert.ok(
  scam.findings.some(
    item => item.category === "scam"
  )
);

console.log("PASS: scam blocked");

console.log("\n[4] CREDENTIAL REQUEST");

const credential = expectDecision(
  "credential request",
  "Send your username and password to complete the task.",
  "approval_required"
);

assert.ok(
  credential.findings.some(
    item => item.category === "credential_request"
  )
);

console.log("PASS: credential request requires approval");

console.log("\n[5] SUSPICIOUS PAYMENT");

const payment = expectDecision(
  "suspicious payment",
  "Send crypto payment upfront before starting the work.",
  "approval_required"
);

assert.ok(
  payment.findings.some(
    item => item.category === "suspicious_payment"
  )
);

console.log("PASS: suspicious payment requires approval");

console.log("\n[6] UNAUTHORIZED ACCESS");

const unauthorized = expectDecision(
  "unauthorized access",
  "Hack into another person's account and bypass authentication.",
  "blocked"
);

assert.ok(
  unauthorized.findings.some(
    item => item.category === "unauthorized_access"
  )
);

console.log("PASS: unauthorized access blocked");

console.log("\n[7] UNSAFE INSTRUCTION");

const unsafe = expectDecision(
  "unsafe instruction",
  "Follow this dangerous instruction to harm someone.",
  "blocked"
);

assert.ok(
  unsafe.findings.some(
    item => item.category === "unsafe_instruction"
  )
);

console.log("PASS: unsafe instruction blocked");

console.log("\n[8] OWNERSHIP");

const ownership = expectDecision(
  "ownership",
  "Submit the application as me and accept the binding agreement.",
  "approval_required"
);

assert.ok(
  ownership.findings.some(
    item => item.category === "ownership"
  )
);

console.log("PASS: ownership issue requires approval");

console.log("\n[9] UNREALISTIC REQUIREMENT");

const unrealistic = expectDecision(
  "unrealistic requirement",
  "Become an expert immediately and complete unlimited revisions for free.",
  "restricted"
);

assert.ok(
  unrealistic.findings.some(
    item => item.category === "unrealistic_requirement"
  )
);

console.log("PASS: unrealistic requirement restricted");

console.log("\n[10] DECISION PRECEDENCE");

const mixed = expectDecision(
  "blocked beats approval",
  "Send your password and then hack into another person's account.",
  "blocked"
);

assert.ok(
  mixed.findings.some(
    item => item.category === "credential_request"
  )
);

assert.ok(
  mixed.findings.some(
    item => item.category === "unauthorized_access"
  )
);

console.log("PASS: blocked takes precedence");

console.log("\n[11] CATEGORY CONTRACT");

for (const category of POLICY_CATEGORIES) {
  const result =
    getPolicyDecisionForCategory(category);

  assert.strictEqual(
    result.category,
    category
  );

  assert.strictEqual(
    result.decision,
    CATEGORY_DECISIONS[category]
  );

  assert.strictEqual(
    result.severity,
    CATEGORY_SEVERITY[category]
  );
}

console.log("PASS: category decision/severity contract");

console.log("\nSTAGE 7.4 UNIT TEST PASS");
