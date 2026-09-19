'use strict';

const express = require('express');
const { v4: uuidv4 } = require('uuid');
const { validateBody } = require('../middleware/validate');
const { submitResponseSchema } = require('../utils/schemas');
const { createDuplicateSubmissionGuard, createRateLimiter } = require('../middleware/rateLimit');
const { registry } = require('../questionTypes/registry');

function buildResponseRoutes({ repository, io, synthesisManager }) {
  const router = express.Router();
  const duplicateGuard = createDuplicateSubmissionGuard({ repository });
  const rateLimit = createRateLimiter();

  router.post(
    '/responses',
    rateLimit,
    validateBody(submitResponseSchema),
    duplicateGuard,
    async (req, res) => {
      try {
        if (!req.participantToken) {
          return res.status(401).json({ error: 'Missing or invalid participant token' });
        }

        const question = await repository.getQuestion(req.body.questionId);
        if (!question) return res.status(404).json({ error: 'Question not found' });
        if (question.status !== 'collecting') {
          return res.status(409).json({ error: 'This question is not currently collecting responses' });
        }

        const questionType = registry.get(question.type);
        const normalizedValue = questionType.validateResponseValue(req.body.value, question);

        const response = {
          id: uuidv4(),
          questionId: question.id,
          participantToken: req.participantToken,
          value: normalizedValue,
          createdAt: new Date().toISOString(),
        };
        await repository.createResponse(response);

        // Streaming aggregate update - O(1), never rescans prior responses.
        let aggregate = await repository.getAggregate(question.id);
        if (!aggregate) aggregate = questionType.createEmptyAggregate(question);
        questionType.foldResponse(aggregate, normalizedValue);
        await repository.saveAggregate(question.id, aggregate);

        io.to(`question:${question.id}`).emit('response:new', {
          questionId: question.id,
          aggregate,
        });

        if (questionType.isOpenEnded && synthesisManager) {
          synthesisManager.enqueue(question.id, normalizedValue, response.id);
        }

        res.status(201).json({ response, aggregate });
      } catch (err) {
        res.status(400).json({ error: err.message });
      }
    }
  );

  return router;
}

module.exports = { buildResponseRoutes };
