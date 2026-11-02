const assert = require("assert");
const fs = require("fs");
const path = require("path");

const {
  createStoredConversation,
  createStoredMessage,
  getConversation,
  getContext,
  listMessages
} = require("../conversation-store");

const {
  updateConversationMemory,
  getConversationMemory
} = require("../services/mira-conversation-memory-engine");

const {
  buildControlledResponsePlan
} = require("../services/mira-conversation-response-service");

const dataFile =
  path.join(
    __dirname,
    "..",
    "data",
    "conversations.json"
  );

const originalData =
  fs.existsSync(dataFile)
    ? fs.readFileSync(
        dataFile,
        "utf8"
      )
    : null;

function uniqueClientId() {
  return (
    "stage836-client-" +
    Date.now() +
    "-" +
    Math.random()
      .toString(36)
      .slice(2, 8)
  );
}

function uniqueExternalId(label) {
  return (
    "stage836-" +
    label +
    "-" +
    Date.now() +
    "-" +
    Math.random()
      .toString(36)
      .slice(2, 8)
  );
}

function check(condition, message) {
  assert.ok(
    condition,
    message
  );
}

async function main() {
  try {
    const clientId =
      uniqueClientId();

    const conversationResult =
      createStoredConversation({
        clientId,
        title:
          "Stage 8.3.6 E2E Conversation",
        status:
          "active"
      });

    check(
      conversationResult &&
        conversationResult.ok &&
        conversationResult.conversation &&
        conversationResult.conversation.conversationId,
      "Conversation creation failed."
    );

    const conversation =
      conversationResult.conversation;

    const conversationId =
      conversation.conversationId;

    console.log(
      "[1] Conversation creation PASS"
    );

    const incomingResult =
      createStoredMessage({
        conversationId:
          conversationId,
        clientId,
        participant:
          "client",
        direction:
          "incoming",
        status:
          "received",
        content:
          "Please build a website for my business. It should support mobile devices. The deadline is next Friday.",
        source:
          "stage836-test",
        externalMessageId:
          uniqueExternalId(
            "incoming"
          )
      });

    check(
      incomingResult &&
        incomingResult.ok &&
        incomingResult.message &&
        incomingResult.message.messageId,
      "Incoming message creation failed."
    );

    const incoming =
      incomingResult.message;

    console.log(
      "[2] Client message persistence PASS"
    );

    const memory =
      updateConversationMemory({
        conversationId:
          conversationId,
        message:
          incoming
      });

    check(
      memory &&
        memory.context &&
        Array.isArray(
          memory.context.requirements
        ),
      "Requirements memory missing."
    );

    check(
      memory.context.requirements.some(
        (item) =>
          /mobile/i.test(
            item
          )
      ),
      "Mobile requirement was not extracted."
    );

    check(
      memory.context.deadline !== null &&
        memory.context.deadline !== undefined,
      "Deadline was not extracted."
    );

    console.log(
      "[3] Memory extraction PASS"
    );

    const storedMemory =
      getConversationMemory(
        conversationId
      );

    check(
      storedMemory &&
        storedMemory.context &&
        Array.isArray(
          storedMemory.context.requirements
        ) &&
        storedMemory.context.requirements.length >
          0,
      "Stored memory missing."
    );

    console.log(
      "[4] Memory persistence PASS"
    );

    const context =
      getContext(
        conversationId
      );

    check(
      context &&
        context.conversationId ===
          conversationId,
      "Conversation context missing."
    );

    console.log(
      "[5] Conversation context PASS"
    );

    const safePlan =
      buildControlledResponsePlan({
        conversationId:
          conversationId,
        message:
          incoming
      });

    check(
      safePlan.ok === true,
      "Safe response plan failed."
    );

    check(
      safePlan.externalSendAllowed ===
        false,
      "External send must remain disabled."
    );

    check(
      safePlan.policyDecision ===
        "allowed",
      "Safe message should be allowed."
    );

    console.log(
      "[6] Safe response planning + policy PASS"
    );

    const revision =
      createStoredMessage({
        conversationId:
          conversationId,
        clientId,
        participant:
          "client",
        direction:
          "incoming",
        status:
          "received",
        content:
          "Please revise the mobile layout and update the deliverables.",
        source:
          "stage836-test",
        externalMessageId:
          uniqueExternalId(
            "revision"
          )
      });

    const revisionPlan =
      buildControlledResponsePlan({
        conversationId:
          conversationId,
        message:
          revision.message
      });

    check(
      revisionPlan.responseType ===
        "revision_acknowledgement",
      "Revision response type mismatch."
    );

    console.log(
      "[7] Revision response planning PASS"
    );

    const financial =
      createStoredMessage({
        conversationId:
          conversationId,
        clientId,
        participant:
          "client",
        direction:
          "incoming",
        status:
          "received",
        content:
          "Please send the invoice and process the payment.",
        source:
          "stage836-test",
        externalMessageId:
          uniqueExternalId(
            "financial"
          )
      });

    const financialPlan =
      buildControlledResponsePlan({
        conversationId:
          conversationId,
        message:
          financial.message
      });

    check(
      financialPlan.policyDecision ===
        "approval_required",
      "Financial action must require approval."
    );

    check(
      financialPlan.approvalRequired ===
        true,
      "Financial action approval flag missing."
    );

    check(
      financialPlan.externalSendAllowed ===
        false,
      "Financial external send must remain disabled."
    );

    console.log(
      "[8] Financial policy boundary PASS"
    );

    const credential =
      createStoredMessage({
        conversationId:
          conversationId,
        clientId,
        participant:
          "client",
        direction:
          "incoming",
        status:
          "received",
        content:
          "Please send me the account password and OTP.",
        source:
          "stage836-test",
        externalMessageId:
          uniqueExternalId(
            "credential"
          )
      });

    const credentialPlan =
      buildControlledResponsePlan({
        conversationId:
          conversationId,
        message:
          credential.message
      });

    check(
      credentialPlan.policyDecision ===
        "blocked",
      "Credential request must be blocked."
    );

    check(
      credentialPlan.externalSendAllowed ===
        false,
      "Credential external send must remain disabled."
    );

    console.log(
      "[9] Credential safety boundary PASS"
    );

    const legal =
      createStoredMessage({
        conversationId:
          conversationId,
        clientId,
        participant:
          "client",
        direction:
          "incoming",
        status:
          "received",
        content:
          "Please agree to the legal contract.",
        source:
          "stage836-test",
        externalMessageId:
          uniqueExternalId(
            "legal"
          )
      });

    const legalPlan =
      buildControlledResponsePlan({
        conversationId:
          conversationId,
        message:
          legal.message
      });

    check(
      legalPlan.policyDecision ===
        "approval_required",
      "Legal action must require approval."
    );

    console.log(
      "[10] Legal policy boundary PASS"
    );

    const irreversible =
      createStoredMessage({
        conversationId:
          conversationId,
        clientId,
        participant:
          "client",
        direction:
          "incoming",
        status:
          "received",
        content:
          "Delete the old account permanently.",
        source:
          "stage836-test",
        externalMessageId:
          uniqueExternalId(
            "irreversible"
          )
      });

    const irreversiblePlan =
      buildControlledResponsePlan({
        conversationId:
          conversationId,
        message:
          irreversible.message
      });

    check(
      irreversiblePlan.policyDecision ===
        "approval_required",
      "Irreversible action must require approval."
    );

    console.log(
      "[11] Irreversible action policy PASS"
    );

    const messages =
      listMessages({
        conversationId:
          conversationId
      });

    check(
      messages.length >= 6,
      "Conversation history is incomplete."
    );

    console.log(
      "[12] Conversation history integrity PASS"
    );

    const reloaded =
      getConversation(
        conversationId
      );

    check(
      reloaded &&
        reloaded.conversationId ===
          conversationId,
      "Conversation reload failed."
    );

    check(
      reloaded.messageCount >=
        messages.length,
      "Conversation message counter is inconsistent."
    );

    console.log(
      "[13] Persistence/reload integrity PASS"
    );

    check(
      safePlan.externalSendAllowed ===
        false &&
        financialPlan.externalSendAllowed ===
          false &&
        credentialPlan.externalSendAllowed ===
          false,
      "External send boundary was weakened."
    );

    console.log(
      "[14] External communication safety boundary PASS"
    );

    console.log(
      "STAGE836_CONVERSATION_FULL_E2E_TEST: PASS"
    );
  } finally {
    if (
      originalData !== null
    ) {
      fs.writeFileSync(
        dataFile,
        originalData
      );
    }
  }
}

main().catch(
  (error) => {
    console.error(
      "STAGE836_CONVERSATION_FULL_E2E_TEST: FAIL"
    );
    console.error(
      error.stack ||
        error.message
    );
    process.exit(1);
  }
);
