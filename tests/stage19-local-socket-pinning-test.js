"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const net = require("node:net");
const dns = require("node:dns/promises");
const https = require("node:https");
const { secureProviderRequest } =
  require("../services/security/secure-provider-request");

async function main() {
  const key = fs.readFileSync(process.env.MIRA_TEST_TLS_KEY);
  const cert = fs.readFileSync(process.env.MIRA_TEST_TLS_CERT);
  let actualRemoteAddress = null;
  let dnsCalls = 0;
  let server;

  const originalLookup = dns.lookup;

  try {
    server = https.createServer({ key, cert }, (req, res) => {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ ok: true, path: req.url }));
    });

    server.on("secureConnection", socket => {
      actualRemoteAddress = socket.remoteAddress;
    });

    await new Promise((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", resolve);
    });

    const address = server.address();
    assert(address && typeof address.port === "number");

    dns.lookup = async (hostname, options) => {
      if (String(hostname).toLowerCase().replace(/\.$/, "") !==
          "pinned.example") {
        throw new Error("Unexpected DNS lookup host in local test");
      }

      dnsCalls++;
      const records = [{ address: "127.0.0.1", family: 4 }];
      return options && options.all
        ? records
        : { address: records[0].address, family: records[0].family };
    };

    const url = `https://pinned.example:${address.port}/socket-test`;

    const result = await secureProviderRequest(
      url,
      { method: "GET" },
      { allowPrivate: true }
    );

    assert.equal(dnsCalls, 1, "expected one DNS snapshot lookup");
    assert.equal(actualRemoteAddress, "127.0.0.1",
      "HTTPS socket did not reach the pinned local address");

    const resultText = JSON.stringify(result);
    assert(resultText.includes('"ok":true'),
      "expected the local HTTPS JSON response");

    console.log("PASS: local HTTPS request completed with certificate verification");
    console.log("PASS: socket remote address is the pinned 127.0.0.1");
    console.log("PASS: only one DNS snapshot lookup occurred");
    console.log("PASS: local JSON response verified");
    console.log("LOCAL_SOCKET_ASSERTIONS=4");
    console.log("EXTERNAL_NETWORK_REQUESTS=0");
  } finally {
    dns.lookup = originalLookup;
    if (server) {
      await new Promise(resolve => server.close(() => resolve()));
    }
  }
}

main().catch(error => {
  console.error("LOCAL_SOCKET_TEST=FAIL");
  console.error(error && error.stack ? error.stack : String(error));
  process.exitCode = 1;
});
