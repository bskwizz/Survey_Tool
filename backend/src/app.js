'use strict';

const path = require('path');
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

  // Content-Security-Policy tuned for the three static apps this server
  // hosts. The PowerPoint task pane loads Office.js from Microsoft's CDN and
  // is rendered inside an Office host frame, so those origins must be allowed.
  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: ["'self'", 'https://appsforoffice.microsoft.com', 'https://ajax.aspnetcdn.com'],
          connectSrc: ["'self'", 'ws:', 'wss:', 'https://appsforoffice.microsoft.com'],
          imgSrc: ["'self'", 'data:', 'blob:'],
          styleSrc: ["'self'", "'unsafe-inline'", 'https://appsforoffice.microsoft.com'],
          frameAncestors: [
            "'self'",
            'https://*.officeapps.live.com',
            'https://*.office.com',
            'https://*.office365.com',
            'https://*.microsoft.com',
            'https://*.cloud.microsoft',
            'https://*.sharepoint.com',
          ],
          upgradeInsecureRequests: config.isProduction ? [] : null,
        },
      },
      frameguard: false, // frame-ancestors above supersedes X-Frame-Options
      crossOriginResourcePolicy: { policy: 'cross-origin' }, // add-in icons are fetched by Office
      crossOriginOpenerPolicy: false,
    })
  );
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
  app.use('/api', buildQuestionRoutes({ repository, io, synthesisManager }));
  app.use('/api', buildResponseRoutes({ repository, io, synthesisManager }));
  app.use('/api', buildQrRoutes({ repository }));

  // ---- Static apps, all served from this one origin so a single public
  // ---- HTTPS host covers the API, the QR-code join links, the instructor
  // ---- dashboard, and the PowerPoint add-in files.
  const repoRoot = path.resolve(__dirname, '..', '..');
  const participantDir = path.join(repoRoot, 'frontend', 'participant');
  const dashboardDir = path.join(repoRoot, 'frontend', 'instructor-dashboard');
  const addinDir = path.join(repoRoot, 'powerpoint-addin');
  const noCache = { etag: false, lastModified: false, cacheControl: false };

  app.use('/powerpoint-addin', express.static(addinDir, noCache));
  app.use('/dashboard', express.static(dashboardDir, noCache));
  // Participant SPA: assets resolve relative to /join/, and any /join/<code>
  // deep link (what the QR code encodes) falls back to index.html.
  app.use('/join', express.static(participantDir, noCache));
  app.get('/join/:shortCode', (req, res) => {
    res.set('Cache-Control', 'no-store');
    res.sendFile(path.join(participantDir, 'index.html'));
  });
  app.get('/', (req, res) => res.redirect('/dashboard/'));

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
