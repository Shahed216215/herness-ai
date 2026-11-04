const {
  createStoredConversation,
  listConversations,
  getConversation,
  updateConversation,
  createStoredMessage,
  listMessages,
  getMessage,
  getContext,
  saveContext
} = require("../conversation-store");

const {
  updateConversationMemory,
  getConversationMemory
} = require("../services/mira-conversation-memory-engine");

const {
  buildControlledResponsePlan
} = require("../services/mira-conversation-response-service");

function registerConversationRoutes(
  app,
  requireAgentAuth,
  requireAgentPermission,
  PERMISSIONS
) {
  if (
    !app ||
    typeof app.post !== "function" ||
    typeof app.get !== "function" ||
    typeof app.patch !== "function"
  ) {
    throw new Error(
      "Express app with route methods is required."
    );
  }

  if (
    typeof requireAgentAuth !==
    "function"
  ) {
    throw new Error(
      "requireAgentAuth middleware is required."
    );
  }

  if (
    typeof requireAgentPermission !==
    "function"
  ) {
    throw new Error(
      "requireAgentPermission middleware is required."
    );
  }

  if (
    !PERMISSIONS ||
    !PERMISSIONS.CLIENT_PROJECTS
  ) {
    throw new Error(
      "CLIENT_PROJECTS permission is required."
    );
  }

  const auth = [
    requireAgentAuth,
    requireAgentPermission(
      PERMISSIONS.CLIENT_PROJECTS
    )
  ];

  app.post(
    "/api/conversations",
    ...auth,
    (req, res) => {
      try {
        const result =
          createStoredConversation(
            req.body || {}
          );

        if (!result.ok || !result.conversation) {
          return res.status(409).json({
            ok: false,
            status: result.status || "not_created",
            error: "Conversation was not created."
          });
        }

        return res.status(201).json({
          ok: true,
          conversation: result.conversation
        });
      } catch (error) {
        return res.status(400).json({
          ok: false,
          error:
            error.message
        });
      }
    }
  );

  app.get(
    "/api/conversations",
    ...auth,
    (req, res) => {
      try {
        const conversations =
          listConversations({
            clientId:
              req.query.clientId,
            status:
              req.query.status,
            limit:
              req.query.limit
          });

        return res.json({
          ok: true,
          conversations
        });
      } catch (error) {
        return res.status(500).json({
          ok: false,
          error:
            error.message
        });
      }
    }
  );

  app.get(
    "/api/conversations/:conversationId",
    ...auth,
    (req, res) => {
      try {
        const conversation =
          getConversation(
            req.params.conversationId
          );

        if (!conversation) {
          return res.status(404).json({
            ok: false,
            error:
              "Conversation not found."
          });
        }

        return res.json({
          ok: true,
          conversation
        });
      } catch (error) {
        return res.status(500).json({
          ok: false,
          error:
            error.message
        });
      }
    }
  );

  app.patch(
    "/api/conversations/:conversationId",
    ...auth,
    (req, res) => {
      try {
        const conversation =
          getConversation(
            req.params.conversationId
          );

        if (!conversation) {
          return res.status(404).json({
            ok: false,
            error:
              "Conversation not found."
          });
        }

        const updated =
          updateConversation(
            req.params.conversationId,
            req.body || {}
          );

        return res.json({
          ok: true,
          conversation:
            updated
        });
      } catch (error) {
        return res.status(400).json({
          ok: false,
          error:
            error.message
        });
      }
    }
  );

  app.post(
    "/api/conversations/:conversationId/messages",
    ...auth,
    (req, res) => {
      try {
        const body =
          req.body || {};

        const conversation =
          getConversation(
            req.params.conversationId
          );

        if (!conversation) {
          return res.status(404).json({
            ok: false,
            error:
              "Conversation not found."
          });
        }

        if (
          typeof body.content !==
            "string" ||
          !body.content.trim()
        ) {
          return res.status(400).json({
            ok: false,
            error:
              "Message content is required."
          });
        }

        const storedMessage =
          createStoredMessage({
            conversationId:
              req.params.conversationId,
            clientId:
              body.clientId ||
              conversation.clientId,
            participantType:
              body.participantType ||
              "client",
            direction:
              body.direction ||
              "incoming",
            status:
              body.status ||
              "received",
            content:
              body.content,
            source:
              body.source ||
              "api",
            externalMessageId:
              body.externalMessageId
          });

        if (!storedMessage.ok || !storedMessage.message) {
          return res.status(409).json({
            ok: false,
            status: storedMessage.status || "not_created",
            error: "Conversation message was not created."
          });
        }

        const message = storedMessage.message;
        let memory = null;

        if (
          message.direction ===
          "incoming"
        ) {
          memory =
            updateConversationMemory({
              conversationId:
                req.params.conversationId,
              message
            });
        }

        return res.status(201).json({
          ok: true,
          message,
          memory
        });
      } catch (error) {
        return res.status(400).json({
          ok: false,
          error:
            error.message
        });
      }
    }
  );

  app.get(
    "/api/conversations/:conversationId/messages",
    ...auth,
    (req, res) => {
      try {
        const conversation =
          getConversation(
            req.params.conversationId
          );

        if (!conversation) {
          return res.status(404).json({
            ok: false,
            error:
              "Conversation not found."
          });
        }

        const messages =
          listMessages(
            { conversationId: req.params.conversationId,
              limit:
                req.query.limit
            }
          );

        return res.json({
          ok: true,
          messages
        });
      } catch (error) {
        return res.status(500).json({
          ok: false,
          error:
            error.message
        });
      }
    }
  );

  app.get(
    "/api/conversations/:conversationId/messages/:messageId",
    ...auth,
    (req, res) => {
      try {
        const message =
          getMessage(
            req.params.messageId
          );

        if (!message) {
          return res.status(404).json({
            ok: false,
            error:
              "Conversation message not found."
          });
        }

        if (
          message.conversationId !==
          req.params.conversationId
        ) {
          return res.status(404).json({
            ok: false,
            error:
              "Conversation message not found."
          });
        }

        return res.json({
          ok: true,
          message
        });
      } catch (error) {
        return res.status(500).json({
          ok: false,
          error:
            error.message
        });
      }
    }
  );

  app.get(
    "/api/conversations/:conversationId/context",
    ...auth,
    (req, res) => {
      try {
        const context =
          getContext(
            req.params.conversationId
          );

        if (!context) {
          return res.status(404).json({
            ok: false,
            error:
              "Conversation context not found."
          });
        }

        return res.json({
          ok: true,
          context
        });
      } catch (error) {
        return res.status(500).json({
          ok: false,
          error:
            error.message
        });
      }
    }
  );

  app.put(
    "/api/conversations/:conversationId/context",
    ...auth,
    (req, res) => {
      try {
        const conversation =
          getConversation(
            req.params.conversationId
          );

        if (!conversation) {
          return res.status(404).json({
            ok: false,
            error:
              "Conversation not found."
          });
        }

        const context =
          saveContext({
            conversationId:
              req.params.conversationId,
            clientId:
              req.body?.clientId ||
              conversation.clientId,
            ...(
              req.body || {}
            )
          });

        return res.json({
          ok: true,
          context
        });
      } catch (error) {
        return res.status(400).json({
          ok: false,
          error:
            error.message
        });
      }
    }
  );

  app.get(
    "/api/conversations/:conversationId/memory",
    ...auth,
    (req, res) => {
      try {
        const conversation =
          getConversation(
            req.params.conversationId
          );

        if (!conversation) {
          return res.status(404).json({
            ok: false,
            error:
              "Conversation not found."
          });
        }

        const memory =
          getConversationMemory(
            req.params.conversationId
          );

        return res.json({
          ok: true,
          memory
        });
      } catch (error) {
        return res.status(500).json({
          ok: false,
          error:
            error.message
        });
      }
    }
  );

  app.post(
    "/api/conversations/:conversationId/response-plan",
    ...auth,
    (req, res) => {
      try {
        const body =
          req.body || {};

        const conversation =
          getConversation(
            req.params.conversationId
          );

        if (!conversation) {
          return res.status(404).json({
            ok: false,
            error:
              "Conversation not found."
          });
        }

        if (!body.message) {
          return res.status(400).json({
            ok: false,
            error:
              "Message is required."
          });
        }

        const message =
          typeof body.message ===
          "string"
            ? {
                conversationId:
                  req.params
                    .conversationId,
                clientId:
                  conversation.clientId,
                content:
                  body.message
              }
            : {
                ...body.message,
                conversationId:
                  req.params
                    .conversationId
              };

        const plan =
          buildControlledResponsePlan({
            conversationId:
              req.params.conversationId,
            message
          });

        return res.json({
          ok: true,
          plan,
          externalSendImplemented:
            false
        });
      } catch (error) {
        return res.status(400).json({
          ok: false,
          error:
            error.message
        });
      }
    }
  );

  return {
    registered: true,
    routes: [
      "POST /api/conversations",
      "GET /api/conversations",
      "GET /api/conversations/:conversationId",
      "PATCH /api/conversations/:conversationId",
      "POST /api/conversations/:conversationId/messages",
      "GET /api/conversations/:conversationId/messages",
      "GET /api/conversations/:conversationId/messages/:messageId",
      "GET /api/conversations/:conversationId/context",
      "PUT /api/conversations/:conversationId/context",
      "GET /api/conversations/:conversationId/memory",
      "POST /api/conversations/:conversationId/response-plan"
    ],
    externalSendImplemented: false
  };
}

module.exports =
  registerConversationRoutes;
