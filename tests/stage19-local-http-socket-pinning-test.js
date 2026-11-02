"use strict";
const assert = require("node:assert/strict");
const http = require("node:http");
const dns = require("node:dns/promises");
const { secureProviderRequest } =
  require("../services/security/secure-provider-request");

async function main() {
  const originalLookup = dns.lookup;
  let dnsCalls = 0;
  let remoteAddress = null;
  let server;

  try {
    server = http.createServer((req, res) => {
      remoteAddress = req.socket.remoteAddress;
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ ok: true, path: req.url }));
    });

    await new Promise((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", resolve);
    });

    const port = server.address().port;
    dns.lookup = async (hostname, options) => {
      assert.equal(String(hostname).replace(/\.$/, ""), "pinned-http.example");
      dnsCalls++;
      const records = [{ address: "127.0.0.1", family: 4 }];
      return options && options.all ? records : records[0];
    };

    const result = await secureProviderRequest(
      `http://pinned-http.example:${port}/isolated-test`,
      { method: "GET" },
      { allowPrivate: true }
    );

    assert.equal(dnsCalls, 1);
    assert.equal(remoteAddress, "127.0.0.1");
    assert.equal(result.status, 200);
    assert.equal(result.data.ok, true);
    assert.equal(result.data.path, "/isolated-test");

    console.log("PASS local HTTP private-provider opt-in");
    console.log("PASS socket reached pinned 127.0.0.1");
    console.log("PASS one DNS snapshot lookup");
    console.log("EXTERNAL_NETWORK_REQUESTS=0");
    console.log("STAGE19_LOCAL_HTTP_SOCKET_PINNING=PASS");
  } finally {
    dns.lookup = originalLookup;
    if (server) await new Promise(resolve => server.close(resolve));
  }
}

main().catch(e => {
  console.error("STAGE19_LOCAL_HTTP_SOCKET_PINNING=FAIL");
  console.error(e.stack || e);
  process.exitCode = 1;
});
