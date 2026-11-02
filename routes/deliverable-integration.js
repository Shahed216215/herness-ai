'use strict';

const orchestrator =
  require('../services/deliverable-orchestrator');

function registerDeliverableIntegrationRoutes(app, authorize) {
  if (!app || typeof app.post !== 'function') {
    throw new Error('APP_WITH_POST_REQUIRED');
  }
  if (typeof authorize !== 'function') {
    throw new Error('DELIVERABLE_AUTHORIZATION_MIDDLEWARE_REQUIRED');
  }

  app.post(
    '/deliverables/from-completed-work',
    authorize,
    (req, res) => {
      try {
        const result =
          orchestrator.prepareFromCompletedWork(
            req.body
          );

        res.status(
          result.created ? 201 : 200
        ).json(result);
      } catch (error) {
        res.status(400).json({
          error: error.message
        });
      }
    }
  );

  app.post(
    '/deliverables/:id/build-verify',
    authorize,
    (req, res) => {
      try {
        res.json(
          orchestrator.buildAndVerify(
            req.params.id
          )
        );
      } catch (error) {
        res.status(400).json({
          error: error.message
        });
      }
    }
  );

  app.post(
    '/deliverables/:id/prepare-submission',
    authorize,
    (req, res) => {
      try {
        res.json(
          orchestrator.prepareSubmission(
            req.params.id
          )
        );
      } catch (error) {
        res.status(400).json({
          error: error.message
        });
      }
    }
  );

  app.post(
    '/deliverables/:id/submit',
    authorize,
    (req, res) => {
      try {
        res.json(
          orchestrator.submit(
            req.params.id
          )
        );
      } catch (error) {
        res.status(400).json({
          error: error.message
        });
      }
    }
  );

  app.post(
    '/deliverables/:id/accept',
    authorize,
    (req, res) => {
      try {
        res.json(
          orchestrator.accept(
            req.params.id
          )
        );
      } catch (error) {
        res.status(400).json({
          error: error.message
        });
      }
    }
  );

  app.post(
    '/deliverables/:id/revision-requested',
    authorize,
    (req, res) => {
      try {
        res.json(
          orchestrator.requestRevision(
            req.params.id
          )
        );
      } catch (error) {
        res.status(400).json({
          error: error.message
        });
      }
    }
  );
}

module.exports = {
  registerDeliverableIntegrationRoutes
};
