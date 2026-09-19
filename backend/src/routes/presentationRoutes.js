'use strict';

const express = require('express');
const { v4: uuidv4 } = require('uuid');
const { requireInstructorAuth } = require('../middleware/auth');
const { validateBody } = require('../middleware/validate');
const { createPresentationSchema } = require('../utils/schemas');

function buildPresentationRoutes({ repository }) {
  const router = express.Router();

  router.post(
    '/presentations',
    requireInstructorAuth,
    validateBody(createPresentationSchema),
    async (req, res) => {
      const presentation = {
        id: uuidv4(),
        instructorId: req.instructor.id,
        title: req.body.title,
        createdAt: new Date().toISOString(),
      };
      await repository.createPresentation(presentation);
      res.status(201).json({ presentation });
    }
  );

  router.get('/presentations', requireInstructorAuth, async (req, res) => {
    const presentations = await repository.listPresentationsByInstructor(req.instructor.id);
    res.json({ presentations });
  });

  router.get('/presentations/:id', requireInstructorAuth, async (req, res) => {
    const presentation = await repository.getPresentation(req.params.id);
    if (!presentation) return res.status(404).json({ error: 'Presentation not found' });
    res.json({ presentation });
  });

  return router;
}

module.exports = { buildPresentationRoutes };
