'use strict';

const express = require('express');
const service = require('../services/client-profile-service');

const router = express.Router();

router.get('/', (_req, res) => {
  res.json({
    ok: true,
    profiles: service.listClientProfiles()
  });
});

router.get('/:id', (req, res) => {
  const profile = service.getClientProfile(req.params.id);

  if (!profile) {
    return res.status(404).json({
      ok: false,
      error: 'CLIENT_PROFILE_NOT_FOUND'
    });
  }

  return res.json({
    ok: true,
    profile
  });
});

router.post('/', (req, res) => {
  try {
    const profile = service.createClientProfile(req.body || {});
    return res.status(201).json({
      ok: true,
      profile
    });
  } catch (error) {
    const status =
      error.code === 'CLIENT_PROFILE_DUPLICATE' ? 409 : 400;

    return res.status(status).json({
      ok: false,
      error: error.code || error.message
    });
  }
});

router.patch('/:id', (req, res) => {
  try {
    const profile = service.updateClientProfile(
      req.params.id,
      req.body || {}
    );

    return res.json({
      ok: true,
      profile
    });
  } catch (error) {
    const status =
      error.code === 'CLIENT_PROFILE_NOT_FOUND' ? 404 : 400;

    return res.status(status).json({
      ok: false,
      error: error.code || error.message
    });
  }
});

router.delete('/:id', (req, res) => {
  try {
    service.removeClientProfile(req.params.id);
    return res.status(204).send();
  } catch (error) {
    return res.status(404).json({
      ok: false,
      error: error.code || error.message
    });
  }
});

module.exports = router;
