const {
  processClientMessage
} = require("../services/mira-client-communication-engine");

const {
  getCommunication,
  listCommunications
} = require("../client-communication-store");

function registerClientCommunicationRoutes(
  app,
  requireAgentAuth,
  requireAgentPermission,
  PERMISSIONS
) {
  if (
    !app ||
    typeof app.post !== "function" ||
    typeof app.get !== "function"
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

  app.post(
    "/api/client-communications/process",
    requireAgentAuth,
    requireAgentPermission(
      PERMISSIONS.CLIENT_PROJECTS
    ),
    (req, res) => {
      try {
        const body =
          req.body || {};

        const content =
          body.content ||
          (
            body.message &&
            body.message.content
          );

        if (
          typeof content !==
            "string" ||
          !content.trim()
        ) {
          return res.status(400).json({
            ok: false,
            error:
              "Client message content is required."
          });
        }

        const result =
          processClientMessage(
            {
              clientId:
                body.clientId || "",
              conversationId:
                body.conversationId || "",
              content,
              context:
                body.context || {},
              taskIds:
                body.taskIds || [],
              opportunityIds:
                body.opportunityIds || []
            },
            {
              persist: true
            }
          );

        return res.status(201).json(
          result
        );
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
    "/api/client-communications",
    requireAgentAuth,
    requireAgentPermission(
      PERMISSIONS.CLIENT_PROJECTS
    ),
    (req, res) => {
      try {
        const communications =
          listCommunications({
            clientId:
              req.query.clientId,
            conversationId:
              req.query.conversationId,
            status:
              req.query.status,
            limit:
              req.query.limit
          });

        return res.json({
          ok: true,
          communications
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
    "/api/client-communications/:communicationId",
    requireAgentAuth,
    requireAgentPermission(
      PERMISSIONS.CLIENT_PROJECTS
    ),
    (req, res) => {
      try {
        const communication =
          getCommunication(
            req.params.communicationId
          );

        if (!communication) {
          return res.status(404).json({
            ok: false,
            error:
              "Client communication not found."
          });
        }

        return res.json({
          ok: true,
          communication
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

  return {
    registered: true,
    routes: [
      "POST /api/client-communications/process",
      "GET /api/client-communications",
      "GET /api/client-communications/:communicationId"
    ],
    externalSendImplemented: false
  };
}

module.exports =
  registerClientCommunicationRoutes;
