'use strict';

const builder = require('../services/deliverable-builder');

function registerRoutes(app) {
  if (!app || typeof app.get !== 'function') {
    throw new Error('APP_REQUIRED');
  }

  app.get('/deliverables', (req, res) => {
    res.json(builder.list());
  });

  app.get('/deliverables/history', (req, res) => {
    res.json(builder.history());
  });

  app.get('/deliverables/status/:status', (req, res) => {
    try {
      res.json(builder.listByStatus(req.params.status));
    } catch (error) {
      res.status(400).json({
        error: error.message
      });
    }
  });

  app.get('/deliverables/:id', (req, res) => {
    const item = builder.get(req.params.id);

    if (!item) {
      return res.status(404).json({
        error: 'DELIVERABLE_NOT_FOUND'
      });
    }

    return res.json(item);
  });
}

module.exports = {
  registerRoutes
};
