'use strict';

const crypto = require('crypto');

const {
  cleanText,
  cleanList,
  clampScore,
  createRepeatWorkDetection
} = require('../repeat-work-detection-schema');

const experienceRetrieval = require('./mira-experience-retrieval-engine');
const futureStrategy = require('./mira-future-strategy-engine');

const ENGINE_VERSION = '11.3.0';
const MAX_EXPERIENCES = 10;
const MAX_STRATEGIES = 5;

function normalize(value) {
  return cleanText(value).toLowerCase();
}

function tokenize(value) {
  return [...new Set(
    normalize(value)
      .replace(/[^a-z0-9_\-\s]/g, ' ')
      .split(/\s+/)
      .filter(token => token.length >= 2)
  )];
}

function textOf(value) {
  if (!value || typeof value !== 'object') return '';
  const parts = [];

  for (const key of [
    'title',
    'name',
    'description',
    'summary',
    'requirements',
    'domain',
    'type',
    'skills',
    'tags',
    'keywords',
    'clientName',
    'clientId'
  ]) {
    const item = value[key];
    if (Array.isArray(item)) parts.push(item.join(' '));
    else if (item !== undefined && item !== null) parts.push(String(item));
  }

  return parts.join(' ');
}

function tokenSimilarity(a, b) {
  const left = new Set(tokenize(a));
  const right = new Set(tokenize(b));

  if (!left.size || !right.size) return 0;

  let intersection = 0;
  for (const token of left) {
    if (right.has(token)) intersection++;
  }

  const union = new Set([...left, ...right]).size;
  return union ? intersection / union : 0;
}

function calculateSimilarity(opportunity, experience) {
  const opportunityText = textOf(opportunity);
  const experienceText = textOf(experience);

  const lexical = tokenSimilarity(opportunityText, experienceText);

  const opportunitySkills = cleanList(
    opportunity && (opportunity.skills || opportunity.requiredSkills)
  ).map(normalize);

  const experienceSkills = cleanList(
    experience && (experience.skills || experience.usedSkills || experience.capabilities)
  ).map(normalize);

  let skillScore = 0;

  if (opportunitySkills.length && experienceSkills.length) {
    const exp = new Set(experienceSkills);
    skillScore =
      opportunitySkills.filter(skill => exp.has(skill)).length /
      opportunitySkills.length;
  }

  const opportunityDomain = normalize(opportunity && opportunity.domain);
  const experienceDomain = normalize(
    experience && (experience.domain || experience.category)
  );

  const domainScore =
    opportunityDomain && experienceDomain &&
    opportunityDomain === experienceDomain
      ? 1
      : 0;

  // Structured task signals (skills + domain) carry more weight than
  // wording similarity because repeat work can be described differently.
  // Skills are the strongest structured signal for repeat work.
  // Domain confirms the type of work, while lexical similarity handles
  // wording overlap without dominating when descriptions differ.
  const score =
    lexical * 0.30 +
    skillScore * 0.50 +
    domainScore * 0.20;

  return clampScore(score);
}

function getCandidates(opportunity, options = {}) {
  const limit = Math.max(
    1,
    Math.min(Number(options.maxExperiences) || MAX_EXPERIENCES, 50)
  );

  try {
    if (typeof experienceRetrieval.getExperiencesForTask === 'function') {
      const result = experienceRetrieval.getExperiencesForTask(opportunity, {
        limit
      });

      if (Array.isArray(result)) return result.slice(0, limit);
      if (result && Array.isArray(result.experiences)) {
        return result.experiences.slice(0, limit);
      }
    }
  } catch (_) {}

  try {
    if (typeof experienceRetrieval.retrieveExperiences === 'function') {
      const result = experienceRetrieval.retrieveExperiences(opportunity, {
        limit
      });

      if (Array.isArray(result)) return result.slice(0, limit);
      if (result && Array.isArray(result.experiences)) {
        return result.experiences.slice(0, limit);
      }
    }
  } catch (_) {}

  return [];
}

function retrieveRelevantExperience(opportunity, options = {}) {
  return getCandidates(opportunity, options)
    .map(experience => ({
      experience,
      experienceId: cleanText(
        experience && (
          experience.experienceId ||
          experience.id ||
          experience.workId ||
          experience.projectId
        )
      ),
      score: calculateSimilarity(opportunity, experience)
    }))
    .filter(item => item.experienceId)
    .sort((a, b) => b.score - a.score)
    .slice(0, Number(options.maxResults) || MAX_EXPERIENCES);
}

function retrieveRelevantStrategies(opportunity, experiences, options = {}) {
  const limit = Math.max(
    1,
    Math.min(Number(options.maxStrategies) || MAX_STRATEGIES, 20)
  );

  try {
    if (typeof futureStrategy.getStrategiesForTask === 'function') {
      const result = futureStrategy.getStrategiesForTask(opportunity, {
        limit
      });

      const strategies = Array.isArray(result)
        ? result
        : (result && Array.isArray(result.strategies)
          ? result.strategies
          : []);

      return strategies.slice(0, limit);
    }
  } catch (_) {}

  return experiences
    .map(item => item.experience)
    .filter(Boolean)
    .slice(0, limit)
    .map(experience => ({
      strategyId: cleanText(
        experience.strategyId ||
        experience.id ||
        experience.experienceId
      ),
      approach: cleanText(
        experience.strategy ||
        experience.approach ||
        experience.lesson
      ),
      rationale: cleanText(
        experience.lesson ||
        experience.summary ||
        experience.description
      ),
      steps: cleanList(experience.steps)
    }));
}

function buildStrategy(opportunity, relevant, strategies) {
  const firstStrategy = strategies[0] || {};
  const firstExperience = relevant[0] && relevant[0].experience;

  const approach = cleanText(
    firstStrategy.approach ||
    firstStrategy.strategy ||
    firstExperience && (
      firstExperience.strategy ||
      firstExperience.approach
    )
  );

  const rationale = cleanText(
    firstStrategy.rationale ||
    firstStrategy.lesson ||
    firstExperience && (
      firstExperience.lesson ||
      firstExperience.summary
    )
  );

  let steps = cleanList(firstStrategy.steps);

  if (!steps.length) {
    steps = [
      'Reuse the strongest relevant experience',
      'Adapt the proven approach to the new opportunity',
      'Validate requirements and constraints before execution'
    ];
  }

  return {
    approach: approach || (
      relevant.length
        ? 'Adapt the most relevant proven experience to the new opportunity'
        : 'Treat the opportunity as new work and establish a fresh execution approach'
    ),
    steps,
    rationale: rationale || (
      relevant.length
        ? 'Strategy is grounded in previously relevant work'
        : 'No sufficiently relevant past experience was found'
    )
  };
}

function decide(score) {
  if (score >= 0.80) return 'REPEAT_WORK';
  if (score >= 0.55) return 'RELATED_WORK';
  return 'NEW_WORK';
}

function detectRepeatWork(opportunity, options = {}) {
  if (!opportunity || typeof opportunity !== 'object') {
    throw new TypeError('opportunity must be an object');
  }

  const relevant = retrieveRelevantExperience(opportunity, options);
  const topScore = relevant.length ? relevant[0].score : 0;
  const strategies = retrieveRelevantStrategies(
    opportunity,
    relevant,
    options
  );

  const strategy = buildStrategy(opportunity, relevant, strategies);

  const detectionId = crypto
    .createHash('sha256')
    .update(JSON.stringify({
      opportunityId: opportunity.id || opportunity.opportunityId || '',
      relevantExperienceIds: relevant.map(item => item.experienceId),
      score: topScore
    }))
    .digest('hex')
    .slice(0, 24);

  return createRepeatWorkDetection({
    detectionId,
    opportunityId: opportunity.id || opportunity.opportunityId,
    decision: decide(topScore),
    similarityScore: topScore,
    relevantExperienceIds: relevant.map(item => item.experienceId),
    relevantStrategyIds: strategies.map(item =>
      cleanText(item && (
        item.strategyId ||
        item.id
      ))
    ).filter(Boolean),
    evidence: relevant.map(item => ({
      experienceId: item.experienceId,
      score: item.score,
      reason: item.score >= 0.80
        ? 'High similarity with past work'
        : item.score >= 0.55
          ? 'Related similarity with past work'
          : 'Low similarity with past work'
    })),
    strategy
  });
}

function getRepeatWorkDetectionStats() {
  return {
    engineVersion: ENGINE_VERSION,
    maxExperiences: MAX_EXPERIENCES,
    maxStrategies: MAX_STRATEGIES,
    decisions: ['REPEAT_WORK', 'RELATED_WORK', 'NEW_WORK']
  };
}

module.exports = {
  ENGINE_VERSION,
  MAX_EXPERIENCES,
  MAX_STRATEGIES,
  normalize,
  tokenize,
  textOf,
  tokenSimilarity,
  calculateSimilarity,
  retrieveRelevantExperience,
  retrieveRelevantStrategies,
  buildStrategy,
  decide,
  detectRepeatWork,
  getRepeatWorkDetectionStats
};
