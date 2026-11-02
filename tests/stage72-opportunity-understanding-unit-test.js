"use strict";

const assert = require("assert");

const {
  understandOpportunity,
  analyzeRequirements,
  estimateEffort,
  analyzeDifficulty,
  analyzeRisk,
  buildCompatibilityProfile
} = require("../services/mira-opportunity-understanding-engine");

function main() {
  const input =
    "Research cybersecurity careers using reliable sources and organize the findings. Create a research summary and report by tomorrow. This is a medium difficulty task.";

  const result =
    understandOpportunity(input);

  assert.strictEqual(
    result.success,
    true,
    "Understanding should succeed."
  );

  assert.strictEqual(
    result.task.type,
    "research",
    "Task type should be research."
  );

  assert.ok(
    result.task.requiredSkills.includes(
      "research"
    ),
    "Research skill should be detected."
  );

  assert.strictEqual(
    result.task.difficulty,
    "medium",
    "Parser difficulty should be medium."
  );

  assert.strictEqual(
    result.task.risk,
    "low",
    "Research task should be low risk."
  );

  assert.ok(
    Array.isArray(
      result.understanding.requirements
    ),
    "Requirements should be an array."
  );

  assert.ok(
    result.understanding.requirements.length > 0,
    "At least one requirement should be understood."
  );

  assert.strictEqual(
    result.understanding.effort.level,
    "large",
    "This multi-deliverable medium-difficulty task should have large effort."
  );

  assert.strictEqual(
    result.understanding.difficulty.level,
    "moderate",
    "Medium parser difficulty should normalize to moderate."
  );

  assert.strictEqual(
    result.understanding.risk.level,
    "low",
    "Understanding risk should remain low."
  );

  assert.strictEqual(
    result.understanding.risk.requiresHumanApproval,
    false,
    "Low-risk understanding should not require human approval."
  );

  const compatibility =
    result.understanding
      .compatibilityProfile;

  assert.strictEqual(
    compatibility.status,
    "compatible",
    "Verified capability + verified skill evidence should be compatible."
  );

  assert.ok(
    compatibility.availableCapabilities.includes(
      "Structured Research"
    ),
    "Structured Research capability should be available."
  );

  assert.ok(
    !compatibility.unverifiedSkills.includes(
      "research"
    ),
    "Research skill should not be identified as unverified when verified evidence exists."
  );

  assert.strictEqual(
    compatibility.verified,
    true,
    "Compatibility should be fully verified when all required evidence is verified."
  );

  assert.strictEqual(
    result.executionAllowed,
    false,
    "Stage 7.2 must never enable execution."
  );

  assert.strictEqual(
    result.understandingOnly,
    true,
    "Stage 7.2 must remain understanding-only."
  );

  const requirements =
    analyzeRequirements(
      result.task
    );

  assert.strictEqual(
    requirements.deliverableCount,
    2,
    "Two deliverables should be detected."
  );

  const effort =
    estimateEffort(
      result.task,
      requirements
    );

  assert.strictEqual(
    effort.level,
    "large",
    "Effort estimator should remain deterministic."
  );

  const difficulty =
    analyzeDifficulty(
      result.task,
      effort
    );

  assert.strictEqual(
    difficulty.level,
    "moderate",
    "Difficulty analyzer should remain deterministic."
  );

  const risk =
    analyzeRisk(result.task);

  assert.strictEqual(
    risk.level,
    "low",
    "Risk analyzer should remain deterministic."
  );

  const profile =
    buildCompatibilityProfile(
      result.capabilityMatches
    );

  assert.strictEqual(
    profile.status,
    "compatible",
    "Compatibility helper should produce the same result."
  );

  console.log(
    "STAGE7_2_OPPORTUNITY_UNDERSTANDING_UNIT: PASS"
  );
}

try {
  main();
} catch (error) {
  console.error(
    "STAGE7_2_OPPORTUNITY_UNDERSTANDING_UNIT: FAIL"
  );

  console.error(error);

  process.exitCode = 1;
}
