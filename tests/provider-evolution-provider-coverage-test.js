 "use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");

const evolution = require("../services/mira-provider-evolution");
const ui = fs.readFileSync("public/index.html", "utf8");

const supported = [
  "openai", "anthropic", "gemini", "xai", "deepseek",
  "openrouter", "groq", "huggingface", "custom"
];

for (const name of supported) {
  assert.equal(
    evolution.validateProviderName(name).ok,
    true,
    name + " should be accepted by Evolution validation"
  );
}

const providerFiles = {
  openai: "providers/openai.js",
  anthropic: "providers/anthropic.js",
  gemini: "providers/gemini.js",
  xai: "providers/xai.js",
  deepseek: "providers/deepseek.js",
  openrouter: "providers/openrouter.js",
  groq: "providers/groq.js",
  huggingface: "providers/huggingface.js"
};

for (const [name, file] of Object.entries(providerFiles)) {
  assert.ok(fs.existsSync(file), name + " provider module file must exist");
}

// These new modules must load offline without initializing an SDK client.
for (const modulePath of [
  "../providers/anthropic",
  "../providers/xai"
]) {
  const provider = require(modulePath);
  assert.equal(typeof provider.generate, "function");
}
assert.ok(ui.includes('<option value="anthropic">Claude</option>'));
assert.ok(ui.includes('<option value="gemini">Gemini</option>'));
assert.ok(ui.includes('<option value="xai">Grok</option>'));
assert.ok(ui.includes('<option value="groq">Groq</option>'));
assert.ok(ui.includes("<option value=\"gemini\">Google Gemini</option>"));
assert.ok(!ui.includes("Grok / Together"));
assert.ok(ui.includes('<span>Claude</span><strong>Evolution supported; live connection not tested</strong>'));
assert.ok(ui.includes('<span>Grok</span><strong>Evolution supported; live connection not tested</strong>'));
assert.ok(ui.includes('<span>OpenRouter</span><strong>Evolution supported; live connection not tested</strong>'));
assert.ok(ui.includes('<span>Hugging Face</span><strong>Evolution supported; live connection not tested</strong>'));

for (const id of [
  "miraProviderName",
  "miraProviderFallbackName",
  "miraPrototypePrimaryProvider",
  "miraPrototypeFallback"
]) {
  const match = ui.match(new RegExp('<select id="' + id + '"[\\s\\S]*?</select>'));
  assert.ok(match, id + " selector should exist");
  for (const name of supported) {
    if (name === "custom") {
      assert.ok(match[0].includes('<option value="custom">Custom Provider</option>'),
        id + " should include Custom Provider");
    } else {
      const label = {
        openai: "OpenAI", anthropic: "Claude", gemini: "Gemini",
        xai: "Grok", deepseek: "DeepSeek", openrouter: "OpenRouter",
        groq: "Groq", huggingface: "Hugging Face"
      }[name];
      assert.ok(match[0].includes('<option value="' + name + '">' + label + '</option>'),
        id + " should include " + label);
    }
  }
}

console.log("PROVIDER_EVOLUTION_COVERAGE_TEST=PASS");
console.log("PROVIDER_NAMES_AND_IDS=PASS");
console.log("LIVE_PROVIDER_REQUESTS=0");
console.log("EXTERNAL_NETWORK_REQUESTS=0");
