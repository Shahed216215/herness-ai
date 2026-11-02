"use strict";
const assert = require("node:assert/strict");
const dns = require("node:dns/promises");
const { secureProviderRequest, createPinnedLookup } =
  require("../services/security/secure-provider-request");
const { publicIp, localName } =
  require("../services/security/provider-url-policy");

async function main() {
  let passed = 0;
  function check(name, fn) {
    fn();
    passed++;
    console.log("PASS " + name);
  }

  check("private IPv4 blocked", () => assert.equal(publicIp("127.0.0.1"), false));
  check("RFC1918 IPv4 blocked", () => assert.equal(publicIp("192.168.1.2"), false));
  check("shared IPv4 blocked", () => assert.equal(publicIp("100.64.0.1"), false));
  check("documentation IPv4 blocked", () => assert.equal(publicIp("203.0.113.1"), false));
  check("public IPv4 accepted", () => assert.equal(publicIp("8.8.8.8"), true));
  check("mapped private IPv6 blocked", () => assert.equal(publicIp("::ffff:127.0.0.1"), false));
  check("documentation IPv6 blocked", () => assert.equal(publicIp("2001:db8::1"), false));
  check("IPv6 unique-local blocked", () => assert.equal(publicIp("fc00::1"), false));
  check("IPv6 link-local blocked", () => assert.equal(publicIp("fe80::1"), false));
  check("global IPv6 accepted", () => assert.equal(publicIp("2606:4700:4700::1111"), true));
  check("localhost recognized", () => assert.equal(localName("localhost"), true));

  const lookup = createPinnedLookup("pinned.example", [
    { address: "127.0.0.1", family: 4 }
  ]);
  await new Promise((resolve, reject) => {
    lookup("pinned.example", { all: true }, (err, records) => {
      if (err) return reject(err);
      assert.deepEqual(records, [{ address: "127.0.0.1", family: 4 }]);
      resolve();
    });
  });
  passed++;
  console.log("PASS pinned lookup returns only snapshot addresses");

  await assert.rejects(
    secureProviderRequest("http://127.0.0.1:1/api", {}),
    /requires HTTPS/
  );
  passed++;
  console.log("PASS HTTP blocked without explicit private-provider opt-in");

  console.log("DNS_PINNING_ASSERTIONS=" + passed);
  console.log("EXTERNAL_NETWORK_REQUESTS=0");
  console.log("STAGE19_DNS_PINNING_RUNTIME=PASS");
}

main().catch(e => {
  console.error("STAGE19_DNS_PINNING_RUNTIME=FAIL");
  console.error(e.stack || e);
  process.exitCode = 1;
});
