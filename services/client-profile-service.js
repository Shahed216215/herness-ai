'use strict';

const store = require('../client-profile-store');
const {
  sanitize,
  validateProfile,
  createEmptyProfile
} = require('../client-profile-schema');

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function normalizeId(id) {
  if (typeof id !== 'string') {
    throw new TypeError('CLIENT_PROFILE_ID_REQUIRED');
  }

  const clean = id.trim();

  if (!clean) {
    throw new TypeError('CLIENT_PROFILE_ID_REQUIRED');
  }

  if (!/^[A-Za-z0-9._:-]{1,160}$/.test(clean)) {
    throw new TypeError('CLIENT_PROFILE_ID_INVALID');
  }

  return clean;
}

function addUnique(list, value, key = 'id') {
  if (!Array.isArray(list)) list = [];

  const clean = sanitize(value);

  if (clean === undefined) {
    throw new TypeError('CLIENT_PROFILE_SENSITIVE_OR_INVALID_DATA');
  }

  if (
    clean &&
    typeof clean === 'object' &&
    key in clean &&
    list.some(item => item && item[key] === clean[key])
  ) {
    return list;
  }

  if (
    typeof clean !== 'object' ||
    !list.some(item => JSON.stringify(item) === JSON.stringify(clean))
  ) {
    list.push(clean);
  }

  return list;
}

function createClientProfile(input) {
  const id = normalizeId(input && input.id);
  const sanitized = sanitize(input || {});

  sanitized.id = id;

  if (sanitized.name && typeof sanitized.name === 'string') {
    sanitized.name = sanitized.name.slice(0, 240);
  }

  const base = createEmptyProfile(id, sanitized.name || null);

  const profile = {
    ...base,
    ...sanitized,
    requirements: Array.isArray(sanitized.requirements)
      ? sanitized.requirements
      : [],
    communication: {
      preferences:
        sanitized.communication &&
        Array.isArray(sanitized.communication.preferences)
          ? sanitized.communication.preferences
          : [],
      notes:
        sanitized.communication &&
        Array.isArray(sanitized.communication.notes)
          ? sanitized.communication.notes
          : []
    },
    previousWork: Array.isArray(sanitized.previousWork)
      ? sanitized.previousWork
      : [],
    feedback: Array.isArray(sanitized.feedback)
      ? sanitized.feedback
      : [],
    scope: {
      included:
        sanitized.scope && Array.isArray(sanitized.scope.included)
          ? sanitized.scope.included
          : [],
      excluded:
        sanitized.scope && Array.isArray(sanitized.scope.excluded)
          ? sanitized.scope.excluded
          : [],
      constraints:
        sanitized.scope && Array.isArray(sanitized.scope.constraints)
          ? sanitized.scope.constraints
          : []
    },
    activeProjects: Array.isArray(sanitized.activeProjects)
      ? sanitized.activeProjects
      : [],
    completedProjects: Array.isArray(sanitized.completedProjects)
      ? sanitized.completedProjects
      : []
  };

  validateProfile(profile);

  const now = new Date().toISOString();
  profile.createdAt = now;
  profile.updatedAt = now;

  return clone(store.create(profile));
}

function getClientProfile(id) {
  const profile = store.get(normalizeId(id));
  return profile ? clone(profile) : null;
}

function listClientProfiles() {
  return store.list().map(clone);
}

function updateClientProfile(id, patch) {
  const normalizedId = normalizeId(id);
  const sanitizedPatch = sanitize(patch || {});

  delete sanitizedPatch.id;
  delete sanitizedPatch.createdAt;
  delete sanitizedPatch.updatedAt;

  const updated = store.update(normalizedId, current => {
    const merged = {
      ...current,
      ...sanitizedPatch,
      id: current.id,
      createdAt: current.createdAt,
      updatedAt: new Date().toISOString()
    };

    validateProfile(merged);
    return merged;
  });

  return clone(updated);
}

function addRequirement(id, requirement) {
  return updateClientProfile(id, {
    requirements: addUnique(
      getClientProfile(id).requirements,
      requirement
    )
  });
}

function addCommunicationNote(id, note) {
  const profile = getClientProfile(id);
  return updateClientProfile(id, {
    communication: {
      ...profile.communication,
      notes: addUnique(profile.communication.notes, note)
    }
  });
}

function addFeedback(id, feedback) {
  const profile = getClientProfile(id);
  return updateClientProfile(id, {
    feedback: addUnique(profile.feedback, feedback)
  });
}

function addPreviousWork(id, work) {
  const profile = getClientProfile(id);
  return updateClientProfile(id, {
    previousWork: addUnique(profile.previousWork, work)
  });
}

function setScope(id, scope) {
  const clean = sanitize(scope || {});
  return updateClientProfile(id, {
    scope: {
      included: Array.isArray(clean.included) ? clean.included : [],
      excluded: Array.isArray(clean.excluded) ? clean.excluded : [],
      constraints: Array.isArray(clean.constraints)
        ? clean.constraints
        : []
    }
  });
}

function linkProject(id, project, status = 'active') {
  const profile = getClientProfile(id);

  const clean = sanitize(project);

  if (!clean || typeof clean !== 'object') {
    throw new TypeError('CLIENT_PROFILE_PROJECT_INVALID');
  }

  if (!clean.id || typeof clean.id !== 'string') {
    throw new TypeError('CLIENT_PROFILE_PROJECT_ID_REQUIRED');
  }

  if (status === 'completed') {
    return updateClientProfile(id, {
      activeProjects: profile.activeProjects.filter(
        item => item && item.id !== clean.id
      ),
      completedProjects: addUnique(
        profile.completedProjects,
        clean,
        'id'
      )
    });
  }

  return updateClientProfile(id, {
    activeProjects: addUnique(profile.activeProjects, clean, 'id')
  });
}

function removeClientProfile(id) {
  return store.remove(normalizeId(id));
}

function inspectSensitiveInput(input) {
  const clean = sanitize(input);
  return {
    sanitized: clone(clean),
    removedSensitiveData:
      JSON.stringify(clean) !== JSON.stringify(input)
  };
}

module.exports = {
  createClientProfile,
  getClientProfile,
  listClientProfiles,
  updateClientProfile,
  addRequirement,
  addCommunicationNote,
  addFeedback,
  addPreviousWork,
  setScope,
  linkProject,
  removeClientProfile,
  inspectSensitiveInput
};
