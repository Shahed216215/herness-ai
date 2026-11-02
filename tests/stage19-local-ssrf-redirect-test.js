"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const dns = require("node:dns/promises");
const https = require("node:https");
const { secureProviderRequest } =
  require("../services/security/secure-provider-request");

async function main() {
  const key = fs.readFileSync(process.env.MIRA_TEST_TLS_KEY);
  const cert = fs.readFileSync(process.env.MIRA_TEST_TLS_CERT);
  const originalLookup = dns.lookup;
  let redirectHits = 0;
  let destinationHits = 0;
  let server;

  try {
    server = https.createServer({ key, cert }, (req, res) => {
      if (req.url === "/redirect") {
        redirectHits++;
        res.writeHead(302, {
          location: `https://other.pinned.example:${server.address().port}/destination`
        });
        res.end();
        return;
      }
      if (req.url === "/destination") destinationHits++;
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ ok: true }));
    });

    await new Promise((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", resolve);
    });

    const port = server.address().port;

    dns.lookup = async (hostname, options) => {
      const host = String(hostname).toLowerCase().replace(/\.$/, "");

      if (host === "mixed.example") {
        const records = [
          { address: "93.184.216.34", family: 4 },
          { address: "127.0.0.1", family: 4 }
        ];
        return options && options.all
          ? records
          : { address: records[0].address, family: records[0].family };
      }

      if (host === "pinned.example") {
        const records = [{ address: "127.0.0.1", family: 4 }];
        return options && options.all
          ? records
          : { address: records[0].address, family: records[0].family };
      }

      throw new Error("Unexpected DNS hostname in isolated test: " + host);
    };

    console.log("=== A. Mixed DNS must fail before connection ===");
    await assert.rejects(
      secureProviderRequest("https://mixed.example/api", {}),
      /private|special-use|unsafe|not public/i
    );
    console.log("PASS: mixed public/private DNS rejected");

    console.log("=== B. Redirect must not be followed ===");
    await assert.rejects(
      secureProviderRequest(
        `https://pinned.example:${port}/redirect`,
        { method: "GET" },
        { allowPrivate: true }
      )
    );

    await new Promise(resolve => setImmediate(resolve));
    assert.equal(redirectHits, 1, "expected initial local redirect request");
    assert.equal(destinationHits, 0, "redirect destination must not be contacted");
    console.log("PASS: redirect response rejected");
    console.log("PASS: redirect destination received zero requests");

    console.log("LOCAL_SSRF_REDIRECT_ASSERTIONS=4");
    console.log("EXTERNAL_NETWORK_REQUESTS=0");
  } finally {
    dns.lookup = originalLookup;
    if (server) {
      await new Promise(resolve => server.close(() => resolve()));
    }
  }
}

main().catch(error => {
  console.error("LOCAL_SSRF_REDIRECT_TEST=FAIL");
  console.error(error && error.stack ? error.stack : String(error));
  process.exitCode = 1;
});
