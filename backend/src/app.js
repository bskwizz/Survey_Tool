'use strict';

const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const cookieParser = require('cookie-parser');

const config = require('./config');
const { createRepository } = require('./db');
const { AuthService } = require('./auth/authService');
const { SynthesisManager } = require('./synthesis/synthesisManager');
const { participantSessionMiddleware } = require('./middleware/participantSession');

const { buildAuthRoutes } = require('./routes/authRoutes');
const { buildJoinRoutes } = require('./routes/joinRoutes');
const { buildPresentationRoutes } = require('./routes/presentationRoutes');
const { buildQuestionRoutes } = require('./routes/questionRoutes');
const { buildResponseRoutes } = require('./routes/responseRoutes');
const { buildQrRoutes } = require('./routes/qrRoutes');

/**
 * Builds the Express app + wires up all dependencies. Split out from
 * index.js so it can be constructed standalone in tests (with an injected
 * `io` stub) without binding a real HTTP port.
 */
function createApp({ io }) {
  const app = express();
  const repository = createRepository();
  const authService = new AuthService({ repository });
  const synthesisManager = new SynthesisManager({ repository, io });

  app.use(helmet());
  app.use(
    cors({
      origin: config.corsOrigin,
      credentials: true,
    })
  );
  app.use(express.json({ limit: '256kb' }));
  app.use(cookieParser());
  app.use(participantSessionMiddleware);

  app.get('/api/health', (req, res) => {
    res.json({ ok: true, storageEngine: config.storageEngine, synthesisProvider: config.synthesisProvider });
  });

  app.use('/api/auth', buildAuthRoutes({ authService }));
  app.use('/api', buildJoinRoutes({ repository }));
  app.use('/api', buildPresentationRoutes({ repository }));
  app.use('/api', buildQuestionRoutes({ repository, io }));
  app.use('/api', buildResponseRoutes({ repository, io, synthesisManager }));
  app.use('/api', buildQrRoutes({ repository }));

  // Centralized error handler (last-resort safety net; individual routes
  // already catch and format their own errors).
  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    console.error('[unhandled error]', err);
    res.status(500).json({ error: 'Internal server error' });
  });

  return { app, repository, synthesisManager };
}

module.exports = { createApp };
