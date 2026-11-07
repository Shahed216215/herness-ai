const { assertLegacyStorageDisabled } = require('./services/mira-hfm-legacy-storage-guard');
const fs = require("fs");
const crypto = require("crypto");
const path = require("path");
const storagePath = require('./mira-storage');
const { saveKnowledgeToDrive } = require("./google-drive");

const {
  getCapacity
} = require("./capacity-config");

const KNOWLEDGE_FILE = storagePath("knowledge.json");

function createKnowledgeId(entry) {
  const title = normalize(entry.title || "");
  const topic = normalize(entry.topic || "");
  const url = normalize(
    entry.url || entry.source || ""
  );
  const source = normalize(entry.source || "");
  const content = normalize(entry.content || "");

  const identity = [
    title,
    topic,
    url,
    source,
    content
  ].join("|");

  const hash = crypto
    .createHash("sha256")
    .update(identity, "utf8")
    .digest("hex")
    .slice(0, 24);

  return `kb_${hash}`;
}

function getMaxKnowledgeEntries() {
  return getCapacity("knowledge");
}

const MAX_TITLE_LENGTH = 300;
const MAX_URL_LENGTH = 1000;
const MAX_CONTENT_LENGTH = 20000;
const MAX_TOPIC_LENGTH = 300;
const MAX_SOURCE_LENGTH = 1000;

const ALLOWED_DIFFICULTIES = [
  "Beginner",
  "Intermediate",
  "Advanced",
  "Expert"
];

function loadKnowledge() {
  assertLegacyStorageDisabled();
  if (!fs.existsSync(KNOWLEDGE_FILE)) {
    return [];
  }

  try {
    const data = JSON.parse(
      fs.readFileSync(KNOWLEDGE_FILE, "utf8")
    );

    return Array.isArray(data) ? data : [];
  } catch (error) {
    console.error(
      "KNOWLEDGE_LOAD_ERROR:",
      error.message
    );

    return [];
  }
}

function saveLocalKnowledge(data) {
  assertLegacyStorageDisabled();
  fs.writeFileSync(
    KNOWLEDGE_FILE,
    JSON.stringify(data, null, 2),
    "utf8"
  );
}

function normalize(value) {
  return String(value || "")
    .trim()
    .toLowerCase();
}

function cleanString(value, maxLength) {
  return String(value || "")
    .trim()
    .slice(0, maxLength);
}

function isDuplicate(a, b) {
  return (
    normalize(a.title) === normalize(b.title) &&
    normalize(a.url) === normalize(b.url) &&
    normalize(a.content) === normalize(b.content)
  );
}

async function syncToDrive(knowledge) {
  try {
    await saveKnowledgeToDrive(knowledge);

    console.log(
      "Knowledge Drive sync: updated"
    );

    return true;
  } catch (error) {
    console.error(
      "KNOWLEDGE_DRIVE_ERROR:",
      error.message
    );

    return false;
  }
}

async function addKnowledge(
  title,
  url,
  content,
  metadata = {}
) {
  const knowledge = loadKnowledge();

  const newEntry = {
    title: cleanString(
      title,
      MAX_TITLE_LENGTH
    ),

    url: cleanString(
      url,
      MAX_URL_LENGTH
    ),

    content: cleanString(
      content,
      MAX_CONTENT_LENGTH
    )
  };

  const duplicate = knowledge.some(item =>
    isDuplicate(item, newEntry)
  );

  if (duplicate) {
    console.log(
      "Knowledge duplicate detected. Skipping new entry."
    );

    const drive = await syncToDrive(
      knowledge
    );

    return {
      status: "duplicate_skipped",
      added: false,
      duplicate: true,
      drive
    };
  }

  const entry = {
    ...newEntry,

    ...(metadata &&
    typeof metadata === "object"
      ? metadata
      : {}),

    savedAt: new Date().toISOString()
  };

  entry.id = createKnowledgeId(entry);

  knowledge.push(entry);

  const limitedKnowledge =
    knowledge.slice(
    -getMaxKnowledgeEntries()
  );

  saveLocalKnowledge(
    limitedKnowledge
  );

  const drive = await syncToDrive(
    limitedKnowledge
  );

  return {
    status: "added",
    added: true,
    duplicate: false,
    drive,
    savedAt: entry.savedAt
  };
}

function validateLearningInput(input) {
  const errors = [];

  if (!input || typeof input !== "object") {
    return {
      valid: false,
      errors: ["Learning input is required."]
    };
  }

  const title = cleanString(
    input.title,
    MAX_TITLE_LENGTH
  );

  const topic = cleanString(
    input.topic,
    MAX_TOPIC_LENGTH
  );

  const content = cleanString(
    input.content,
    MAX_CONTENT_LENGTH
  );

  const category = cleanString(
    input.category,
    100
  );

  const track = cleanString(
    input.track,
    100
  );

  const difficulty = cleanString(
    input.difficulty,
    50
  );

  const source = cleanString(
    input.source || input.url,
    MAX_SOURCE_LENGTH
  );

  const concept = cleanString(
    input.concept,
    MAX_CONTENT_LENGTH
  );

  const technique = cleanString(
    input.technique,
    MAX_CONTENT_LENGTH
  );

  const safeLabExample = cleanString(
    input.safeLabExample,
    MAX_CONTENT_LENGTH
  );

  const defense = cleanString(
    input.defense,
    MAX_CONTENT_LENGTH
  );

  const detection = cleanString(
    input.detection,
    MAX_CONTENT_LENGTH
  );

  if (!title) {
    errors.push("title is required.");
  }

  if (!topic) {
    errors.push("topic is required.");
  }

  if (!content) {
    errors.push("content is required.");
  }

  if (
    difficulty &&
    !ALLOWED_DIFFICULTIES.includes(
      difficulty
    )
  ) {
    errors.push(
      `difficulty must be one of: ${ALLOWED_DIFFICULTIES.join(", ")}.`
    );
  }

  return {
    valid: errors.length === 0,
    errors,

    value: {
      title,
      topic,
      category:
        category || "General",
      track:
        track || "",
      difficulty:
        difficulty || "Beginner",
      content,
      source,
      concept,
      technique,
      safeLabExample,
      defense,
      detection
    }
  };
}

async function addLearning(input) {
  const validation =
    validateLearningInput(input);

  if (!validation.valid) {
    return {
      status: "validation_error",
      added: false,
      duplicate: false,
      drive: false,
      errors: validation.errors
    };
  }

  const data =
    validation.value;

  const knowledge =
    loadKnowledge();

  const duplicate =
    knowledge.some(item => {
      return (
        normalize(item.title) ===
          normalize(data.title) &&
        normalize(item.topic) ===
          normalize(data.topic) &&
        normalize(item.content) ===
          normalize(data.content)
      );
    });

  if (duplicate) {
    console.log(
      "Learning duplicate detected. Skipping."
    );

    const drive =
      await syncToDrive(knowledge);

    return {
      status: "duplicate_skipped",
      added: false,
      duplicate: true,
      drive
    };
  }

  const entry = {
    type: "learning",

    category:
      data.category,

    track:
      data.track,

    topic:
      data.topic,

    difficulty:
      data.difficulty,

    title:
      data.title,

    concept:
      data.concept,

    technique:
      data.technique,

    safeLabExample:
      data.safeLabExample,

    defense:
      data.defense,

    detection:
      data.detection,

    url:
      data.source,

    source:
      data.source,

    content:
      data.content,

    savedAt:
      new Date().toISOString()
  };

  entry.id = createKnowledgeId(entry);

  knowledge.push(entry);

  const limitedKnowledge =
    knowledge.slice(
    -getMaxKnowledgeEntries()
  );

  saveLocalKnowledge(
    limitedKnowledge
  );

  const drive =
    await syncToDrive(
      limitedKnowledge
    );

  return {
    status: "learned",
    added: true,
    duplicate: false,
    drive,

    entry: {
      type:
        entry.type,

      category:
        entry.category,

      track:
        entry.track,

      topic:
        entry.topic,

      difficulty:
        entry.difficulty,

      title:
        entry.title,

      concept:
        entry.concept,

      technique:
        entry.technique,

      safeLabExample:
        entry.safeLabExample,

      defense:
        entry.defense,

      detection:
        entry.detection,

      source:
        entry.source,

      savedAt:
        entry.savedAt
    }
  };
}


async function deleteKnowledge(id) {
  const knowledge = loadKnowledge();

  const targetIndex = knowledge.findIndex(
    item =>
      item &&
      String(item.id || "") === String(id || "")
  );

  if (targetIndex === -1) {
    return {
      status: "not_found",
      deleted: false,
      drive: false,
      error:
        "Knowledge entry was not found."
    };
  }

  const existing =
    knowledge[targetIndex];

  const updatedKnowledge =
    knowledge.filter(
      (_, index) =>
        index !== targetIndex
    );

  saveLocalKnowledge(
    updatedKnowledge
  );

  const drive =
    await syncToDrive(
      updatedKnowledge
    );

  return {
    status: "deleted",
    deleted: true,
    drive,

    entry: {
      id: existing.id,
      type: existing.type || "knowledge",
      title: existing.title || "",
      topic: existing.topic || "",
      content: existing.content || "",
      savedAt: existing.savedAt || "",
      updatedAt: existing.updatedAt || ""
    }
  };
}

async function updateKnowledge(id, input = {}) {
  const knowledge = loadKnowledge();

  const targetIndex = knowledge.findIndex(
    item =>
      item &&
      String(item.id || "") === String(id || "")
  );

  if (targetIndex === -1) {
    return {
      status: "not_found",
      updated: false,
      duplicate: false,
      drive: false,
      error:
        "Knowledge entry was not found."
    };
  }

  const existing =
    knowledge[targetIndex];

  const title = cleanString(
    input.title,
    MAX_TITLE_LENGTH
  );

  const url = cleanString(
    input.url ||
      input.source ||
      "",
    MAX_URL_LENGTH
  );

  const content = cleanString(
    input.content,
    MAX_CONTENT_LENGTH
  );

  if (!title || !content) {
    return {
      status: "validation_error",
      updated: false,
      duplicate: false,
      drive: false,
      errors: [
        "title and content are required."
      ]
    };
  }

  const duplicateIndex =
    knowledge.findIndex(
      (item, index) => {
        if (index === targetIndex) {
          return false;
        }

        return isDuplicate(
          item,
          {
            title,
            url,
            content
          }
        );
      }
    );

  if (duplicateIndex !== -1) {
    return {
      status: "duplicate_skipped",
      updated: false,
      duplicate: true,
      drive: false,
      error:
        "Another Knowledge entry already contains the same title, URL and content."
    };
  }

  const updatedEntry = {
    ...existing,

    title,
    url,
    content,

    updatedAt:
      new Date().toISOString()
  };

  /*
   * Preserve the existing stable ID.
   */
  updatedEntry.id =
    existing.id ||
    createKnowledgeId(
      updatedEntry
    );

  knowledge[targetIndex] =
    updatedEntry;

  const limitedKnowledge =
    knowledge.slice(
      -getMaxKnowledgeEntries()
    );

  saveLocalKnowledge(
    limitedKnowledge
  );

  const drive =
    await syncToDrive(
      limitedKnowledge
    );

  return {
    status: "updated",
    updated: true,
    duplicate: false,
    drive,

    previous: {
      id: existing.id || "",
      title: existing.title || "",
      url: existing.url || "",
      content: existing.content || ""
    },

    entry: {
      id: updatedEntry.id,
      title: updatedEntry.title,
      url: updatedEntry.url,
      content: updatedEntry.content,
      savedAt:
        updatedEntry.savedAt || "",
      updatedAt:
        updatedEntry.updatedAt || ""
    }
  };
}

async function updateLearning(idOrMatch, input) {
  const validation = validateLearningInput(input);

  if (!validation.valid) {
    return {
      status: "validation_error",
      updated: false,
      duplicate: false,
      drive: false,
      errors: validation.errors
    };
  }

  const data = validation.value;
  const knowledge = loadKnowledge();

  const targetIndex = knowledge.findIndex(item => {
    if (
      idOrMatch &&
      typeof idOrMatch === "object"
    ) {
      return (
        normalize(item.title) ===
          normalize(idOrMatch.title) &&
        normalize(item.topic) ===
          normalize(idOrMatch.topic)
      );
    }

    return (
      String(item.id || "") === String(idOrMatch) ||
      normalize(item.title) === normalize(idOrMatch)
    );
  });

  if (targetIndex === -1) {
    return {
      status: "not_found",
      updated: false,
      duplicate: false,
      drive: false,
      errors: ["Target learning entry was not found."]
    };
  }

  const existing = knowledge[targetIndex];

  const duplicateIndex = knowledge.findIndex(
    (item, index) => {
      if (index === targetIndex) {
        return false;
      }

      return (
        item &&
        item.type === "learning" &&
        normalize(item.title) === normalize(data.title) &&
        normalize(item.topic) === normalize(data.topic) &&
        normalize(item.content) === normalize(data.content)
      );
    }
  );

  if (duplicateIndex !== -1) {
    return {
      status: "duplicate_skipped",
      updated: false,
      duplicate: true,
      drive: false,
      title: existing.title,
      topic: existing.topic,
      reason:
        "Updated content is equivalent to another existing knowledge entry."
    };
  }

  const updatedEntry = {
    ...existing,

    type: "learning",

    category: data.category,
    track: data.track,
    topic: data.topic,
    difficulty: data.difficulty,
    title: data.title,

    concept: data.concept,
    technique: data.technique,
    safeLabExample: data.safeLabExample,
    defense: data.defense,
    detection: data.detection,

    url: data.source,
    source: data.source,
    content: data.content,

    updatedAt: new Date().toISOString()
  };

  knowledge[targetIndex] = updatedEntry;

  const limitedKnowledge = knowledge.slice(
    -getMaxKnowledgeEntries()
  );

  saveLocalKnowledge(limitedKnowledge);

  const drive = await syncToDrive(
    limitedKnowledge
  );

  return {
    status: "updated",
    updated: true,
    duplicate: false,
    drive,

    previous: {
      title: existing.title,
      topic: existing.topic,
      content: existing.content
    },

    entry: {
      type: updatedEntry.type,
      category: updatedEntry.category,
      track: updatedEntry.track,
      topic: updatedEntry.topic,
      difficulty: updatedEntry.difficulty,
      title: updatedEntry.title,
      concept: updatedEntry.concept,
      technique: updatedEntry.technique,
      safeLabExample: updatedEntry.safeLabExample,
      defense: updatedEntry.defense,
      detection: updatedEntry.detection,
      source: updatedEntry.source,
      content: updatedEntry.content,
      savedAt: updatedEntry.savedAt,
      updatedAt: updatedEntry.updatedAt
    }
  };
}

function tokenize(value) {
  return normalize(value)
    .split(/[^a-z0-9]+/)
    .filter(
      token => token.length >= 2
    );
}

function searchKnowledge(
  query,
  limit = 5
) {
  const knowledge =
    loadKnowledge();

  const searchTokens =
    tokenize(query);

  if (!searchTokens.length) {
    return [];
  }

  const results =
    knowledge
      .map(entry => {
        const searchable =
          normalize(
            [
              entry.title,
              entry.topic,
              entry.category,
              entry.track,
              entry.difficulty,
              entry.content,
              entry.source,
              entry.url
            ]
              .filter(Boolean)
              .join(" ")
          );

        const tokens =
          new Set(
            tokenize(searchable)
          );

        let score = 0;

        for (const token of searchTokens) {
          if (tokens.has(token)) {
            score += 2;
          }

          if (
            searchable.includes(token)
          ) {
            score += 1;
          }
        }

        if (
          normalize(entry.topic) ===
          normalize(query)
        ) {
          score += 5;
        }

        if (
          normalize(entry.title) ===
          normalize(query)
        ) {
          score += 5;
        }

        /*
         * Structured learning entries receive
         * an additional recall priority.
         *
         * This does not replace relevance scoring.
         * It only helps relevant learning material
         * appear before equally relevant generic
         * knowledge.
         */
        if (
          entry.type === "learning"
        ) {
          score += 4;
        }

        return {
          entry,
          score
        };
      })
      .filter(item => item.score > 0)
      .sort(
        (a, b) => {
          if (
            b.score !==
            a.score
          ) {
            return b.score - a.score;
          }

          const aLearning =
            a.entry.type ===
            "learning";

          const bLearning =
            b.entry.type ===
            "learning";

          if (
            aLearning !==
            bLearning
          ) {
            return bLearning
              ? 1
              : -1;
          }

          return 0;
        }
      )
      .slice(
        0,
        Math.max(
          1,
          Math.min(
            Number(limit) || 5,
            20
          )
        )
      );

  return results.map(
    item => ({
      score: item.score,
      ...item.entry
    })
  );
}

function getKnowledge() {
  return loadKnowledge();
}

function getKnowledgeStats() {
  const knowledge =
    loadKnowledge();

  const now = new Date();

  const startOfToday =
    new Date(
      now.getFullYear(),
      now.getMonth(),
      now.getDate()
    );

  const startOfTomorrow =
    new Date(
      now.getFullYear(),
      now.getMonth(),
      now.getDate() + 1
    );

  const todayEntries =
    knowledge.filter(entry => {
      if (
        !entry ||
        !entry.savedAt
      ) {
        return false;
      }

      const savedAt =
        new Date(
          entry.savedAt
        );

      return (
        savedAt >= startOfToday &&
        savedAt < startOfTomorrow
      );
    });

  const learningEntries =
    knowledge.filter(
      entry =>
        entry &&
        entry.type === "learning"
    );

  const latestEntries =
    [...knowledge]
      .filter(
        entry =>
          entry &&
          entry.savedAt
      )
      .sort(
        (a, b) =>
          new Date(b.savedAt) -
          new Date(a.savedAt)
      )
      .slice(0, 10);

  return {
    total: knowledge.length,

    maximum:
      getMaxKnowledgeEntries(),

    freeSlots:
      Math.max(
        getMaxKnowledgeEntries() -
          knowledge.length,
        0
      ),

    todayLearned:
      todayEntries.length,

    learningTotal:
      learningEntries.length,

    todaySummary:
      todayEntries.map(entry => ({
        title:
          entry.title ||
          "Untitled",

        topic:
          entry.topic ||
          "",

        category:
          entry.category ||
          "",

        track:
          entry.track ||
          "",

        difficulty:
          entry.difficulty ||
          "",

        concept:
          entry.concept ||
          "",

        technique:
          entry.technique ||
          "",

        safeLabExample:
          entry.safeLabExample ||
          "",

        defense:
          entry.defense ||
          "",

        detection:
          entry.detection ||
          "",

        type:
          entry.type ||
          "knowledge",

        url:
          entry.url ||
          "",

        savedAt:
          entry.savedAt
      })),

    todayItems:
      todayEntries.map(entry => ({
        title:
          entry.title ||
          "Untitled",

        topic:
          entry.topic ||
          "",

        category:
          entry.category ||
          "",

        track:
          entry.track ||
          "",

        difficulty:
          entry.difficulty ||
          "",

        concept:
          entry.concept ||
          "",

        technique:
          entry.technique ||
          "",

        safeLabExample:
          entry.safeLabExample ||
          "",

        defense:
          entry.defense ||
          "",

        detection:
          entry.detection ||
          "",

        type:
          entry.type ||
          "knowledge",

        url:
          entry.url ||
          "",

        source:
          entry.source ||
          entry.url ||
          "",

        content:
          entry.content ||
          "",

        savedAt:
          entry.savedAt
      })),

    latest:
      latestEntries.map(entry => ({
        title:
          entry.title ||
          "Untitled",

        topic:
          entry.topic ||
          "",

        category:
          entry.category ||
          "",

        track:
          entry.track ||
          "",

        difficulty:
          entry.difficulty ||
          "",

        concept:
          entry.concept ||
          "",

        technique:
          entry.technique ||
          "",

        safeLabExample:
          entry.safeLabExample ||
          "",

        defense:
          entry.defense ||
          "",

        detection:
          entry.detection ||
          "",

        type:
          entry.type ||
          "knowledge",

        url:
          entry.url ||
          "",

        source:
          entry.source ||
          entry.url ||
          "",

        content:
          entry.content ||
          "",

        savedAt:
          entry.savedAt
      }))
  };
}

module.exports = {
  addKnowledge,
  addLearning,
  updateKnowledge,
  updateLearning,
  deleteKnowledge,
  searchKnowledge,
  getKnowledge,
  getKnowledgeStats,
  validateLearningInput
};
