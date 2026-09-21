'use strict';

const config = require('../config');

/**
 * Minimal in-memory sliding-window rate limiter keyed by an arbitrary string
 * (typically `req.ip` or a participant token). Deliberately dependency-free.
 * For a multi-instance production deployment, back this with Redis instead -
 * the function signature here is small enough to swap out.
 */
function createRateLimiter({ windowMs = config.rateLimitWindowMs, max = config.rateLimitMax } = {}) {
  const hits = new Map(); // key -> array of timestamps (ms)

  return function rateLimit(req, res, next) {
    const key = req.participantToken || req.ip;
    const now = Date.now();
    const windowStart = now - windowMs;

    let timestamps = hits.get(key) || [];
    timestamps = timestamps.filter((t) => t > windowStart);
    timestamps.push(now);
    hits.set(key, timestamps);

    if (timestamps.length > max) {
      return res.status(429).json({ error: 'Too many requests, please slow down.' });
    }
    return next();
  };
}

/**
 * Enforces "one submission per participant token per question" as required
 * by the product spec. Rejects duplicate submissions with 409 Conflict.
 * Expects `req.params.questionId` (or `req.body.questionId`) and
 * `req.participantToken` to already be set.
 */
function createDuplicateSubmissionGuard({ repository }) {
  return async function duplicateSubmissionGuard(req, res, next) {
    const questionId = req.params.questionId || req.body.questionId;
    if (!req.participantToken) {
      return res.status(401).json({ error: 'Missing participant token' });
    }
    // Instructors can opt an open-text question into multiple answers per
    // device (brainstorm style); the one-answer rule is skipped for those.
    const question = questionId ? await repository.getQuestion(questionId) : null;
    if (question && question.allowMultiple && question.type === 'open_text') {
      return next();
    }
    const already = await repository.hasParticipantAnswered(questionId, req.participantToken);
    if (already) {
      return res.status(409).json({ error: 'This device has already answered this question' });
    }
    return next();
  };
}

module.exports = { createRateLimiter, createDuplicateSubmissionGuard };
