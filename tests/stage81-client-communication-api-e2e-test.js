"use strict";

const assert = require("assert");
const express = require("express");
const http = require("http");

const registerClientCommunicationRoutes =
  require("../routes/client-communication");

const {
  countCommunications,
  getCommunication,
  listCommunications
} = require("../client-communication-store");

function requestJson(
  port,
  method,
  path,
  body
) {
  return new Promise((resolve, reject) => {
    const payload =
      body === undefined
        ? ""
        : JSON.stringify(body);

    const req =
      http.request(
        {
          hostname: "127.0.0.1",
          port,
          path,
          method,
          headers: {
            "Content-Type":
              "application/json",
            "Content-Length":
              Buffer.byteLength(
                payload
              )
          }
        },
        (res) => {
          let responseBody = "";

          res.on(
            "data",
            (chunk) => {
              responseBody += chunk;
            }
          );

          res.on(
            "end",
            () => {
              let parsed;

              try {
                parsed =
                  JSON.parse(
                    responseBody
                  );
              } catch (error) {
                return reject(error);
              }

              resolve({
                status:
                  res.statusCode,
                body: parsed
              });
            }
          );
        }
      );

    req.on(
      "error",
      reject
    );

    if (payload) {
      req.write(payload);
    }

    req.end();
  });
}

async function main() {
  console.log(
    "\n=== STAGE 8.1 CLIENT COMMUNICATION API E2E TEST ==="
  );

  const beforeCount =
    countCommunications();

  const app =
    express();

  app.use(
    express.json()
  );

  const requireAgentAuth =
    (req, res, next) => {
      req.role = "user";
      req.permissions = [
        "CLIENT_PROJECTS"
      ];
      next();
    };

  const requireAgentPermission =
    (permission) =>
      (req, res, next) => {
        assert.strictEqual(
          permission,
          "CLIENT_PROJECTS",
          "Client communication API must require CLIENT_PROJECTS permission"
        );
        next();
      };

  const PERMISSIONS = {
    CLIENT_PROJECTS:
      "CLIENT_PROJECTS"
  };

  const registration =
    registerClientCommunicationRoutes(
      app,
      requireAgentAuth,
      requireAgentPermission,
      PERMISSIONS
    );

  assert.strictEqual(
    registration.registered,
    true,
    "Client communication routes must register"
  );

  assert.strictEqual(
    registration.externalSendImplemented,
    false,
    "External sending must remain unimplemented"
  );

  const server =
    await new Promise(
      (resolve) => {
        const instance =
          app.listen(
            0,
            "127.0.0.1",
            () =>
              resolve(instance)
          );
      }
    );

  try {
    const port =
      server.address().port;

    const processResponse =
      await requestJson(
        port,
        "POST",
        "/api/client-communications/process",
        {
          clientId:
            "stage81-api-client",
          content:
            "Please explain the status of my research task.",
          context: {
            source:
              "stage81-api-e2e"
          },
          taskIds: [
            "stage81-task-001"
          ],
          opportunityIds: []
        }
      );

    assert.strictEqual(
      processResponse.status,
      201,
      "Valid client message must return HTTP 201"
    );

    assert.strictEqual(
      processResponse.body.ok,
      true,
      "Successful process response must have ok=true"
    );

    assert(
      processResponse.body.communication,
      "Communication record must be returned"
    );

    const communication =
      processResponse.body.communication;

    assert(
      communication.communicationId,
      "Communication ID must be returned"
    );

    assert(
      communication.conversationId,
      "Conversation ID must be returned"
    );

    assert(
      communication.intent,
      "Intent analysis must be returned"
    );

    assert(
      communication.context,
      "Context analysis must be returned"
    );

    assert(
      communication.responseRequirements,
      "Response requirements must be returned"
    );

    assert(
      communication.draft,
      "Draft must be returned"
    );

    assert(
      communication.policy,
      "Policy result must be returned"
    );

    assert.strictEqual(
      communication.policy.policyChecked,
      true,
      "Policy must be checked"
    );

    assert(
      communication.sendBoundary,
      "Send boundary must be returned"
    );

    assert.strictEqual(
      communication.sendBoundary.sendAllowed,
      false,
      "External sending must remain disabled"
    );

    assert.strictEqual(
      communication.sendBoundary.externalSendImplemented,
      false,
      "External send implementation must remain false"
    );

    assert(
      [
        "ready_for_review",
        "not_implemented"
      ].includes(
        communication.sendBoundary.status
      ),
      "Send boundary must remain controlled and review-bound"
    );

    const communicationId =
      communication.communicationId;

    const persisted =
      getCommunication(
        communicationId
      );

    assert(
      persisted,
      "Processed communication must persist"
    );

    assert.strictEqual(
      persisted.communicationId,
      communicationId,
      "Persisted communication ID must match API response"
    );

    assert.strictEqual(
      persisted.clientId,
      "stage81-api-client",
      "Client ID must persist"
    );

    assert.strictEqual(
      persisted.policy.policyChecked,
      true,
      "Persisted policy must be checked"
    );

    const filtered =
      listCommunications({
        clientId:
          "stage81-api-client"
      });

    assert(
      filtered.some(
        communication =>
          communication.communicationId ===
          communicationId
      ),
      "Client filter must return the created communication"
    );

    const afterCount =
      countCommunications();

    assert.strictEqual(
      afterCount,
      beforeCount + 1,
      "Exactly one communication must be persisted"
    );

    const invalidResponse =
      await requestJson(
        port,
        "POST",
        "/api/client-communications/process",
        {
          clientId:
            "stage81-api-client",
          content: ""
        }
      );

    assert.strictEqual(
      invalidResponse.status,
      400,
      "Empty client message must return HTTP 400"
    );

    assert.strictEqual(
      invalidResponse.body.ok,
      false,
      "Invalid request must fail"
    );

    const missingResponse =
      await requestJson(
        port,
        "GET",
        "/api/client-communications/nonexistent-stage81-id"
      );

    assert.strictEqual(
      missingResponse.status,
      404,
      "Unknown communication must return HTTP 404"
    );

    assert.strictEqual(
      missingResponse.body.ok,
      false,
      "Unknown communication response must fail"
    );

    console.log(
      "PASS: route registration"
    );

    console.log(
      "PASS: valid process API"
    );

    console.log(
      "PASS: communication persistence"
    );

    console.log(
      "PASS: client filtering API"
    );

    console.log(
      "PASS: invalid request boundary"
    );

    console.log(
      "PASS: not-found API"
    );

    console.log(
      "PASS: external send boundary"
    );

    console.log(
      "STAGE 8.1 CLIENT COMMUNICATION API E2E TEST: PASS"
    );
  } finally {
    await new Promise(
      (resolve) =>
        server.close(resolve)
    );
  }
}

main().catch(
  (error) => {
    console.error(
      error.stack ||
        error.message
    );
    process.exit(1);
  }
);
