"use strict";
const assert = require("node:assert/strict");
const { validateProviderUrl, publicIp, localName } =
  require("../services/security/provider-url-policy");

(async () => {
  const fakePublicDNS = async () => [
    { address: "93.184.216.34", family: 4 }
  ];
  const fakePrivateDNS = async () => [
    { address: "192.168.1.8", family: 4 }
  ];

  await assert.rejects(
    validateProviderUrl("file:///etc/passwd"),
    /scheme/i
  );
  await assert.rejects(
    validateProviderUrl("https://user:pass@example.com"),
    /credentials/i
  );
  await assert.rejects(
    validateProviderUrl("http://93.184.216.34"),
    /HTTPS/i
  );
  await assert.rejects(
    validateProviderUrl("http://127.0.0.1:11434"),
    /Private|special/i
  );
  await assert.rejects(
    validateProviderUrl("https://localhost:8443"),
    /Local/i
  );
  await assert.rejects(
    validateProviderUrl("https://public.example", { lookup: fakePrivateDNS }),
    /private|special/i
  );

  assert.equal(
    await validateProviderUrl("https://public.example/api", { lookup: fakePublicDNS }),
    "https://public.example/api"
  );
  assert.equal(
    await validateProviderUrl("http://127.0.0.1:11434", { allowPrivate: true }),
    "http://127.0.0.1:11434/"
  );
  assert.equal(publicIp("10.0.0.5"), false);
  assert.equal(publicIp("8.8.8.8"), true);
  assert.equal(localName("service.local"), true);

  console.log("PASS: unsafe schemes and URL credentials rejected");
  console.log("PASS: private IPs and local names blocked by default");
  console.log("PASS: private DNS resolution rejected by default");
  console.log("PASS: public HTTPS endpoint accepted with public DNS");
  console.log("PASS: explicit private-provider opt-in supports local inference");
  console.log("STAGE19_PROVIDER_URL_POLICY=PASS");
})().catch(e => {
  console.error("STAGE19_PROVIDER_URL_POLICY=FAIL", e.message);
  process.exitCode = 1;
});
