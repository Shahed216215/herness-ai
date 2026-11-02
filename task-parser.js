"use strict";

function cleanText(value) {
  return String(
    value === undefined ||
    value === null
      ? ""
      : value
  ).trim();
}

function detectTaskType(text) {
  const value = text.toLowerCase();

  /*
   * More specific categories must be checked
   * before generic categories.
   */

  if (
    /authorized security|authorized cybersecurity|penetration test|security assessment|vulnerability assessment/.test(
      value
    )
  ) {
    return "authorized_cybersecurity";
  }

  if (
    /web research|search the web|online research|browse|web search/.test(
      value
    )
  ) {
    return "web_research";
  }

  if (
    /excel|spreadsheet|csv|data entry|dataset|data analysis/.test(
      value
    )
  ) {
    return "excel_data";
  }

  if (
    /code|coding|program|javascript|python|node\.?js|bug fix|software/.test(
      value
    )
  ) {
    return "coding";
  }

  if (
    /automate|automation|workflow|automated/.test(
      value
    )
  ) {
    return "automation";
  }

  if (
    /write|writing|article|blog|content|copy|essay/.test(
      value
    )
  ) {
    return "writing";
  }

  if (
    /research|investigate|study|analyze information|find information/.test(
      value
    )
  ) {
    return "research";
  }

  if (
    /document|pdf|word|format document/.test(
      value
    )
  ) {
    return "documents";
  }

  return "research";
}

function extractRequirements(text) {
  const requirements = [];

  const patterns = [
    /must\s+([^.!?]+)/gi,
    /need(?:s)?\s+to\s+([^.!?]+)/gi,
    /required\s*:\s*([^.!?]+)/gi,
    /requirements?\s*:\s*([^.!?]+)/gi,
    /(?:using|use)\s+([^.!?]+)/gi
  ];

  for (const pattern of patterns) {
    let match;

    while ((match = pattern.exec(text)) !== null) {
      const value = cleanText(match[1]);

      if (
        value &&
        !requirements.includes(value)
      ) {
        requirements.push(value);
      }
    }
  }

  return requirements;
}

function extractDeliverables(text) {
  const deliverables = [];

  const patterns = [
    /deliver(?:able|ables)\s*:\s*([^.!?]+)/gi,
    /submit\s+(?:the\s+|a\s+|an\s+)?([^.!?,]+?)(?=\s+by\s+|\s+before\s+|\s+due\s+|[.!?]|$)/gi,
    /provide\s+(?:the\s+|a\s+|an\s+)?([^.!?,]+?)(?=\s+by\s+|\s+before\s+|\s+due\s+|[.!?]|$)/gi,
    /create\s+(?:the\s+|a\s+|an\s+)?([^.!?,]+?)(?=\s+by\s+|\s+before\s+|\s+due\s+|[.!?]|$)/gi
  ];

  for (const pattern of patterns) {
    let match;

    while ((match = pattern.exec(text)) !== null) {
      const raw = cleanText(match[1]);

      if (!raw) continue;

      const parts = raw
        .split(/\s+and\s+/i)
        .map(cleanText)
        .filter(Boolean);

      for (const value of parts) {
        if (!deliverables.includes(value)) {
          deliverables.push(value);
        }
      }
    }
  }

  return deliverables;
}

function extractDeadline(text) {
  const value = cleanText(text);

  const patterns = [
    /(?:by|before|due|deadline(?:\s+is)?)\s+([^.!?,]+)/i,
    /(?:within)\s+([^.!?,]+)/i,
    /(?:tomorrow|today|tonight|next week|next month)/i
  ];

  for (const pattern of patterns) {
    const match = value.match(pattern);

    if (match) {
      return cleanText(
        match[1] || match[0]
      );
    }
  }

  return "";
}

function detectDifficulty(text) {
  const value = text.toLowerCase();

  /*
   * Check explicit difficulty first.
   * This prevents unrelated words such as
   * "complex" from overriding "medium difficulty".
   */

  if (
    /\bexpert\b|\badvanced\b|\bhighly complex\b|\blarge scale\b/.test(
      value
    )
  ) {
    return "expert";
  }

  if (
    /\bmedium\b|\bmoderate\b/.test(
      value
    )
  ) {
    return "medium";
  }

  if (
    /\bhard\b|\bdifficult\b|\bchallenging\b|\bcomplex\b/.test(
      value
    )
  ) {
    return "hard";
  }

  if (
    /\beasy\b|\bsimple\b|\bbasic\b/.test(
      value
    )
  ) {
    return "easy";
  }

  return "unknown";
}

function detectRisk(text, type) {
  const value = text.toLowerCase();

  /*
   * Explicit high-risk actions always take priority.
   */

  if (
    /payment|financial|money|legal|contract|irreversible|credential|password|private data/.test(
      value
    )
  ) {
    return "high";
  }

  /*
   * Authorized cybersecurity work is medium
   * by default because execution may affect systems.
   */

  if (
    type === "authorized_cybersecurity" ||
    /penetration test|vulnerability assessment|security assessment/.test(
      value
    )
  ) {
    return "medium";
  }

  /*
   * Merely researching cybersecurity should
   * not automatically become medium risk.
   */

  return "low";
}

function detectRequiredSkills(text, type) {
  const skills = [];
  const value = text.toLowerCase();

  const add = skill => {
    if (!skills.includes(skill)) {
      skills.push(skill);
    }
  };

  if (
    type === "research" ||
    type === "web_research" ||
    /research|investigate/.test(value)
  ) {
    add("research");
  }

  if (
    type === "writing" ||
    /write|article|content|copy|essay/.test(value)
  ) {
    add("writing");
  }

  if (
    type === "coding" ||
    /code|program|javascript|python|node/.test(value)
  ) {
    add("coding");
  }

  if (
    type === "automation" ||
    /automate|automation|workflow|script/.test(value)
  ) {
    add("automation");
  }

  if (
    type === "excel_data" ||
    /excel|spreadsheet|csv|data/.test(value)
  ) {
    add("data");
  }

  if (
    type === "documents" ||
    /document|pdf|word|format document/.test(value)
  ) {
    add("documents");
  }

  if (
    type === "authorized_cybersecurity"
  ) {
    add("cybersecurity");
  }

  return skills;
}

function parseTask(input) {
  const text = cleanText(input);

  if (!text) {
    throw new Error(
      "Incoming task text is required."
    );
  }

  const type = detectTaskType(text);

  return {
    title:
      text.length > 120
        ? `${text.slice(0, 117)}...`
        : text,

    description: text,

    type,

    requirements:
      extractRequirements(text),

    deliverables:
      extractDeliverables(text),

    deadline:
      extractDeadline(text),

    difficulty:
      detectDifficulty(text),

    requiredSkills:
      detectRequiredSkills(
        text,
        type
      ),

    risk:
      detectRisk(
        text,
        type
      ),

    status: "new",

    source: "task-parser"
  };
}

module.exports = {
  detectTaskType,
  extractRequirements,
  extractDeliverables,
  extractDeadline,
  detectDifficulty,
  detectRisk,
  detectRequiredSkills,
  parseTask
};
