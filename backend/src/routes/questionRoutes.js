'use strict';

const express = require('express');
const { v4: uuidv4 } = require('uuid');
const { requireInstructorAuth } = require('../middleware/auth');
const { validateBody } = require('../middleware/validate');
const { createQuestionSchema, updateQuestionSchema } = require('../utils/schemas');
const { registry } = require('../questionTypes/registry');
const { generateShortCode, buildParticipantUrl } = require('../utils/shortUrl');
const { generateQrDataUri } = require('../utils/qrcode');
const config = require('../config');

function buildQuestionRoutes({ repository, io }) {
  const router = express.Router();

  // ---- Create question (instructor only) ----
  router.post(
    '/questions',
    requireInstructorAuth,
    validateBody(createQuestionSchema),
    async (req, res) => {
      try {
        const { presentationId, slideRef, type, prompt, options } = req.body;
        const questionType = registry.get(type); // throws if unknown, but zod already enforces this
        questionType.validateDefinition({ prompt, options });

        const question = {
          id: uuidv4(),
          presentationId,
          slideRef,
          type,
          prompt,
          options,
          status: 'draft',
          showSynthesisOnSlide: false,
          shortCode: generateShortCode(),
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        };
        await repository.createQuestion(question);
        await repository.saveAggregate(question.id, questionType.createEmptyAggregate(question));

        res.status(201).json({ question, participantUrl: buildParticipantUrl(config.publicBaseUrl, question.shortCode, question.id) });
      } catch (err) {
        res.status(400).json({ error: err.message });
      }
    }
  );

  // ---- List questions for a presentation ----
  router.get('/presentations/:presentationId/questions', requireInstructorAuth, async (req, res) => {
    const questions = await repository.listQuestionsByPresentation(req.params.presentationId);
    res.json({ questions });
  });

  // ---- Get single question (public: participants need prompt/options/status) ----
  router.get('/questions/:id', async (req, res) => {
    const question = await repository.getQuestion(req.params.id);
    if (!question) return res.status(404).json({ error: 'Question not found' });
    res.json({ question });
  });

  // ---- Update question (edit prompt/options, or patch flags) ----
  router.patch(
    '/questions/:id',
    requireInstructorAuth,
    validateBody(updateQuestionSchema),
    async (req, res) => {
      const question = await repository.getQuestion(req.params.id);
      if (!question) return res.status(404).json({ error: 'Question not found' });
      const updated = await repository.updateQuestion(req.params.id, req.body);
      res.json({ question: updated });
    }
  );

  // ---- Start collection ----
  router.post('/questions/:id/start', requireInstructorAuth, async (req, res) => {
    const updated = await repository.updateQuestion(req.params.id, { status: 'collecting' });
    if (!updated) return res.status(404).json({ error: 'Question not found' });
    io.to(`question:${req.params.id}`).emit('question:status', { questionId: req.params.id, status: 'collecting' });
    res.json({ question: updated });
  });

  // ---- Stop collection ----
  router.post('/questions/:id/stop', requireInstructorAuth, async (req, res) => {
    const updated = await repository.updateQuestion(req.params.id, { status: 'closed' });
    if (!updated) return res.status(404).json({ error: 'Question not found' });
    io.to(`question:${req.params.id}`).emit('question:status', { questionId: req.params.id, status: 'closed' });
    res.json({ question: updated });
  });

  // ---- Clear responses ----
  router.post('/questions/:id/clear', requireInstructorAuth, async (req, res) => {
    const question = await repository.getQuestion(req.params.id);
    if (!question) return res.status(404).json({ error: 'Question not found' });
    await repository.clearResponsesForQuestion(req.params.id);
    const questionType = registry.get(question.type);
    await repository.saveAggregate(req.params.id, questionType.createEmptyAggregate(question));
    io.to(`question:${req.params.id}`).emit('response:new', {
      questionId: req.params.id,
      aggregate: questionType.createEmptyAggregate(question),
      cleared: true,
    });
    res.json({ ok: true });
  });

  // ---- Delete question ----
  router.delete('/questions/:id', requireInstructorAuth, async (req, res) => {
    await repository.deleteQuestion(req.params.id);
    res.status(204).end();
  });

  // ---- Regenerate short URL / QR payload ----
  router.post('/questions/:id/regenerate-url', requireInstructorAuth, async (req, res) => {
    const updated = await repository.updateQuestion(req.params.id, { shortCode: generateShortCode() });
    if (!updated) return res.status(404).json({ error: 'Question not found' });
    res.json({
      question: updated,
      participantUrl: buildParticipantUrl(config.publicBaseUrl, updated.shortCode, updated.id),
    });
  });

  // ---- Current aggregate ----
  router.get('/questions/:id/aggregate', async (req, res) => {
    const aggregate = await repository.getAggregate(req.params.id);
    if (!aggregate) return res.status(404).json({ error: 'No aggregate found for this question' });
    res.json({ aggregate });
  });

  // ---- Current synthesis snapshot (open text questions) ----
  router.get('/questions/:id/synthesis', async (req, res) => {
    const snapshot = await repository.getLatestSynthesis(req.params.id);
    res.json({ synthesis: snapshot || null });
  });

  // ---- Raw responses (paginated) ----
  router.get('/questions/:id/responses', requireInstructorAuth, async (req, res) => {
    const { afterId, limit, offset } = req.query;
    const responses = await repository.listResponsesByQuestion(req.params.id, {
      afterId: afterId || undefined,
      limit: limit ? Number(limit) : undefined,
      offset: offset ? Number(offset) : 0,
    });
    res.json({ responses, count: responses.length });
  });

  // ---- QR code as data URI (for embedding in instructor dashboard / add-in) ----
  router.get('/questions/:id/qrcode', async (req, res) => {
    const question = await repository.getQuestion(req.params.id);
    if (!question) return res.status(404).json({ error: 'Question not found' });
    const url = buildParticipantUrl(config.publicBaseUrl, question.shortCode, question.id);
    const dataUri = await generateQrDataUri(url);
    res.json({ participantUrl: url, qrDataUri: dataUri });
  });

  return router;
}

module.exports = { buildQuestionRoutes };
