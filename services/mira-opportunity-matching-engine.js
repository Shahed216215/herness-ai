'use strict';

const {
  listCapabilities,
  listSkills
} = require('./mira-capability-profile');

const {
  getOpportunity
} = require('../opportunity-store');

const {
  listTasks
} = require('../task-store');

const {
  listExperiences
} = require('./mira-experience-memory');

const DECISIONS = Object.freeze({
  CANDIDATE: 'candidate',
  NOT_CANDIDATE: 'not_candidate',
  INSUFFICIENT_EVIDENCE: 'insufficient_evidence'
});

const REASON_CODES = Object.freeze({
  VERIFIED_CAPABILITY_REQUIRED: 'verified_capability_required',
  VERIFIED_SKILL_REQUIRED: 'verified_skill_required',
  REQUIREMENT_NOT_RESOLVED: 'requirement_not_resolved',
  EXPERIENCE_EVIDENCE_REQUIRED: 'experience_evidence_required',
  QA_EVIDENCE_REQUIRED: 'qa_evidence_required',
  WORKLOAD_EVIDENCE_REQUIRED: 'workload_evidence_required'
});

function unique(values) {
  return [...new Set((values || []).filter(Boolean))];
}

function normalize(value) {
  return String(value || '').trim().toLowerCase();
}

function getVerifiedEvidence(items) {
  return (items || []).filter((item) => {
    const evidence = Array.isArray(item.evidence)
      ? item.evidence
      : [];

    const hasPassedEvidence = evidence.some(
      (entry) => entry && entry.result === 'passed'
    );

    return (
      item &&
      item.status === 'active' &&
      item.verification === 'verified' &&
      hasPassedEvidence
    );
  });
}

function buildExperienceEvidence(requiredSkills) {
  const experiences = listExperiences();

  const required = unique(requiredSkills);
  const evidence = [];
  const rejected = [];

  for (const experience of experiences) {
    const task = experience.task || {};
    const taskSkills = unique(task.requiredSkills || []);

    const matchedSkills = required.filter((requiredSkill) =>
      taskSkills.some(
        (taskSkill) => normalize(taskSkill) === normalize(requiredSkill)
      )
    );

    if (matchedSkills.length === 0) {
      continue;
    }

    const success = experience.result?.success === true;
    const qaPassed =
      experience.performance?.qaStatus === 'qa_passed' &&
      experience.performance?.qaSuccess === true;
    const noRework = experience.performance?.reworkRequired === false;

    const item = {
      experienceId: task.id || null,
      matchedSkills,
      resultSuccess: success,
      qaPassed,
      reworkRequired: experience.performance?.reworkRequired ?? null
    };

    if (success && qaPassed && noRework) {
      evidence.push(item);
    } else {
      rejected.push(item);
    }
  }

  return {
    status: evidence.length > 0 ? 'matched' : 'insufficient_evidence',
    requiredSkills: required,
    evidence,
    rejected
  };
}

function buildWorkloadEvidence() {
  const tasks = listTasks();

  const counts = {
    total: tasks.length,
    new: 0,
    active: 0,
    waiting: 0,
    completed: 0,
    cancelled: 0
  };

  for (const task of tasks) {
    if (Object.prototype.hasOwnProperty.call(counts, task.status)) {
      counts[task.status] += 1;
    }
  }

  return {
    measured: true,
    counts,
    evidenceType: 'task-store-status-snapshot'
  };
}

function matchOpportunity(opportunityId) {
  const opportunity = getOpportunity(opportunityId);

  if (!opportunity) {
    throw new Error(`Opportunity not found: ${opportunityId}`);
  }

  if (!opportunity.opportunityId) {
    throw new Error(`Opportunity missing opportunityId: ${opportunityId}`);
  }

  const capabilities = listCapabilities();
  const skills = listSkills();

  const verifiedCapabilities = getVerifiedEvidence(capabilities);
  const verifiedSkills = getVerifiedEvidence(skills);

  const requirements = unique(
    opportunity.requirements ||
    opportunity.task?.requirements ||
    []
  );

  const requiredSkills = unique(
    opportunity.skills ||
    opportunity.task?.requiredSkills ||
    []
  );

  const capabilityEvidence = [];
  const skillEvidence = [];
  const unresolvedRequirements = [];

  for (const requirement of requirements) {
    const key = normalize(requirement);

    const capability = verifiedCapabilities.find(
      (item) =>
        normalize(item.name) === key ||
        normalize(item.key) === key ||
        (item.skills || []).some(
          (skillKey) => normalize(skillKey) === key
        )
    );

    if (capability) {
      capabilityEvidence.push({
        requirement,
        capability: capability.name,
        evidence: capability.evidence
      });
      continue;
    }

    const skill = verifiedSkills.find(
      (item) => normalize(item.name) === key ||
              normalize(item.key) === key
    );

    if (skill) {
      skillEvidence.push({
        requirement,
        skill: skill.name,
        evidence: skill.evidence
      });
      continue;
    }

    unresolvedRequirements.push(requirement);
  }

  const requiredSkillEvidence = requiredSkills.map((requiredSkill) => {
    const key = normalize(requiredSkill);

    const skill = verifiedSkills.find(
      (item) =>
        normalize(item.name) === key ||
        normalize(item.key) === key
    );

    return {
      requiredSkill,
      matched: Boolean(skill),
      skill: skill ? skill.name : null,
      evidence: skill ? skill.evidence : null
    };
  });

  const missingRequiredSkills = requiredSkillEvidence
    .filter((item) => !item.matched)
    .map((item) => item.requiredSkill);

  const experience = buildExperienceEvidence(requiredSkills);
  const workload = buildWorkloadEvidence();

  const reasons = [];

  if (unresolvedRequirements.length > 0) {
    reasons.push(REASON_CODES.REQUIREMENT_NOT_RESOLVED);
  }

  if (missingRequiredSkills.length > 0) {
    reasons.push(REASON_CODES.VERIFIED_SKILL_REQUIRED);
  }

  if (experience.status !== 'matched') {
    reasons.push(REASON_CODES.EXPERIENCE_EVIDENCE_REQUIRED);
  }

  const capabilityStatus =
    unresolvedRequirements.length === 0
      ? 'matched'
      : 'insufficient_evidence';

  const skillStatus =
    missingRequiredSkills.length === 0
      ? 'matched'
      : 'insufficient_evidence';

  const requirementStatus =
    unresolvedRequirements.length === 0
      ? 'matched'
      : 'insufficient_evidence';

  const workloadStatus = workload.measured
    ? 'measured'
    : 'insufficient_evidence';

  let decision = DECISIONS.CANDIDATE;

  if (
    requirementStatus !== 'matched' ||
    skillStatus !== 'matched' ||
    experience.status !== 'matched'
  ) {
    decision = DECISIONS.INSUFFICIENT_EVIDENCE;
  }

  return {
    opportunityId,
    decision,
    evidenceOnly: true,

    capability: {
      status: capabilityStatus,
      evidence: capabilityEvidence
    },

    requirements: {
      status: requirementStatus,
      required: requirements,
      unresolved: unresolvedRequirements
    },

    skills: {
      status: skillStatus,
      required: requiredSkills,
      evidence: requiredSkillEvidence,
      missing: missingRequiredSkills
    },

    experience,

    workload: {
      status: workloadStatus,
      evidence: workload
    },

    reasons: unique(reasons)
  };
}

module.exports = {
  DECISIONS,
  REASON_CODES,
  matchOpportunity,
  buildWorkloadEvidence
};
