"use strict";

const fs = require("node:fs");
const assert = require("node:assert/strict");

const ui = fs.readFileSync("public/index.html", "utf8");
const contract = fs.readFileSync(
  "docs/architecture/UI-ACCEPTANCE-CONTRACT.md",
  "utf8"
);

function check(name, assertion) {
  assertion();
  console.log("PASS: " + name);
}

check("Work & Growth toggle and panel exist", () => {
  assert.match(ui, /data-menu-toggle="work-growth"/);
  assert.match(ui, /data-menu-panel="work-growth"/);
});

check("System Control toggle and panel exist", () => {
  assert.match(ui, /data-menu-toggle="system-control"/);
  assert.match(ui, /data-menu-panel="system-control"/);
});

check("Each group starts collapsed", () => {
  assert.match(
    ui,
    /data-menu-panel="work-growth" hidden/
  );
  assert.match(
    ui,
    /data-menu-panel="system-control" hidden/
  );
});

check("Toggle handler closes other groups", () => {
  assert.match(
    ui,
    /document\.querySelectorAll\("\[data-menu-toggle\]"\)\.forEach\(toggle => \{/
  );
  assert.match(
    ui,
    /otherPanel\.hidden = true;/
  );
  assert.match(
    ui,
    /other\.setAttribute\("aria-expanded", "false"\);/
  );
});

check("Toggle updates expanded state and caret", () => {
  assert.match(
    ui,
    /toggle\.setAttribute\("aria-expanded", String\(opening\)\);/
  );
  assert.match(
    ui,
    /opening \? "▾" : "▸"/
  );
});

check("Section navigation closes groups consistently", () => {
  const start = ui.indexOf("function showAdminSection(sectionName)");
  assert.notEqual(start, -1);
  const end = ui.indexOf("\n    function ", start + 1);
  const body = ui.slice(start, end === -1 ? start + 12000 : end);
  assert.match(body, /panel\.hidden = true;/);
  assert.match(
    body,
    /toggle\.setAttribute\("aria-expanded", "false"\);/
  );
});

check("Section buttons call showAdminSection", () => {
  assert.match(
    ui,
    /button\.addEventListener\("click",\s*\(\) => \{\s*showAdminSection\(button\.dataset\.section\);/
  );
});

check("Provider Management has menu and section", () => {
  assert.match(
    ui,
    /data-section="provider-management"/
  );
  assert.match(
    ui,
    /id="section-provider-management"/
  );
});

check("Active Provider has menu and section", () => {
  assert.match(
    ui,
    /data-section="active-provider"/
  );
  assert.match(
    ui,
    /id="section-active-provider"/
  );
});

check("Locked contract remains version 1.0.0", () => {
  assert.match(contract, /Version:\s*1\.0\.0/);
  assert.match(contract, /Status:\s*LOCKED/);
  assert.match(contract, /Exactly the 13 permanent main-menu entries/);
});

console.log("PROVIDER_NAVIGATION_CONTRACT_TEST=PASS");
console.log("BROWSER_E2E=NOT_RUN");
console.log("LIVE_PROVIDER_CALLS=NOT_RUN");
console.log("PROVIDER_ACTIVATION=NOT_RUN");
