"use strict";

const fs = require("fs");
const assert = require("assert");

const html = fs.readFileSync("public/index.html", "utf8");

assert(html.includes('id="section-clients"'),
  "Client creation must remain inside the existing Clients section");
assert(html.includes('id="miraClientCreateForm"'),
  "Client creation form must exist");
assert(html.includes('id="miraClientName"'),
  "Client name field must exist");
assert(html.includes('id="miraClientWebsite"'),
  "Website field must exist");
assert(html.includes('id="miraClientIndustry"'),
  "Industry field must exist");
assert(html.includes('id="miraClientContactEmail"'),
  "Business contact email field must exist");
assert(html.includes('id="miraClientRequirements"'),
  "Project requirements field must exist");
assert(html.includes('api("/api/client-profiles"'),
  "Create UI must use the existing client profile API");
assert(html.includes('method: "POST"'),
  "Create UI must submit through POST");
assert(html.includes('type: "marketing_profile"'),
  "Marketing data must be stored in the existing requirements structure");
assert(html.includes('item.type === "marketing_profile"'),
  "Marketing workflow must read the saved marketing profile");
assert(html.includes("applySelectedMarketingProfile();"),
  "Selecting a client must apply saved marketing fields");
assert(html.includes('marketingLoad.click()'),
  "Client creation must refresh the Marketing client selector");
assert(html.includes('refresh.click()'),
  "Client creation must refresh the Clients record list");
assert(html.includes("SEO consent was not changed."),
  "Client creation must not imply consent was granted");

const clientSectionStart = html.indexOf('id="section-clients"');
const clientSectionEnd = html.indexOf("</section>", clientSectionStart);
assert(clientSectionStart >= 0 && clientSectionEnd > clientSectionStart,
  "Clients section must be well located");
const clientSection = html.slice(clientSectionStart, clientSectionEnd);
assert(clientSection.includes('id="miraClientCreateForm"'),
  "Create form must be within Clients section");

assert(!clientSection.includes('method: "DELETE"'),
  "Client UI must not add deletion actions");
assert(!clientSection.includes("/api/admin/mira-client-consent"),
  "Client creation UI must not grant or revoke consent");

console.log("MIRA_CLIENT_CREATION_UI_CONTRACT=PASS");
console.log("CLIENT_CREATE_API=EXISTING_POST");
console.log("MARKETING_PROFILE_AUTOFILL=CHECKED");
console.log("CONSENT_MUTATION=NONE");
console.log("CLIENT_DELETE_UI=NONE");
console.log("NETWORK_CALLS=0");
