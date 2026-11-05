"use strict";

const assert = require("node:assert/strict");
const { createFacebookPageConnector } = require("../services/mira-facebook-page-connector");

const calls = [];
const env = {
  FACEBOOK_PAGE_ID: "123456789",
  FACEBOOK_PAGE_ACCESS_TOKEN: "test-token-never-real",
  META_GRAPH_API_VERSION: "v99.0"
};
const connector = createFacebookPageConnector({
  env,
  request: async (url, config) => {
    calls.push({ url, config });
    if (config.method === "POST")
      return { status: 200, data: { id: "123456789_987654321" } };
    if (url.includes("/123456789_987654321?"))
      return {
        status: 200,
        data: {
          id: "123456789_987654321",
          message: "synthetic test post",
          permalink_url: "https://www.facebook.com/123456789/posts/987654321",
          from: { id: "123456789" }
        }
      };
    return { status: 200, data: { id: "123456789", name: "Synthetic Page" } };
  }
});

(async () => {
  const caps = await connector.detectCapabilities();
  assert.equal(caps.read, "VERIFIED");
  assert.equal(caps.write, "NOT_VERIFIED");
  assert.equal(caps.manualPosting, "AVAILABLE");

  const draft = connector.createManualPostDraft({ message: "  Draft only  " });
  assert.equal(draft.status, "PENDING_MANUAL_POST");
  assert.equal(draft.published, false);

  assert.throws(
    () => connector.publishPost({ message: "not approved" }),
    error => error.code === "FACEBOOK_PUBLISH_APPROVAL_REQUIRED"
  );

  const published = await connector.publishPost({
    message: "synthetic approved test",
    approved: true
  });
  assert.equal(published.status, "PENDING_READBACK");
  assert.equal(published.verified, false);

  const readback = await connector.verifyPost({ postId: published.postId });
  assert.equal(readback.status, "VERIFIED");
  assert.equal(readback.canonicalMemoryWrite, false);

  const parsed = connector.parsePagePostUrl(
    "https://www.facebook.com/123456789/posts/987654321"
  );
  assert.equal(parsed.postId, "123456789_987654321");

  assert.throws(
    () => connector.parsePagePostUrl("https://evil.example/posts/123"),
    error => error.code === "FACEBOOK_POST_URL_INVALID"
  );
  assert.throws(
    () => connector.parsePagePostUrl("https://www.facebook.com/123456789/posts/987654321?access_token=leak"),
    error => error.code === "FACEBOOK_POST_URL_INVALID"
  );

  assert.equal(calls.length, 3);
  assert.ok(calls.every(call => call.url.startsWith("https://graph.facebook.com/v99.0/")));
  assert.ok(calls.every(call => call.config.headers.Authorization === "Bearer test-token-never-real"));
  console.log("MOCK_ONLY_FACEBOOK_PAGE_CONNECTOR=PASS");
  console.log("LIVE_FACEBOOK_REQUESTS=0");
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
