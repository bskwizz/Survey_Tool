'use strict';

const express = require('express');
const { validateBody } = require('../middleware/validate');
const { registerSchema, loginSchema } = require('../utils/schemas');

function buildAuthRoutes({ authService }) {
  const router = express.Router();

  router.post('/register', validateBody(registerSchema), async (req, res) => {
    try {
      const result = await authService.register(req.body);
      res.status(201).json(result);
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  router.post('/login', validateBody(loginSchema), async (req, res) => {
    try {
      const result = await authService.login(req.body);
      res.status(200).json(result);
    } catch (err) {
      res.status(401).json({ error: err.message });
    }
  });

  return router;
}

module.exports = { buildAuthRoutes };
