'use strict';

const crypto = require('crypto');

const followUpStore =
  require('../client-follow-up-store');

const {
  getProject
} = require('../project-store');

const {
  getClientProfile
} = require('./client-profile-service');

const {
  evaluatePolicy
} = require('./mira-client-communication-engine');

const DEFAULT_COOLDOWN_MS =
  7 * 24 * 60 * 60 * 1000;

const DEFAULT_MAX_FOLLOW_UPS =
  3;

function clean(value) {
  return typeof value === 'string'
    ? value.trim()
    : '';
}

function hashMessage(message) {
  return crypto
    .createHash('sha256')
    .update(
      String(message || '')
        .trim()
        .toLowerCase()
        .replace(/\s+/g, ' ')
    )
    .digest('hex');
}

function resolveClientId(project, input = {}) {
  return clean(
    input.clientId ||
    project.clientId ||
    project.clientID ||
    project.clientProfileId ||
    ''
  );
}

function resolveProject(
  projectId,
  input = {}
) {
  if (
    input.project &&
    typeof input.project === 'object'
  ) {
    return input.project;
  }

  if (!projectId) {
    return null;
  }

  return getProject(projectId);
}

function resolveClientProfile(
  clientId,
  input = {}
) {
  if (
    input.clientProfile &&
    typeof input.clientProfile === 'object'
  ) {
    return input.clientProfile;
  }

  if (!clientId) {
    return null;
  }

  return getClientProfile(clientId);
}

function isProjectComplete(project) {
  return Boolean(
    project &&
    (
      project.status === 'completed' ||
      project.status === 'archived'
    )
  );
}

function clientIsBlocked(profile) {
  if (!profile) {
    return false;
  }

  const communication =
    profile.communication &&
    typeof profile.communication === 'object'
      ? profile.communication
      : {};

  return (
    profile.status === 'blocked' ||
    profile.status === 'inactive' ||
    profile.status === 'do_not_contact' ||
    profile.doNotContact === true ||
    profile.contactAllowed === false ||
    communication.doNotContact === true ||
    communication.contactAllowed === false
  );
}

function buildFollowUpMessage(
  project,
  profile
) {
  const clientName =
    clean(profile && profile.name);

  const greeting =
    clientName
      ? `Hello ${clientName},`
      : 'Hello,';

  const projectTitle =
    clean(
      project &&
      (
        project.title ||
        project.name ||
        (
          project.workScopeSnapshot &&
          project.workScopeSnapshot.summary
        )
      )
    ) || 'your project';

  return [
    greeting,
    '',
    `I’m following up regarding ${projectTitle}.`,
    'Please let me know if you have any feedback or if there is anything else you need.',
    '',
    'Thank you.'
  ].join('\n');
}

function getPolicy(message) {
  try {
    return evaluatePolicy(
      message,
      'status_request'
    );
  } catch (_error) {
    return {
      policyChecked: false,
      decision: 'unknown',
      financialCommitment: false,
      legalCommitment: false,
      contractualCommitment: false,
      irreversibleAction: false
    };
  }
}

function evaluateFollowUpEligibility(input = {}) {
  const now =
    input.now
      ? new Date(input.now)
      : new Date();

  if (Number.isNaN(now.getTime())) {
    throw new Error('INVALID_NOW');
  }

  const project =
    resolveProject(
      input.projectId,
      input
    );

  const clientId =
    resolveClientId(
      project,
      input
    );

  const profile =
    resolveClientProfile(
      clientId,
      input
    );

  if (!project) {
    return {
      eligible: false,
      status: 'blocked',
      reason: 'PROJECT_NOT_COMPLETE',
      project: null,
      clientId
    };
  }

  if (!isProjectComplete(project)) {
    return {
      eligible: false,
      status: 'blocked',
      reason: 'PROJECT_NOT_COMPLETE',
      project,
      clientId
    };
  }

  if (!profile) {
    return {
      eligible: false,
      status: 'blocked',
      reason: 'CLIENT_NOT_FOUND',
      project,
      clientId
    };
  }

  if (clientIsBlocked(profile)) {
    return {
      eligible: false,
      status: 'blocked',
      reason: 'CLIENT_BLOCKED',
      project,
      clientId,
      profile
    };
  }

  const cooldownMs =
    Number.isFinite(input.cooldownMs) &&
    input.cooldownMs >= 0
      ? input.cooldownMs
      : DEFAULT_COOLDOWN_MS;

  const maxFollowUps =
    Number.isInteger(input.maxFollowUps) &&
    input.maxFollowUps >= 0
      ? input.maxFollowUps
      : DEFAULT_MAX_FOLLOW_UPS;

  const previous =
    followUpStore.list({
      clientId
    });

  if (previous.length >= maxFollowUps) {
    return {
      eligible: false,
      status: 'limit_reached',
      reason: 'FOLLOW_UP_LIMIT_REACHED',
      project,
      clientId,
      profile,
      previousCount: previous.length
    };
  }

  const latest =
    followUpStore.findLatestForClient(
      clientId
    );

  if (latest) {
    const latestTime =
      new Date(
        latest.createdAt
      ).getTime();

    if (
      Number.isFinite(latestTime) &&
      now.getTime() -
        latestTime <
        cooldownMs
    ) {
      return {
        eligible: false,
        status: 'cooldown',
        reason: 'COOLDOWN_ACTIVE',
        project,
        clientId,
        profile,
        latestFollowUpId: latest.id,
        nextEligibleAt:
          new Date(
            latestTime + cooldownMs
          ).toISOString()
      };
    }

    if (
      latest.projectId ===
      project.projectId
    ) {
      return {
        eligible: false,
        status: 'already_followed',
        reason: 'ALREADY_FOLLOWED_UP',
        project,
        clientId,
        profile,
        latestFollowUpId: latest.id
      };
    }
  }

  return {
    eligible: true,
    status: 'eligible',
    reason: 'ELIGIBLE',
    project,
    clientId,
    profile
  };
}

function createFollowUpDraft(input = {}) {
  const eligibility =
    evaluateFollowUpEligibility(
      input
    );

  if (!eligibility.eligible) {
    return {
      ok: false,
      status: eligibility.status,
      eligibility,
      followUp: null
    };
  }

  const message =
    buildFollowUpMessage(
      eligibility.project,
      eligibility.profile
    );

  const messageHash =
    hashMessage(message);

  const duplicate =
    followUpStore.findByMessageHash(
      eligibility.clientId,
      messageHash
    );

  if (duplicate) {
    return {
      ok: false,
      status: 'duplicate',
      eligibility: {
        ...eligibility,
        eligible: false,
        status: 'duplicate',
        reason: 'DUPLICATE_MESSAGE'
      },
      followUp: duplicate
    };
  }

  const policy =
    getPolicy(message);

  if (
    !policy ||
    policy.policyChecked !== true ||
    policy.decision !== 'allowed'
  ) {
    return {
      ok: false,
      status: 'blocked',
      eligibility: {
        ...eligibility,
        eligible: false,
        status: 'blocked',
        reason: 'CLIENT_BLOCKED'
      },
      policy,
      followUp: null
    };
  }

  const now =
    input.now
      ? new Date(input.now)
      : new Date();

  const id =
    input.id ||
    `followup-${Date.now()}-${crypto
      .randomBytes(6)
      .toString('hex')}`;

  const record =
    followUpStore.create({
      id,
      projectId:
        eligibility.project.projectId ||
        input.projectId,
      clientId:
        eligibility.clientId,
      status: 'draft_ready',
      eligibilityReason: 'ELIGIBLE',
      message,
      messageHash,
      attemptCount: 0,
      lastFollowUpAt: null,
      nextEligibleAt:
        new Date(
          now.getTime() +
          (
            Number.isFinite(input.cooldownMs) &&
            input.cooldownMs >= 0
              ? input.cooldownMs
              : DEFAULT_COOLDOWN_MS
          )
        ).toISOString(),
      createdAt:
        now.toISOString(),
      updatedAt:
        now.toISOString()
    });

  return {
    ok: true,
    status: 'draft_ready',
    eligibility,
    policy,
    followUp: record,
    sendBoundary: {
      sendAllowed: false,
      externalSendImplemented: false,
      status: 'not_implemented'
    }
  };
}

function writeFollowUpAudit(result) {
  try {
    const audit =
      require("../audit-log");

    if (
      typeof audit.recordAudit !== "function"
    ) {
      return {
        ok: false,
        status: "AUDIT_WRITER_UNAVAILABLE"
      };
    }

    const followUp =
      result &&
      result.followUp
        ? result.followUp
        : null;

    const projectId =
      result &&
      result.project &&
      result.project.projectId
        ? result.project.projectId
        : followUp &&
          followUp.projectId
          ? followUp.projectId
          : "";

    const clientId =
      result &&
      result.clientProfile &&
      (
        result.clientProfile.id ||
        result.clientProfile.clientId
      )
        ? (
            result.clientProfile.id ||
            result.clientProfile.clientId
          )
        : followUp &&
          followUp.clientId
          ? followUp.clientId
          : "";

    const auditResult =
      audit.recordAudit({
        actorRole: "agent",
        action: "client_follow_up",
        resource: "client-follow-up",
        resourceId:
          followUp && followUp.id
            ? followUp.id
            : "",
        status:
          result && result.ok
            ? "success"
            : "blocked",
        details: {
          followUpId:
            followUp && followUp.id
              ? followUp.id
              : null,

          projectId:
            projectId || null,

          clientId:
            clientId || null,

          resultStatus:
            result && result.status
              ? result.status
              : null,

          eligibilityReason:
            result &&
            result.eligibility &&
            result.eligibility.reason
              ? result.eligibility.reason
              : null,

          messageHash:
            followUp &&
            followUp.messageHash
              ? followUp.messageHash
              : null,

          sendAllowed: false,

          externalSendImplemented: false
        }
      });

    return {
      ok: true,
      entry: auditResult
    };
  } catch (error) {
    return {
      ok: false,
      status: "AUDIT_WRITE_FAILED",
      error: error.message
    };
  }
}

function processClientFollowUp(input = {}) {
  const result =
    createFollowUpDraft(input);

  let auditResult = null;

  if (
    result.ok &&
    result.followUp
  ) {
    auditResult =
      writeFollowUpAudit({
        ...result,
        project: input.project || null,
        clientProfile:
          input.clientProfile || null
      });
  }

  return {
    ok: result.ok,
    status: result.status,
    eligibility: result.eligibility,
    policy: result.policy || null,
    followUp: result.followUp || null,
    audit: auditResult,
    sendBoundary:
      result.sendBoundary || {
        sendAllowed: false,
        externalSendImplemented: false,
        status: 'not_implemented'
      }
  };
}

module.exports = {
  DEFAULT_COOLDOWN_MS,
  DEFAULT_MAX_FOLLOW_UPS,
  hashMessage,
  isProjectComplete,
  clientIsBlocked,
  buildFollowUpMessage,
  evaluateFollowUpEligibility,
  createFollowUpDraft,
  processClientFollowUp
};
