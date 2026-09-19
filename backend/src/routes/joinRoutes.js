'use strict';

const express = require('express');
const { issueToken } = require('../middleware/participantSession');

/**
 * Anonymous participant entry point. The participant web app calls this
 * once (checking localStorage first - see frontend/participant/app.js) to
 * obtain a signed opaque token, which it then stores and reuses for every
 * subsequent question during the class, without ever entering any personal
 * information.
 */
function buildJoinRoutes({ repository }) {
  const router = express.Router();

  router.post('/join', async (req, res) => {
    // If the client already has a token (sent it back to us), just refresh
    // its lastSeenAt and return it unchanged instead of minting a new one.
    if (req.participantToken) {
      await repository.touchParticipantSession(req.participantToken);
      return res.status(200).json({ participantToken: req.participantToken, reused: true });
    }

    const token = issueToken();
    await repository.upsertParticipantSession(token);
    return res.status(201).json({ participantToken: token, reused: false });
  });

  // Convenience GET so a QR code can deep-link straight to `/join/:shortCode?q=...`
  // and the participant SPA's client-side router handles issuing/reusing the
  // token via the POST endpoint above on load.
  router.get('/join/:shortCode', async (req, res) => {
    const { shortCode } = req.params;
    const { q: questionId } = req.query;
    res.status(200).json({
      shortCode,
      questionId: questionId || null,
      message: 'Open this URL in the participant web app to answer the live question.',
    });
  });

  return router;
}

module.exports = { buildJoinRoutes };
