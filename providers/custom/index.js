const providers = {};

function registerProvider(name, provider) {
  if (!name || !provider || typeof provider.generate !== "function") {
    throw new Error("Invalid custom provider.");
  }

  providers[name] = provider;
}

function getProvider(name) {
  if (!providers[name]) {
    throw new Error(`Custom provider "${name}" not found.`);
  }

  return providers[name];
}

function listProviders() {
  return Object.keys(providers);
}


// Custom Providers
const provider1 = require("./provider1");
const provider2 = require("./provider2");
const provider3 = require("./provider3");
const provider4 = require("./provider4");
const provider5 = require("./provider5");

registerProvider("provider1", provider1);
registerProvider("provider2", provider2);
registerProvider("provider3", provider3);
registerProvider("provider4", provider4);
registerProvider("provider5", provider5);


module.exports = {
  registerProvider,
  getProvider,
  listProviders
};
