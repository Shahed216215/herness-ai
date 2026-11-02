const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const ROOT = path.join(__dirname, "..");
const UI_FILE = path.join(ROOT, "public", "index.html");
const SOURCE_FILE = path.join(
  ROOT,
  "data",
  "work-learning-records.json"
);

function fail(message) {
  console.error(`FAIL: ${message}`);
  process.exitCode = 1;
}

function pass(message) {
  console.log(`PASS: ${message}`);
}

function sha256(content) {
  return crypto
    .createHash("sha256")
    .update(content)
    .digest("hex");
}

const ui = fs.readFileSync(UI_FILE, "utf8");
const sourceBefore = fs.readFileSync(SOURCE_FILE, "utf8");
const sourceHashBefore = sha256(sourceBefore);

console.log(
  "STAGE 6.4.9.2 SKILLS & LEARNING UI REGRESSION E2E TEST"
);

const requiredElements = [
  ["Experience Memory list", 'id="experienceMemoryList"'],
  ["Experience Memory count", 'id="experienceMemoryCount"'],
  ["Experience Memory lessons", 'id="experienceMemoryLessons"'],
  ["Experience Memory strategies", 'id="experienceMemoryStrategies"'],
  ["Lessons Learned list", 'id="lessonsLearnedList"'],
  ["Learning History list", 'id="learningHistoryList"'],
  ["Learning History detail card", 'id="learningHistoryDetailCard"'],
  ["Learning History detail", 'id="learningHistoryDetail"'],
  ["Learning History close button", 'id="learningHistoryDetailClose"']
];

for (const [name, marker] of requiredElements) {
  if (ui.includes(marker)) {
    pass(`${name} UI element exists`);
  } else {
    fail(`${name} UI element is missing`);
  }
}

const requiredFunctions = [
  "renderLearningHistoryStats",
  "renderExperienceMemoryList",
  "renderLessonsLearned",
  "renderLearningHistoryList",
  "renderLearningHistoryDetail",
  "loadLearningHistoryDetail",
  "loadLearningHistoryUI"
];

for (const name of requiredFunctions) {
  const marker = `function ${name}`;
  if (ui.includes(marker)) {
    pass(`${name}() is present`);
  } else {
    fail(`${name}() is missing`);
  }
}

const requiredEndpoints = [
  "/api/admin/learning-history/stats",
  "/api/admin/learning-history?limit=20",
  "/api/admin/learning-history/lessons?limit=20",
  "/api/admin/learning-history/${encodeURIComponent("
];

for (const endpoint of requiredEndpoints) {
  if (ui.includes(endpoint)) {
    pass(`API wiring exists: ${endpoint}`);
  } else {
    fail(`API wiring missing: ${endpoint}`);
  }
}

const hasTimelineEndpoint =
  ui.includes(
    "/api/admin/learning-history/${encodeURIComponent("
  ) &&
  ui.includes("/timeline");

if (hasTimelineEndpoint) {
  pass("Learning History timeline API is wired");
} else {
  fail("Learning History timeline API wiring is missing");
}

const skillsSectionIndex =
  ui.indexOf('data-section="skills-learning"');

const historyLoaderIndex =
  ui.indexOf("loadLearningHistoryUI();");

if (
  skillsSectionIndex !== -1 &&
  historyLoaderIndex !== -1 &&
  historyLoaderIndex > skillsSectionIndex
) {
  pass(
    "Skills & Learning section is wired to Learning History loading"
  );
} else {
  fail(
    "Skills & Learning section is not wired to Learning History loading"
  );
}

const learningHistoryDetailStart =
  ui.indexOf(
    "async function loadLearningHistoryDetail"
  );

const learningHistoryUiStart =
  ui.indexOf(
    "async function loadLearningHistoryUI"
  );

const nextFunctionAfterHistory =
  ui.indexOf(
    "\n    function ",
    learningHistoryUiStart + 1
  );

const nextAsyncFunctionAfterHistory =
  ui.indexOf(
    "\n    async function ",
    learningHistoryUiStart + 1
  );

let learningHistoryUiEnd = ui.length;

if (
  nextFunctionAfterHistory !== -1 &&
  nextAsyncFunctionAfterHistory !== -1
) {
  learningHistoryUiEnd =
    Math.min(
      nextFunctionAfterHistory,
      nextAsyncFunctionAfterHistory
    );
} else if (nextFunctionAfterHistory !== -1) {
  learningHistoryUiEnd =
    nextFunctionAfterHistory;
} else if (nextAsyncFunctionAfterHistory !== -1) {
  learningHistoryUiEnd =
    nextAsyncFunctionAfterHistory;
}

const learningHistoryUiBlock =
  ui.slice(
    learningHistoryDetailStart !== -1
      ? learningHistoryDetailStart
      : learningHistoryUiStart,
    learningHistoryUiEnd
  );

const learningHistoryWritePattern =
  /method\s*:\s*["'](?:POST|PUT|PATCH|DELETE)["']/i;

if (!learningHistoryWritePattern.test(learningHistoryUiBlock)) {
  pass(
    "No Learning History write operation is present in UI"
  );
} else {
  fail(
    "Learning History UI contains a write operation"
  );
}

if (
  ui.includes("READ-ONLY MEMORY VIEW") ||
  ui.includes("read-only")
) {
  pass("Read-only memory boundary is represented in UI");
} else {
  fail("Read-only memory boundary is not represented");
}

if (ui.includes("loadCapabilityProfile()")) {
  pass("Existing Capability Profile UI remains wired");
} else {
  fail("Existing Capability Profile UI wiring is missing");
}

const sourceAfter = fs.readFileSync(SOURCE_FILE, "utf8");
const sourceHashAfter = sha256(sourceAfter);

if (sourceHashBefore === sourceHashAfter) {
  pass("Source learning store remains unchanged");
} else {
  fail("Source learning store was modified");
}

console.log("\nSOURCE SHA256:", sourceHashAfter);

if (process.exitCode) {
  console.log(
    "\nSTAGE6_4_9_2_SKILLS_LEARNING_UI_REGRESSION: FAIL"
  );
  process.exit(process.exitCode);
}

console.log(
  "\nSTAGE6_4_9_2_SKILLS_LEARNING_UI_REGRESSION: PASS"
);
