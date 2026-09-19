'use strict';

const express = require('express');
const { generateQrPngBuffer } = require('../utils/qrcode');
const { buildParticipantUrl } = require('../utils/shortUrl');
const config = require('../config');

/**
 * Dedicated binary PNG endpoint (separate from questionRoutes.js's JSON
 * data-URI endpoint) so the QR code can be used directly as an <img src>
 * or fetched as raw bytes by the PowerPoint add-in when inserting a Picture
 * shape via `slide.shapes.addImage`.
 */
function buildQrRoutes({ repository }) {
  const router = express.Router();

  router.get('/questions/:id/qrcode.png', async (req, res) => {
    const question = await repository.getQuestion(req.params.id);
    if (!question) return res.status(404).json({ error: 'Question not found' });
    const url = buildParticipantUrl(config.publicBaseUrl, question.shortCode, question.id);
    const png = await generateQrPngBuffer(url);
    res.set('Content-Type', 'image/png');
    res.set('Cache-Control', 'no-store'); // short codes can be regenerated
    res.send(png);
  });

  return router;
}

module.exports = { buildQrRoutes };
